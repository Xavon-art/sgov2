/**
 * The vocabulary both resolution screens share.
 *
 * The statuses are the five the database knows. `published` and `approved` both
 * read as "Approved" to a person -- they are the same display family -- but they
 * stay distinct on the wire because only one of them has been released to the
 * whole organisation.
 */
export type ResolutionStatus =
  | "submitted"
  | "under_review"
  | "approved"
  | "returned"
  | "published";

export type ResolutionScope = "unit" | "org";

export type ResolutionRow = {
  id: string;
  title: string;
  status: ResolutionStatus;
  unitName: string | null;
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
  timeline: ResolutionTimelineEntry[];
};

/** Only USG reviewers may move a resolution through these. */
export type ResolutionDecision =
  | "under_review"
  | "approved"
  | "returned"
  | "published";

export const STATUS_LABEL: Record<ResolutionStatus, string> = {
  submitted: "Pending",
  under_review: "Under review",
  approved: "Approved",
  returned: "Returned",
  published: "Approved",
};

export const STATUS_CLASS: Record<ResolutionStatus, string> = {
  submitted: "border-line bg-canvas text-muted",
  under_review: "border-brass/40 bg-brass-soft/30 text-brass-deep",
  approved: "border-ink/20 bg-ink/[0.06] text-ink",
  returned: "border-[#d9a99c] bg-[#a5442c]/[0.08] text-[#a5442c]",
  published: "border-ink/20 bg-ink/[0.06] text-ink",
};

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
