import "server-only";

import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import type {
  AccomplishmentDecision,
  AccomplishmentReportDetail,
  AccomplishmentReportRow,
  AccomplishmentReportStatus,
} from "@/lib/accomplishment-reports";

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
    filePaths?: string[];
  },
): Promise<SubmitAccomplishmentReportResult> {
  return callRpc<SubmitAccomplishmentReportResult>("submit_accomplishment_report_v2", {
    p_session_token: sessionToken,
    p_event_id: input.eventId,
    p_narrative: input.narrative,
    p_highlights: input.highlights,
    p_attachment_submission_id: input.attachmentSubmissionId || null,
    p_file_paths: input.filePaths ?? [],
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
      p_decision: decision === "approved" ? "acknowledged" : "returned",
      p_remark: remark || null,
    },
  );
}
