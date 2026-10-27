import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 50);

  try {
    const res = await callRpc<RpcResult & { notifications?: unknown; unreadCount?: number }>(
      "list_notifications",
      { p_session_token: token, p_limit: limit },
    );
    if (!res.ok) {
      return NextResponse.json({ ok: false, message: messageFor(res.reason) }, { status: 400 });
    }
    return NextResponse.json({ ok: true, notifications: res.notifications ?? [], unreadCount: res.unreadCount ?? 0 });
  } catch (error) {
    console.error("[notifications:list]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}