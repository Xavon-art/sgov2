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

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }
  const { id } = await ctx.params;
  try {
    const res = await callRpc<RpcResult & { responses?: unknown }>("list_survey_responses", {
      p_session_token: token,
      p_survey_id: id,
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true, responses: res.responses ?? [] });
  } catch (error) {
    console.error("[surveys:responses:list]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await readSessionToken();
  const { id } = await ctx.params;
  let body: { accessEmail?: unknown; answers?: unknown; accessProof?: unknown };
  try {
    body = (await request.json()) as { accessEmail?: unknown; answers?: unknown; accessProof?: unknown };
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const accessEmail = typeof body.accessEmail === "string" ? body.accessEmail.trim() : "";
  const accessProof = typeof body.accessProof === "string" ? body.accessProof : "";

  try {
    const res = await callRpc<RpcResult>("submit_survey_response", {
      p_session_token: token ?? null,
      p_survey_id: id,
      p_access_email: accessEmail,
      p_answers: body.answers && typeof body.answers === "object" ? body.answers : {},
      p_access_proof: accessProof || null,
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[surveys:responses:submit]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}