/**
 * Accomplishment report statuses use the unified status model
 * (see {@link src/lib/status}); older rows that still carry a legacy value are
 * mapped on read through {@link normalizeStatus}. The labels and classes below
 * are re-exported from the unified module so the whole product renders the same
 * status the same way.
 */

import { STATUS_LABEL as ACCOMPLISHMENT_STATUS_LABEL, STATUS_CLASS as ACCOMPLISHMENT_STATUS_CLASS } from "@/lib/status";
import type { Status } from "@/lib/status";

export type AccomplishmentReportStatus = Status;

export type AccomplishmentFile = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
};

export type AccomplishmentReportRow = {
  id: string;
  eventId: string;
  eventTitle: string;
  unitName: string;
  status: AccomplishmentReportStatus;
  submittedAt: string;
  canReview?: boolean;
  files?: AccomplishmentFile[];
};

export type AccomplishmentReviewEntry = {
  decision: Status;
  remark: string | null;
  reviewerName: string | null;
  createdAt: string;
};

export type AccomplishmentReportDetail = AccomplishmentReportRow & {
  canReview?: boolean;
  reportingUnitId: string | null;
  narrative: string;
  highlights: string;
  attachmentSubmissionId: string | null;
  decisionRemark: string | null;
  reviewedAt: string | null;
  timeline: AccomplishmentReviewEntry[];
  files?: AccomplishmentFile[];
};

export type AccomplishmentDecision = Extract<Status, "approved" | "returned">;

export { ACCOMPLISHMENT_STATUS_LABEL, ACCOMPLISHMENT_STATUS_CLASS };
export type { Status };

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function formatAccomplishmentDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-PH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
