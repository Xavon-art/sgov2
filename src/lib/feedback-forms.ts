import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import type {
  FeedbackFormInput,
  FeedbackQuestionInput,
  FeedbackSubmissionInput,
} from "@/lib/feedback-forms-schema";

export type {
  FeedbackFormInput,
  FeedbackQuestionInput,
  FeedbackSubmissionInput,
} from "@/lib/feedback-forms-schema";

export type FeedbackFormStatus = "draft" | "open" | "closed";
export type FeedbackAccessMode = "signed_in" | "public_link";
export type FeedbackIdentityMode = "identified" | "anonymous";
export type FeedbackScope = "university" | "unit_type" | "units" | "unit";
export type FeedbackQtype =
  | "short_text"
  | "long_text"
  | "multiple_choice"
  | "checkbox"
  | "dropdown"
  | "rating"
  | "linear_scale"
  | "date"
  | "time";
export type FeedbackFieldKey =
  | "full_name"
  | "email"
  | "student_number"
  | "year_level"
  | "program"
  | "section"
  | "campus";

export type FeedbackQuestion = FeedbackQuestionInput & {
  id: string;
  orderIndex: number;
};

export type FeedbackFormScope = {
  unitType: string | null;
  unitId: string | null;
};

export type FeedbackForm = {
  id: string;
  title: string;
  description: string | null;
  status: FeedbackFormStatus;
  scope: FeedbackScope;
  accessMode: FeedbackAccessMode;
  identityMode: FeedbackIdentityMode;
  createdAt: string;
  updatedAt: string;
  openedAt: string | null;
  closedAt: string | null;
  responseCount: number;
  questionCount: number;
  questionsLocked: boolean;
  canManage: boolean;
  canReview: boolean;
  publicPath: string | null;
};

export type FeedbackFormSummary = {
  id: string;
  title: string;
  description: string | null;
  status: FeedbackFormStatus;
  scope: FeedbackScope;
  accessMode: FeedbackAccessMode;
  identityMode: FeedbackIdentityMode;
  audienceSummary: string;
  responseCount: number;
  questionCount: number;
  canManage: boolean;
  canReview: boolean;
  publicPath: string | null;
  createdAt: string;
  openedAt: string | null;
  closedAt: string | null;
};

export type FeedbackResponseStatus = "new" | "acknowledged";

export type FeedbackResponse = {
  id: string;
  status: FeedbackResponseStatus;
  submittedAt: string;
  acknowledgedAt: string | null;
  answers: Record<string, unknown>;
  submittedBy: string | null;
  respondentName: string | null;
  respondentEmail: string | null;
};

export type FeedbackResponseForm = {
  id: string;
  title: string;
  status: FeedbackFormStatus;
  identityMode: FeedbackIdentityMode;
  responseCount: number;
};

export type FeedbackAvailableForm = {
  id: string;
  title: string;
  description: string | null;
  scope: FeedbackAccessMode;
  questionCount: number;
  createdAt: string;
};

export type FeedbackRespondForm = {
  id: string;
  title: string;
  description: string | null;
  scope: FeedbackAccessMode;
  identityMode: FeedbackIdentityMode;
  questionCount: number;
  createdAt: string;
  questions: FeedbackQuestion[];
};

export type PublicFeedbackFormData = {
  title: string;
  description: string | null;
  identityMode: FeedbackIdentityMode;
  questions: FeedbackQuestion[];
};

export type ListFeedbackFormsResult = RpcResult & {
  rows?: FeedbackFormSummary[];
};

export type GetFeedbackFormResult = RpcResult & {
  form?: FeedbackForm;
  scopes?: FeedbackFormScope[];
  questions?: FeedbackQuestion[];
};

export type CreateFeedbackFormResult = RpcResult & { formId?: string };

export type UpdateFeedbackFormResult = RpcResult;

export type SaveQuestionsResult = RpcResult & { count?: number };

export type SetFormStatusResult = RpcResult & {
  status?: "open" | "closed";
  publicPath?: string | null;
};

export type LinkResult = RpcResult & { publicPath?: string };

export type DeleteResult = RpcResult;

export type ListResponsesResult = RpcResult & {
  form?: FeedbackResponseForm;
  questions?: FeedbackQuestion[];
  responses?: FeedbackResponse[];
};

export type AcknowledgeResult = RpcResult & {
  status?: FeedbackResponseStatus;
};

export type ListAvailableResult = RpcResult & {
  forms?: FeedbackAvailableForm[];
};

export type GetForResponseResult = RpcResult & {
  form?: FeedbackRespondForm;
};

export type SubmitResponseResult = RpcResult & { responseId?: string };

export type PublicFormResult = RpcResult & {
  form?: PublicFeedbackFormData;
};

export function feedbackHttpStatus(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "forbidden") return 403;
  if (reason === "not_found") return 404;
  if (
    reason === "questions_locked" ||
    reason === "form_locked" ||
    reason === "responses_exist"
  ) {
    return 409;
  }
  if (reason === "rate_limited") return 429;
  return 400;
}

export function feedbackPublicHttpStatus(reason?: string): number {
  if (reason === "invalid_slug" || reason === "not_found") return 404;
  return feedbackHttpStatus(reason);
}

