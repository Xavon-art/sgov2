export type AccomplishmentReportStatus = "submitted" | "acknowledged" | "returned";

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
  decision: AccomplishmentReportStatus;
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

export type AccomplishmentDecision = Extract<
  AccomplishmentReportStatus,
  "acknowledged" | "returned"
>;

export const ACCOMPLISHMENT_STATUS_LABEL: Record<
  AccomplishmentReportStatus,
  string
> = {
  submitted: "Submitted",
  acknowledged: "Acknowledged",
  returned: "Returned",
};

export const ACCOMPLISHMENT_STATUS_CLASS: Record<
  AccomplishmentReportStatus,
  string
> = {
  submitted: "border-brass/40 bg-brass-soft/30 text-brass-deep",
  acknowledged: "border-ink/20 bg-ink/[0.06] text-ink",
  returned: "border-[#d9a99c] bg-[#a5442c]/[0.08] text-[#a5442c]",
};

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
