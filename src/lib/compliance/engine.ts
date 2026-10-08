/**
 * The requirement check engine: one proposal version in, a fixed-schema report
 * out. This is the "AI-assisted requirement checking" feature of SmartGov -- no
 * external API, no key, no model download. Every number in the report is produced
 * deterministically from the proposal's own requirement items and the bytes the
 * unit uploaded.
 */
import type {
  CompItemInput,
  CompItemResult,
  ComplianceReport,
  ExtractedDocument,
  ProposalsContext,
  Signal,
} from "./types";
import { extractDocument, previewOf } from "./textify";
import { extractFacts } from "./facts";
import { evaluateSignals } from "./signals";
import { matchDocumentAgainstItems } from "./match";

export interface EngineInput {
  proposalId: string;
  versionId: string;
  items: CompItemInput[];
  context: ProposalsContext;
}

const NOTE =
  "This is a deterministic reading aid produced from the submitted bytes and the " +
  "organization's own requirement items. It is not a decision; a reviewer still " +
  "rules on each document.";

export async function runComplianceCheck(input: EngineInput): Promise<ComplianceReport> {
  const started = Date.now();
  const labels = input.items.map((it) => ({ itemId: it.itemId, label: it.label }));

  const results: CompItemResult[] = [];
  for (const item of input.items) {
    results.push(await checkOne(item, labels, input.context));
  }

  const summary = {
    items: results.length,
    present: results.filter((r) => r.status !== "missing").length,
    missing: results.filter((r) => r.status === "missing").length,
    unreadable: results.filter((r) => r.status === "unreadable").length,
    suspect: results.filter((r) => r.status === "suspect").length,
    ok: results.filter((r) => r.status === "ok").length,
  };

  return {
    ok: true,
    schemaVersion: 1,
    scope: "app",
    proposalId: input.proposalId,
    versionId: input.versionId,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    summary,
    items: results,
    note: NOTE,
  };
}

async function checkOne(
  item: CompItemInput,
  labels: Array<{ itemId: string; label: string }>,
  context: ProposalsContext,
): Promise<CompItemResult> {
  const result: CompItemResult = {
    itemId: item.itemId,
    label: item.label,
    itemKind: item.itemKind,
    status: "missing",
    submission: item.submission,
    facts: [],
    signals: [],
    match: { score: 0, ownScore: 0 },
    recommendation: "",
  };

  const hasSubmission =
    !!item.submission &&
    (item.submission.submissionKind === "link"
      ? !!item.submission.linkUrl
      : item.submission.submissionKind === "file" && !item.readError);

  const areBytes =
    hasSubmission && item.buffer !== undefined && item.buffer.length > 0;
  const extracted: ExtractedDocument | null = areBytes
    ? await extractDocument(item.buffer!, item.submission?.originalName)
    : null;
  const text = extracted?.text ?? "";
  const facts = areBytes ? extractFacts(text) : [];
  const match = areBytes
    ? matchDocumentAgainstItems(text, labels, item.itemId)
    : { score: 0, ownScore: 0 };

  const signals: Signal[] = evaluateSignals({
    text,
    hasSubmission,
    kind: item.itemKind,
    extracted,
    facts,
    match,
    context,
    itemLabel: item.label,
    ownItemId: item.itemId,
    readError: item.readError,
  });

  result.facts = facts;
  result.match = match;
  result.signals = signals;

  if (extracted) {
    result.extracted = {
      format: extracted.format,
      textLength: text.length,
      ...(extracted.pageCount !== undefined ? { pageCount: extracted.pageCount } : {}),
      preview: previewOf(text),
    };
  }

result.status = deriveStatus(hasSubmission, extracted, text, signals);

  const primary =
    signals.find((s) => s.level === "block") ??
    signals.find((s) => s.level === "warn") ??
    signals[0];
  result.recommendation =
    primary?.recommendation ?? deriveRecommendation(result.status, result.itemKind);

  return result;
}

function deriveRecommendation(status: CompItemResult["status"], kind: CompItemInput["itemKind"]): string {
  if (status === "missing") {
    return "Requires the unit to submit this before the proposal can be ruled complete.";
  }
  if (status === "unreadable") {
    return "The file could not be read from the bytes provided; ask the unit to resubmit.";
  }
  if (status === "ok" && kind === "link") {
    return "Link is present; open it to verify the content still resolves.";
  }
  return "Looks complete and consistent; you can proceed to check it off.";
}

function deriveStatus(
  hasSubmission: boolean,
  extracted: ExtractedDocument | null,
  text: string,
  signals: Signal[],
): CompItemResult["status"] {
  if (!hasSubmission) return "missing";

  const issue = extracted?.issue;
  if (
    issue === "encrypted_pdf" ||
    issue === "unsupported_format" ||
    issue === "ocr_pending" ||
    (issue === "unreadable" && extracted?.format !== "pdf")
  ) {
    return "unreadable";
  }

  // A file that gave us bytes but no meaningful text is a scan/blank; a link
  // has no text at all and must not be judged by it.
  if (extracted && text.replace(/\s+/g, "").length < 15) return "unreadable";

  if (signals.some((s) => s.level === "warn" || s.level === "block")) return "suspect";
  return "ok";
}