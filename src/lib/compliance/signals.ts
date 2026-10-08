/**
 * Signal evaluation. Signals are the closed inventory of "something worth a
 * reviewer's eye" findings, each with a fixed user-facing label and a fixed
 * recommendation. No free text is ever generated here; the only interpolation is
 * the name of another requirement item, which is data the app already holds.
 */
import type {
  CompItemInput,
  ExtractedDocument,
  KeyFact,
  MatchResult,
  ProposalsContext,
  Signal,
  SignalCode,
} from "./types";

const PLACEHOLDER = /\b(lorem|ipsum|tbd|todo|xxxx|x{4,}|placeholder|sample only|draft only|test only|hello world|n\/a|tba|fill this|sabihin dito|ilagay dito|for checking|for verification)\b/i;

export function placeholderHit(text: string): boolean {
  return PLACEHOLDER.test(text);
}

export interface EvaluationInputs {
  text: string;
  hasSubmission: boolean;
  kind: CompItemInput["itemKind"];
  extracted: ExtractedDocument | null;
  facts: KeyFact[];
  match: MatchResult;
  context: ProposalsContext;
  itemLabel: string;
  ownItemId: string;
  readError?: string;
}

export function evaluateSignals(inputs: EvaluationInputs): Signal[] {
  const signals: Signal[] = [];
  const push = (code: SignalCode, level: Signal["level"], label: string, recommendation: string) =>
    signals.push({ code, level, label, recommendation });

  if (!inputs.hasSubmission) {
    push(
      "empty_document",
      "block",
      "No document is attached",
      "Ask the unit to attach the required document before approving.",
    );
    return signals;
  }

  if (inputs.kind === "link") {
    push(
      "link_not_inspectable",
      "info",
      "A link was submitted; its content cannot be read automatically",
      "Open the link and verify it covers what this item asks for.",
    );
    return signals;
  }

  if (inputs.readError) {
    push(
      "unreadable",
      "block",
      "The stored file could not be read",
      "Ask the unit to re-upload the document.",
    );
    return signals;
  }

  // A document that yielded no readable text at all.
  if (!inputs.extracted) {
    push(
      "unreadable",
      "block",
      "The file could not be opened as a document",
      "Ask for the document in PDF, DOCX, XLSX, or TXT.",
    );
    return signals;
  }

  const { issue, format } = inputs.extracted;

  if (issue === "encrypted_pdf") {
    push(
      "encrypted_pdf",
      "block",
      "The PDF is password-protected",
      "Ask for an unlocked copy of the PDF.",
    );
    return signals;
  }
  if (issue === "unsupported_format") {
    push(
      "unsupported_format",
      "block",
      "This file type cannot be inspected",
      "Ask for the document as PDF, DOCX, XLSX, TXT, or a photo.",
    );
    return signals;
  }
  if (issue === "ocr_pending") {
    push(
      "ocr_pending",
      "warn",
      "A photo was uploaded; its text needs on-device OCR to be read",
      "Use the 'Read images' check, or re-upload a typed document.",
    );
    return signals;
  }
  if (issue === "no_text_layer" || (format === "pdf" && inputs.text.replace(/\s+/g, "").length < 15)) {
    push(
      "no_text_layer",
      "block",
      "This PDF appears to be a scan with no selectable text",
      "OCR the scan in the browser check, or re-upload a typed PDF.",
    );
  }

  const clean = inputs.text.trim();
  if (clean.length === 0) {
    push(
      "empty_document",
      "block",
      "The document contains no readable text",
      "Re-upload a filled document; a blank page is not a submission.",
    );
  } else if (clean.length < 160) {
    push(
      "very_short",
      "warn",
      "The document is very short",
      "Check that every required section is present before approving.",
    );
  }

  if (placeholderHit(inputs.text)) {
    push(
      "placeholder_language",
      "warn",
      "The document still contains placeholder text",
      "Have the unit replace sample/placeholder wording before approval.",
    );
  }

  const hasDate = inputs.facts.some((f) => f.kind === "date");
  const hasAmount = inputs.facts.some((f) => f.kind === "amount");

  if (clean.length > 0 && !hasDate) {
    push(
      "no_date_found",
      "info",
      "No date was found in the document",
      "If this item should carry a date, ask the unit to add one.",
    );
  }
  if (clean.length > 0 && !hasAmount && /financ|budget|fund|cost|expense|sponsor|donation/i.test(inputs.itemLabel)) {
    push(
      "no_amount_found",
      "info",
      "No amount was found, though the item asks about finances",
      "Confirm the document states a budget or financial figure.",
    );
  }

  const eventDate = inputs.context.eventDate;
  if (eventDate && hasDate) {
    const dates = inputs.facts.filter((f) => f.kind === "date").map((f) => f.value);
    const mismatching = dates.filter((d) => !sameDay(d, eventDate));
    if (mismatching.length === dates.length && dates.length === 1) {
      push(
        "date_mismatch_event",
        "warn",
        "The only date in the document differs from the proposal's event date",
        "Confirm whether the document's date is correct or the event moved.",
      );
    }
  }

  const names = [inputs.context.unitName, inputs.context.programName, inputs.context.venue].filter(Boolean);
  if (
    clean.length > 150 &&
    names.length > 0 &&
    !names.some((n) => n && inputs.text.toLowerCase().includes(n.toLowerCase()))
  ) {
    push(
      "unit_name_missing",
      "info",
      "The document does not name the council or activity",
      "Confirm the document is genuinely from the submitting unit.",
    );
  }

  const { match } = inputs;
  // A doc that names its own item ("LETTER OF INTENT") is classified by that act;
  // a low absolute score then just means thin text, not a mislabelled file. The
  // warning is reserved for files that neither match well nor self-identify.
  if (
    match.bestItemId !== undefined &&
    match.ownScore < 0.28 &&
    match.bestItemId !== inputs.ownItemId
  ) {
    push(
      "low_match_score",
      "warn",
      "The content does not clearly match what this item requires",
      "Review the document manually before deciding.",
    );
  }
  if (matchesDifferentItem(match, inputs.ownItemId)) {
    const other = match.bestItemLabel ?? "another requirement";
    push(
      "better_matches_different_item",
      "block",
      `The document resembles "${other}" more than this item`,
      `Confirm it was filed under the right requirement; it may belong under "${other}".`,
    );
  }

  return signals;
}

