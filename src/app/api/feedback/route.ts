import { NextResponse } from "next/server";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import {
  createFeedback,
  listFeedback,
  type FeedbackEntry,
} from "@/lib/feedback";

export const runtime = "nodejs";

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "forbidden") return 403;
  if (reason === "not_found") return 404;
  return 400;
}

export async function GET() {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  try {
    const res = await listFeedback(token);
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true, rows: (res.rows ?? []) as FeedbackEntry[] });
  } catch (error) {
    console.error("[feedback:list]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load feedback." },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: { subject?: unknown; message?: unknown } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json(
      { ok: false, message: "Send the feedback as JSON." },
      { status: 400 },
    );
  }

  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  if (subject.length < 3 || subject.length > 160) {
    return NextResponse.json(
      { ok: false, message: messageFor("invalid_feedback_subject"), reason: "invalid_feedback_subject" },
      { status: 400 },
    );
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (message.length < 10 || message.length > 8000) {
    return NextResponse.json(
      { ok: false, message: messageFor("invalid_message"), reason: "invalid_message" },
      { status: 400 },
    );
  }

  try {
    const res = await createFeedback(token, { subject, message });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true, id: res.id });
  } catch (error) {
    console.error("[feedback:create]", error);
    return NextResponse.json(
      { ok: false, message: "We could not send that feedback." },
      { status: 500 },
    );
  }
}
