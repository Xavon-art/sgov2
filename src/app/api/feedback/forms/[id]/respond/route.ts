import { NextResponse } from "next/server";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { UUID_RE } from "@/lib/feedback";
import {
  feedbackHttpStatus,
  getFeedbackFormForResponse,
  submitFeedbackResponse,
} from "@/lib/feedback-forms";
import { feedbackSubmissionSchema } from "@/lib/feedback-forms-schema";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

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
    const res = await getFeedbackFormForResponse(token, id);
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: feedbackHttpStatus(res.reason) },
      );
    }
    return NextResponse.json({ ok: true, form: res.form ?? null });
  } catch (error) {
    console.error("[feedback-forms:respond]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load that feedback form." },
      { status: 500 },
    );
  }
}

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
      { ok: false, message: messageFor("invalid_request") },
      { status: 400 },
    );
  }

  const parsed = feedbackSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        message: messageFor("invalid_answers"),
        reason: "invalid_answers",
      },
      { status: 400 },
    );
  }

  try {
    const res = await submitFeedbackResponse(token, id, parsed.data);
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: feedbackHttpStatus(res.reason) },
      );
    }
    return NextResponse.json({ ok: true, responseId: res.responseId });
  } catch (error) {
    console.error("[feedback-forms:submit]", error);
    return NextResponse.json(
      { ok: false, message: "We could not record your response." },
      { status: 500 },
    );
  }
}
