import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

type SurveyDetailPayload = RpcResult & {
  survey?: unknown;
  questions?: unknown;
};

function statusForReason(reason?: string): number {
  switch (reason) {
    case "unauthenticated":
      return 401;
    case "rate_limited":
      return 429;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    default:
      return 400;
  }
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await readSessionToken();
  const { id } = await ctx.params;
  const url = new URL(request.url);
  const accessEmail = url.searchParams.get("email") ?? "";

  try {
    const res = await callRpc<SurveyDetailPayload>("get_survey", {
      p_session_token: token ?? null,
      p_survey_id: id,
      p_access_email: accessEmail,
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true, survey: res.survey, questions: res.questions ?? [] });
  } catch (error) {
    console.error("[surveys:get]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }
  const { id } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const allowedEmails = Array.isArray(body.allowedEmails)
    ? (body.allowedEmails as unknown[]).map((e) => String(e).trim().toLowerCase()).filter(Boolean)
    : null;

  const responseLimit =
    typeof body.responseLimit === "number" && body.responseLimit > 0 ? body.responseLimit : null;

  const deadline = typeof body.deadline === "string" && body.deadline ? body.deadline : null;

  try {
    const res = await callRpc<RpcResult>("update_survey", {
      p_session_token: token,
      p_survey_id: id,
      p_title: typeof body.title === "string" ? body.title.trim() : "",
      p_description: typeof body.description === "string" ? body.description.trim() : null,
      p_access_mode: typeof body.accessMode === "string" ? body.accessMode : null,
      p_allowed_emails: allowedEmails,
      p_response_limit: responseLimit,
      p_deadline: deadline,
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[surveys:update]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }
  const { id } = await ctx.params;
  try {
    const res = await callRpc<RpcResult>("delete_survey", { p_session_token: token, p_survey_id: id });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[surveys:delete]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}