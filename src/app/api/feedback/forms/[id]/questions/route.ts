import { NextResponse } from "next/server";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { UUID_RE } from "@/lib/feedback";
import {
  feedbackHttpStatus,
  saveFeedbackQuestions,
} from "@/lib/feedback-forms";
import { feedbackQuestionsSchema } from "@/lib/feedback-forms-schema";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: messageFor("invalid_questions") },
      { status: 400 },
    );
  }

  const parsed = feedbackQuestionsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        message: messageFor("invalid_questions"),
        reason: "invalid_questions",
      },
      { status: 400 },
    );
  }

  try {
    const res = await saveFeedbackQuestions(token, id, parsed.data.questions);
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: feedbackHttpStatus(res.reason) },
      );
    }
    return NextResponse.json({ ok: true, count: res.count ?? 0 });
  } catch (error) {
    console.error("[feedback-forms:questions]", error);
    return NextResponse.json(
      { ok: false, message: "We could not save the questions." },
      { status: 500 },
    );
  }
}
