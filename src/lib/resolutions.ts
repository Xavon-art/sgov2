/**
 * The vocabulary both resolution screens share.
 *
 * Resolution statuses use the unified status model
 * (see {@link src/lib/status}); older rows that still carry a legacy value are
 * mapped on read through {@link normalizeStatus}. The labels and classes below
 * are re-exported from the unified module so the whole product renders the same
 * status the same way.
 */

import { STATUS_LABEL as RESOLUTION_LABEL, STATUS_CLASS as RESOLUTION_CLASS } from "@/lib/status";
import type { Status } from "@/lib/status";

export type ResolutionStatus = Status;

export type ResolutionScope = "unit" | "org";

export type ResolutionRow = {
  id: string;
  title: string;
  resolutionNo: string | null;
  datePassed: string | null;
  shortSummary: string | null;
  proposedBudget: number | null;
  status: ResolutionStatus;
  unitName: string | null;
  hasAttachment: boolean;
  createdAt: string;
  decidedAt: string | null;
  decisionRemark: string | null;
};

export type ResolutionTimelineEntry = {
  decision: string;
  remark: string | null;
  reviewerName: string | null;
  createdAt: string;
};

export type ResolutionDetail = ResolutionRow & {
  body: string;
  scope: ResolutionScope;
  unitId: string | null;
  storagePath: string | null;
  originalName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  timeline: ResolutionTimelineEntry[];
};

/** Only USG reviewers may move a resolution through these. */
export type ResolutionDecision = "under_review" | "approved" | "rejected" | "returned";

export { RESOLUTION_LABEL, RESOLUTION_CLASS };
export type { Status };

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-PH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
