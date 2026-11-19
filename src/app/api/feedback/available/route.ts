import { NextResponse } from "next/server";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import {
  feedbackHttpStatus,
  listAvailableFeedbackForms,
} from "@/lib/feedback-forms";

export const runtime = "nodejs";

export async function GET() {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json(
      { ok: false, message: "Sign in to continue." },
      { status: 401 },
    );
  }

  try {
    const res = await listAvailableFeedbackForms(token);
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: feedbackHttpStatus(res.reason) },
      );
    }
    return NextResponse.json({ ok: true, forms: res.forms ?? [] });
  } catch (error) {
    console.error("[feedback-forms:available]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load the available forms." },
      { status: 500 },
    );
  }
}
