import { callRpc, type RpcResult } from "@/lib/auth/rpc";

export type AccomplishmentReportStatus = "submitted" | "acknowledged" | "returned";

export type AccomplishmentReportRow = {
  id: string;
  eventId: string;
  eventTitle: string;
  unitName: string;
  status: AccomplishmentReportStatus;
  submittedAt: string;
  canReview?: boolean;
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
};

export type AccomplishmentDecision = Extract<
  AccomplishmentReportStatus,
  "acknowledged" | "returned"
>;

export type ListAccomplishmentReportsResult = RpcResult & {
  canReview?: boolean;
  rows?: AccomplishmentReportRow[];
};

export type GetAccomplishmentReportResult = RpcResult & {
  canReview?: boolean;
  item?: AccomplishmentReportDetail | null;
};

export type SubmitAccomplishmentReportResult = RpcResult & {
  id?: string;
  updated?: boolean;
};

export type ReviewAccomplishmentReportResult = RpcResult & {
  id?: string;
  status?: AccomplishmentReportStatus;
};

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

export async function listAccomplishmentReports(
  sessionToken: string,
  eventId?: string | null,
): Promise<ListAccomplishmentReportsResult> {
  return callRpc<ListAccomplishmentReportsResult>("list_accomplishment_reports", {
    p_session_token: sessionToken,
    p_event_id: eventId || null,
  });
}

export async function getAccomplishmentReport(
  sessionToken: string,
  reportId: string,
): Promise<GetAccomplishmentReportResult> {
  return callRpc<GetAccomplishmentReportResult>("get_accomplishment_report", {
    p_session_token: sessionToken,
    p_report_id: reportId,
  });
}

export async function submitAccomplishmentReport(
  sessionToken: string,
  input: {
    eventId: string;
    narrative: string;
    highlights: string;
    attachmentSubmissionId?: string | null;
  },
): Promise<SubmitAccomplishmentReportResult> {
  return callRpc<SubmitAccomplishmentReportResult>("submit_accomplishment_report", {
    p_session_token: sessionToken,
    p_event_id: input.eventId,
    p_narrative: input.narrative,
    p_highlights: input.highlights,
    p_attachment_submission_id: input.attachmentSubmissionId || null,
  });
}

export async function reviewAccomplishmentReport(
  sessionToken: string,
  reportId: string,
  decision: AccomplishmentDecision,
  remark?: string,
): Promise<ReviewAccomplishmentReportResult> {
  return callRpc<ReviewAccomplishmentReportResult>(
    "review_accomplishment_report",
    {
      p_session_token: sessionToken,
      p_report_id: reportId,
      p_decision: decision,
      p_remark: remark || null,
    },
  );
}
