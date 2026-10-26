import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

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

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string; qid: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }
  const { qid } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  try {
    const res = await callRpc<RpcResult>("update_survey_question", {
      p_session_token: token,
      p_question_id: qid,
      p_qtype: typeof body.type === "string" ? body.type : null,
      p_title: typeof body.title === "string" ? body.title.trim() : "",
      p_description: typeof body.description === "string" ? body.description.trim() : null,
      p_required: typeof body.required === "boolean" ? body.required : null,
      p_options: Array.isArray(body.options) ? body.options : null,
      p_scale_min: typeof body.scaleMin === "number" ? body.scaleMin : null,
      p_scale_max: typeof body.scaleMax === "number" ? body.scaleMax : null,
      p_scale_label_low: typeof body.scaleLabelLow === "string" ? body.scaleLabelLow : null,
      p_scale_label_high: typeof body.scaleLabelHigh === "string" ? body.scaleLabelHigh : null,
      p_order_index: typeof body.orderIndex === "number" ? body.orderIndex : null,
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[surveys:question:update]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string; qid: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }
  const { qid } = await ctx.params;
  try {
    const res = await callRpc<RpcResult>("delete_survey_question", {
      p_session_token: token,
      p_question_id: qid,
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[surveys:question:delete]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}