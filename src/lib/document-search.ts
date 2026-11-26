/**
 * The vocabulary the document library and the search screen share.
 *
 * A catalog row is metadata only. Bytes stay behind an RPC-checked download
 * route, so a result can name a document without ever carrying its contents.
 *
 * Document statuses use the unified status model
 * (see {@link src/lib/status}); older rows that still carry a legacy value are
 * mapped on read through {@link normalizeStatus}. The labels and classes below
 * are re-exported from the unified module so the whole product renders the same
 * status the same way.
 */

import { STATUS_LABEL as DOCUMENT_STATUS_LABEL, STATUS_CLASS as DOCUMENT_STATUS_CLASS } from "@/lib/status";
import type { Status } from "@/lib/status";

export type DocumentStatus = Status;

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

export { DOCUMENT_STATUS_LABEL, DOCUMENT_STATUS_CLASS };
export type { Status };

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
