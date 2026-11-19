import { NextResponse } from "next/server";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { UUID_RE } from "@/lib/feedback";
import {
  feedbackHttpStatus,
  listFeedbackResponses,
  type FeedbackResponse,
} from "@/lib/feedback-forms";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function sanitizeCsvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  if (text.includes(String.fromCharCode(34)) || /[\n\r]/.test(text)) {
    text = `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function answerText(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join("; ");
  if (value === null || value === undefined) return "";
  return String(value);
}

function responseRow(
  formIdentity: string,
  response: FeedbackResponse,
  questionIds: string[],
): string[] {
  const answers =
    response.answers && typeof response.answers === "object"
      ? response.answers
      : {};
  return [
    response.submittedAt,
    response.status,
    formIdentity === "anonymous" ? "" : (response.respondentName ?? ""),
    formIdentity === "anonymous" ? "" : (response.respondentEmail ?? ""),
    ...questionIds.map((questionId) =>
      answerText((answers as Record<string, unknown>)[questionId]),
    ),
  ];
}

export async function GET(_request: Request, context: RouteContext) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json(
      { ok: false, message: "Sign in to continue." },
      { status: 401 },
    );
  }

  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { ok: false, message: "That feedback form reference is not valid." },
      { status: 400 },
    );
  }

  try {
    const res = await listFeedbackResponses(token, id);
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: feedbackHttpStatus(res.reason) },
      );
    }

    const form = res.form;
    const questions = res.questions ?? [];
    const responses = res.responses ?? [];
    if (!form) {
      return NextResponse.json(
        { ok: false, message: messageFor("not_found") },
        { status: 404 },
      );
    }

    const header = [
      "submitted_at",
      "status",
      "respondent_name",
      "respondent_email",
      ...questions.map((question) => question.title),
    ];
    const questionIds = questions.map((question) => question.id);
    const lines = [
      header.map(sanitizeCsvCell).join(","),
      ...responses.map((response) =>
        responseRow(form.identityMode, response, questionIds)
          .map(sanitizeCsvCell)
          .join(","),
      ),
    ];

    return new Response(lines.join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="feedback-${id}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[feedback-forms:export]", error);
    return NextResponse.json(
      { ok: false, message: "We could not export the responses." },
      { status: 500 },
    );
  }
}
