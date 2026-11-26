import { NextResponse } from "next/server";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { UUID_RE } from "@/lib/feedback";
import {
  canonicalFormsPublicPath,
  deleteFeedbackForm,
  feedbackFormInputMessage,
  feedbackHttpStatus,
  getFeedbackForm,
  updateFeedbackForm,
} from "@/lib/feedback-forms";
import { feedbackFormInputSchema } from "@/lib/feedback-forms-schema";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function invalidId() {
  return NextResponse.json(
    { ok: false, message: "That feedback form reference is not valid." },
    { status: 400 },
  );
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
  if (!UUID_RE.test(id)) return invalidId();

  try {
    const res = await getFeedbackForm(token, id);
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: feedbackHttpStatus(res.reason) },
      );
    }
    return NextResponse.json({
      ok: true,
      form: res.form
        ? { ...res.form, publicPath: canonicalFormsPublicPath(res.form.publicPath) }
        : null,
      scopes: res.scopes ?? [],
      questions: res.questions ?? [],
    });
  } catch (error) {
    console.error("[feedback-forms:detail]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load that form." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json(
      { ok: false, message: "Sign in to continue." },
      { status: 401 },
    );
  }

  const { id } = await context.params;
  if (!UUID_RE.test(id)) return invalidId();

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
    const res = await updateFeedbackForm(token, id, parsed.data);
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: feedbackHttpStatus(res.reason) },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[feedback-forms:update]", error);
    return NextResponse.json(
      { ok: false, message: "We could not update that form." },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json(
      { ok: false, message: "Sign in to continue." },
      { status: 401 },
    );
  }

  const { id } = await context.params;
  if (!UUID_RE.test(id)) return invalidId();

  try {
    const res = await deleteFeedbackForm(token, id);
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: feedbackHttpStatus(res.reason) },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[feedback-forms:delete]", error);
    return NextResponse.json(
      { ok: false, message: "We could not delete that form." },
      { status: 500 },
    );
  }
}
