import { callRpc, type RpcResult } from "@/lib/auth/rpc";

export type FeedbackStatus = "new" | "acknowledged";

export type FeedbackEntry = {
  id: string;
  subject: string;
  message: string;
  status: FeedbackStatus;
  createdAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
};

export type CreateFeedbackResult = RpcResult & { id?: string };

export type ListFeedbackResult = RpcResult & { rows?: FeedbackEntry[] };

export type GetFeedbackResult = RpcResult & { item?: FeedbackEntry | null };

export type AcknowledgeFeedbackResult = RpcResult & {
  id?: string;
  status?: FeedbackStatus;
};

export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: "New",
  acknowledged: "Acknowledged",
};

export const FEEDBACK_STATUS_CLASS: Record<FeedbackStatus, string> = {
  new: "border-brass/40 bg-brass-soft/30 text-brass-deep",
  acknowledged: "border-ink/20 bg-ink/[0.06] text-ink",
};

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function formatFeedbackDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-PH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export async function createFeedback(
  sessionToken: string,
  input: { subject: string; message: string },
): Promise<CreateFeedbackResult> {
  return callRpc<CreateFeedbackResult>("create_feedback", {
    p_session_token: sessionToken,
    p_subject: input.subject,
    p_message: input.message,
  });
}

export async function listFeedback(
  sessionToken: string,
): Promise<ListFeedbackResult> {
  return callRpc<ListFeedbackResult>("list_feedback", {
    p_session_token: sessionToken,
  });
}

export async function getFeedback(
  sessionToken: string,
  feedbackId: string,
): Promise<GetFeedbackResult> {
  return callRpc<GetFeedbackResult>("get_feedback", {
    p_session_token: sessionToken,
    p_feedback_id: feedbackId,
  });
}

export async function acknowledgeFeedback(
  sessionToken: string,
  feedbackId: string,
): Promise<AcknowledgeFeedbackResult> {
  return callRpc<AcknowledgeFeedbackResult>("acknowledge_feedback", {
    p_session_token: sessionToken,
    p_feedback_id: feedbackId,
  });
}