export function feedbackFormInputMessage(error: {
  issues: { path: PropertyKey[] }[];
}): string {
  const first = error.issues[0]?.path[0];
  if (first === "title") return "invalid_form_title";
  if (first === "description") return "invalid_form_description";
  return "invalid_audience";
}

export async function listFeedbackForms(
  sessionToken: string,
): Promise<ListFeedbackFormsResult> {
  return callRpc<ListFeedbackFormsResult>("list_feedback_forms", {
    p_session_token: sessionToken,
  });
}

export async function getFeedbackForm(
  sessionToken: string,
  formId: string,
): Promise<GetFeedbackFormResult> {
  return callRpc<GetFeedbackFormResult>("get_feedback_form", {
    p_session_token: sessionToken,
    p_form_id: formId,
  });
}

export async function createFeedbackForm(
  sessionToken: string,
  input: FeedbackFormInput,
): Promise<CreateFeedbackFormResult> {
  return callRpc<CreateFeedbackFormResult>("create_feedback_form", {
    p_session_token: sessionToken,
    p_title: input.title,
    p_description: input.description,
    p_scope: input.scope,
    p_unit_ids: input.unitIds,
    p_unit_types: input.unitTypes,
    p_access_mode: input.accessMode,
    p_identity_mode: input.identityMode,
  });
}

export async function updateFeedbackForm(
  sessionToken: string,
  formId: string,
  input: FeedbackFormInput,
): Promise<UpdateFeedbackFormResult> {
  return callRpc<UpdateFeedbackFormResult>("update_feedback_form", {
    p_session_token: sessionToken,
    p_form_id: formId,
    p_title: input.title,
    p_description: input.description,
    p_scope: input.scope,
    p_unit_ids: input.unitIds,
    p_unit_types: input.unitTypes,
    p_access_mode: input.accessMode,
    p_identity_mode: input.identityMode,
  });
}

export async function saveFeedbackQuestions(
  sessionToken: string,
  formId: string,
  questions: FeedbackQuestionInput[],
): Promise<SaveQuestionsResult> {
  return callRpc<SaveQuestionsResult>("save_feedback_questions", {
    p_session_token: sessionToken,
    p_form_id: formId,
    p_questions: questions,
  });
}

export async function setFeedbackFormStatus(
  sessionToken: string,
  formId: string,
  status: "open" | "closed",
): Promise<SetFormStatusResult> {
  return callRpc<SetFormStatusResult>("set_feedback_form_status", {
    p_session_token: sessionToken,
    p_form_id: formId,
    p_status: status,
  });
}

export async function regenerateFeedbackLink(
  sessionToken: string,
  formId: string,
): Promise<LinkResult> {
  return callRpc<LinkResult>("regenerate_feedback_link", {
    p_session_token: sessionToken,
    p_form_id: formId,
  });
}

export async function deleteFeedbackForm(
  sessionToken: string,
  formId: string,
): Promise<DeleteResult> {
  return callRpc<DeleteResult>("delete_feedback_form", {
    p_session_token: sessionToken,
    p_form_id: formId,
  });
}

export async function listFeedbackResponses(
  sessionToken: string,
  formId: string,
): Promise<ListResponsesResult> {
  return callRpc<ListResponsesResult>("list_feedback_responses", {
    p_session_token: sessionToken,
    p_form_id: formId,
  });
}

export async function acknowledgeFeedbackResponse(
  sessionToken: string,
  _formId: string,
  responseId: string,
): Promise<AcknowledgeResult> {
  return callRpc<AcknowledgeResult>("acknowledge_feedback_response", {
    p_session_token: sessionToken,
    p_response_id: responseId,
  });
}

export async function listAvailableFeedbackForms(
  sessionToken: string,
): Promise<ListAvailableResult> {
  return callRpc<ListAvailableResult>("list_available_feedback_forms", {
    p_session_token: sessionToken,
  });
}

export async function getFeedbackFormForResponse(
  sessionToken: string,
  formId: string,
): Promise<GetForResponseResult> {
  return callRpc<GetForResponseResult>("get_feedback_form_for_response", {
    p_session_token: sessionToken,
    p_form_id: formId,
  });
}

export async function submitFeedbackResponse(
  sessionToken: string,
  formId: string,
  input: FeedbackSubmissionInput,
): Promise<SubmitResponseResult> {
  return callRpc<SubmitResponseResult>("submit_feedback_response", {
    p_session_token: sessionToken,
    p_form_id: formId,
    p_answers: input.answers,
    p_respondent_name: input.respondentName,
    p_respondent_email: input.respondentEmail,
  });
}

export async function getPublicFeedbackForm(
  slug: string,
): Promise<PublicFormResult> {
  return callRpc<PublicFormResult>("get_public_feedback_form", {
    p_slug: slug,
  });
}

export async function submitPublicFeedbackResponse(
  slug: string,
  input: FeedbackSubmissionInput,
): Promise<SubmitResponseResult> {
  return callRpc<SubmitResponseResult>("submit_public_feedback_response", {
    p_slug: slug,
    p_answers: input.answers,
    p_respondent_name: input.respondentName,
    p_respondent_email: input.respondentEmail,
  });
}
