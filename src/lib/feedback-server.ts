import "server-only";

import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import type { FeedbackEntry, FeedbackStatus } from "@/lib/feedback";

export type CreateFeedbackResult = RpcResult & { id?: string };

export type ListFeedbackResult = RpcResult & { rows?: FeedbackEntry[] };

export type GetFeedbackResult = RpcResult & { item?: FeedbackEntry | null };

export type AcknowledgeFeedbackResult = RpcResult & {
  id?: string;
  status?: FeedbackStatus;
};

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
