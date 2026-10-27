import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { maybeSweep } from "@/lib/scheduler";

export const runtime = "nodejs";

export async function GET() {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }
  // The bell polls this endpoint, so it is the cheapest place to keep the
  // lazy sweep warm without adding a write to every page render.
  maybeSweep();
  try {
    const res = await callRpc<RpcResult & { count?: number }>("unread_notification_count", {
      p_session_token: token,
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, message: messageFor(res.reason) }, { status: 400 });
    }
    return NextResponse.json({ ok: true, count: res.count ?? 0 });
  } catch (error) {
    console.error("[notifications:unread]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}