import { NextResponse } from "next/server";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { UUID_RE } from "@/lib/feedback";
import {
  acknowledgeFeedbackResponse,
  feedbackHttpStatus,
} from "@/lib/feedback-forms";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string; responseId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json(
      { ok: false, message: "Sign in to continue." },
      { status: 401 },
    );
  }

  const params = await context.params;
  if (!UUID_RE.test(params.id) || !UUID_RE.test(params.responseId)) {
    return NextResponse.json(
      { ok: false, message: "That feedback reference is not valid." },
      { status: 400 },
    );
  }

  try {
    const res = await acknowledgeFeedbackResponse(
      token,
      params.id,
      params.responseId,
    );
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: feedbackHttpStatus(res.reason) },
      );
    }
    return NextResponse.json({ ok: true, status: res.status });
  } catch (error) {
    console.error("[feedback-forms:acknowledge]", error);
    return NextResponse.json(
      { ok: false, message: "We could not acknowledge that response." },
      { status: 500 },
    );
  }
}
