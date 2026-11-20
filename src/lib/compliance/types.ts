/**
 * The fixed output contract of the requirement check.
 *
 * The whole point of this contract is that it is *closed*: the engine never
 * produces free text. Every recommendation comes from a fixed signal table, every
 * match is against the org's own requirement items, and the report names nothing
 * outside the app's data. That is the "the AI's scope is only the app" guarantee.
 */

export type ItemKind = "file" | "link";
export type SubmissionKind = "file" | "link";

/** What the engine believes about one requirement item, in review terms. */
export type ComplianceStatus = "missing" | "ok" | "suspect" | "unreadable";

/** Closed signal set. New signals are only ever added to this literal. */
export type SignalCode =
  | "empty_document"
  | "unreadable"
  | "very_short"
  | "placeholder_language"
  | "no_text_layer"
  | "encrypted_pdf"
  | "unsupported_format"
  | "ocr_pending"
  | "no_date_found"
  | "no_amount_found"
  | "date_mismatch_event"
  | "unit_name_missing"
  | "link_not_inspectable"
  | "low_match_score"
  | "better_matches_different_item";

export type SignalLevel = "info" | "warn" | "block";

export interface Signal {
  code: SignalCode;
  level: SignalLevel;
  label: string;
  /** Parameterized only with data the app already holds (e.g. another item's label). */
  recommendation: string;
}

export interface KeyFact {
  kind: "date" | "amount" | "email" | "reference";
  value: string;
}

export type ExtractedFormat = "pdf" | "docx" | "xlsx" | "txt" | "image" | "zip" | "other";

export interface ExtractedDocument {
  format: ExtractedFormat;
  text: string;
  pageCount?: number;
  issue?:
    | "encrypted_pdf"
    | "unsupported_format"
    | "ocr_pending"
    | "unreadable"
    | "no_text_layer";
}

export interface MatchResult {
  /** The requirement item the document most resembles (id + label). */
  bestItemId?: string;
  bestItemLabel?: string;
  score: number;
  /** Same-doc item's own score, for "is the right doc under the right item". */
  ownScore: number;
}

export interface CompItemInput {
  itemId: string;
  label: string;
  itemKind: ItemKind;
  submission?: {
    submissionId: string;
    submissionKind: SubmissionKind;
    originalName?: string;
    sizeBytes?: number;
    linkUrl?: string;
  };
  /** Raw file bytes; undefined for link items or when the read failed. */
  buffer?: Buffer;
  /** Set when the bytes could not be read or the file matches no known format. */
  readError?: string;
}

export interface ProposalsContext {
  title: string;
  eventDate?: string | null;
  venue?: string | null;
  unitName?: string | null;
  programName?: string | null;
  submittedBy?: string | null;
}

export interface CompItemResult {
  itemId: string;
  label: string;
  itemKind: ItemKind;
  status: ComplianceStatus;
  submission?: {
    submissionId: string;
    submissionKind: SubmissionKind;
    originalName?: string;
    sizeBytes?: number;
    linkUrl?: string;
  };
  extracted?: {
    format: ExtractedFormat;
    textLength: number;
    pageCount?: number;
    preview: string;
  };
  facts: KeyFact[];
  signals: Signal[];
  match: MatchResult;
  recommendation: string;
}

export interface ReportSummary {
  items: number;
  present: number;
  missing: number;
  unreadable: number;
  suspect: number;
  ok: number;
}

export interface ComplianceReport {
  ok: true;
  schemaVersion: 1;
  scope: "app";
  proposalId: string;
  versionId: string;
  generatedAt: string;
  durationMs: number;
  summary: ReportSummary;
  items: CompItemResult[];
  /** Fixed, always-present disclaimer that this is an assist, not a decision. */
  note: string;
}

export interface PreflightItemInput {
  itemId: string;
  label: string;
  itemKind: ItemKind;
  fileName?: string;
  sizeBytes?: number;
  linkUrl?: string;
  text?: string;
  format?: ExtractedFormat;
  issue?: ExtractedDocument["issue"];
  readError?: string;
}

export interface PreflightInput {
  items: PreflightItemInput[];
  context: ProposalsContext;
}

export interface PreflightReport {
  ok: true;
  schemaVersion: 1;
  scope: "preflight";
  generatedAt: string;
  durationMs: number;
  summary: ReportSummary;
  items: CompItemResult[];
  note: string;
}