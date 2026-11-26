import { NextResponse } from "next/server";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { UUID_RE } from "@/lib/feedback";
import {
  canonicalFormsPublicPath,
  feedbackHttpStatus,
  regenerateFeedbackLink,
} from "@/lib/feedback-forms";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
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
    const res = await regenerateFeedbackLink(token, id);
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: feedbackHttpStatus(res.reason) },
      );
    }
    return NextResponse.json({ ok: true, publicPath: canonicalFormsPublicPath(res.publicPath) });
  } catch (error) {
    console.error("[feedback-forms:link]", error);
    return NextResponse.json(
      { ok: false, message: "We could not regenerate the link." },
      { status: 500 },
    );
  }
}
