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

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }
  const { id } = await ctx.params;
  let body: { decision?: unknown; note?: unknown };
  try {
    body = (await request.json()) as { decision?: unknown; note?: unknown };
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const decision = typeof body.decision === "string" ? body.decision.trim() : "";
  if (decision !== "honored" && decision !== "rejected") {
    return NextResponse.json({ ok: false, message: "Choose honor or reject." }, { status: 400 });
  }

  try {
    const res = await callRpc<RpcResult>("decide_event", {
      p_session_token: token,
      p_event_id: id,
      p_decision: decision,
      p_note: typeof body.note === "string" ? body.note.trim() : null,
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[events:decide]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}