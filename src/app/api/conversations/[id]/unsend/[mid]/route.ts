import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string; mid: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }
  const { mid } = await ctx.params;
  try {
    const res = await callRpc<RpcResult>("unsend_message", { p_session_token: token, p_message_id: mid });
    if (!res.ok) {
      return NextResponse.json({ ok: false, message: messageFor(res.reason), reason: res.reason }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[conversations:unsend]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}