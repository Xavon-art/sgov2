/**
 * The vocabulary the document library and the search screen share.
 *
 * A catalog row is metadata only. Bytes stay behind an RPC-checked download
 * route, so a result can name a document without ever carrying its contents.
 */
export type DocumentStatus = "pending" | "approved" | "rejected";

export type DocumentGroupKind = "requirement" | "resolution" | "event" | "request" | "task";

export type DocumentSourceKind =
  | "requirement_submission"
  | "resolution"
  | "personal_request"
  | "event"
  | "event_file"
  | "accomplishment_file"
  | "task_requirement_file"
  | "task_assignment_response";

export type DocumentRow = {
  documentKey: string;
  submissionId: string;
  sourceKind: DocumentSourceKind;
  sourceId: string;
  title: string;
  description: string;
  keywords: string;
  groupKind: DocumentGroupKind;
  groupLabel: string | null;
  originUnitId: string | null;
  type: string;
  unitName: string | null;
  status: DocumentStatus;
  submittedAt: string;
  downloadUrl: string | null;
  externalUrl: string | null;
  canEdit?: boolean;
  approvalRemark?: string | null;
};

export type DocumentDecision = DocumentStatus;

export const DOCUMENT_STATUS_LABEL: Record<DocumentStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

export const DOCUMENT_STATUS_CLASS: Record<DocumentStatus, string> = {
  pending: "border-brass/40 bg-brass-soft/30 text-brass-deep",
  approved: "border-ink/20 bg-ink/[0.06] text-ink",
  rejected: "border-[#d9a99c] bg-[#a5442c]/[0.08] text-[#a5442c]",
};

export const GROUP_KIND_LABEL: Record<DocumentGroupKind, string> = {
  requirement: "Requirement",
  resolution: "Resolution",
  event: "Event",
  request: "Request",
  task: "Task",
};

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function formatDocumentDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-PH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
