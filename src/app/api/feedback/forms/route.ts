import { NextResponse } from "next/server";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import {
  canonicalFormsPublicPath,
  createFeedbackForm,
  feedbackFormInputMessage,
  feedbackHttpStatus,
  listFeedbackForms,
} from "@/lib/feedback-forms";
import { feedbackFormInputSchema } from "@/lib/feedback-forms-schema";

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
    const res = await listFeedbackForms(token);
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: feedbackHttpStatus(res.reason) },
      );
    }
    return NextResponse.json({
      ok: true,
      rows: (res.rows ?? []).map((row) => ({
        ...row,
        publicPath: canonicalFormsPublicPath(row.publicPath),
      })),
    });
  } catch (error) {
    console.error("[feedback-forms:list]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load the forms." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json(
      { ok: false, message: "Sign in to continue." },
      { status: 401 },
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

  const parsed = feedbackFormInputSchema.safeParse(body);
  if (!parsed.success) {
    const reason = feedbackFormInputMessage(parsed.error);
    return NextResponse.json(
      { ok: false, message: messageFor(reason), reason },
      { status: 400 },
    );
  }

  try {
    const res = await createFeedbackForm(token, parsed.data);
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: feedbackHttpStatus(res.reason) },
      );
    }
    return NextResponse.json({ ok: true, formId: res.formId });
  } catch (error) {
    console.error("[feedback-forms:create]", error);
    return NextResponse.json(
      { ok: false, message: "We could not create the form." },
      { status: 500 },
    );
  }
}