/** Whether the best match is a *different* item by a clearly wider margin. */
export function matchesDifferentItem(match: MatchResult, ownItemId: string): boolean {
  return (
    !!match.bestItemId &&
    match.bestItemId !== ownItemId &&
    match.score - match.ownScore > 0.15 &&
    match.score > 0.4
  );
}

function sameDay(a: string, b: string): boolean {
  const pa = parseDate(a);
  const pb = parseDate(b);
  if (!pa || !pb) return false;
  return pa.getFullYear() === pb.getFullYear() && pa.getMonth() === pb.getMonth() && pa.getDate() === pb.getDate();
}

function parseDate(value: string): Date | null {
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const slash = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const y = Number(slash[3]) < 100 ? 2000 + Number(slash[3]) : Number(slash[3]);
    return new Date(y, Number(slash[1]) - 1, Number(slash[2]));
  }
  const written = value.match(/\b[A-Za-z]{3,9}\s+(\d{1,2}),?\s+(\d{4})/);
  if (written) return new Date(Number(written[2]), monthIndex(value), Number(written[1]));
  return null;
}

function monthIndex(value: string): number {
  const map: Record<string, number> = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
    apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
    aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9,
    nov: 10, november: 10, dec: 11, december: 11,
  };
  const m = value.toLowerCase().match(/\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\b/);
  return m ? (map[m[1]] ?? 0) : 0;
}