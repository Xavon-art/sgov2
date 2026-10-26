import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function GET() {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }
  try {
    const res = await callRpc<RpcResult & { accounts?: unknown }>("list_org_accounts", {
      p_session_token: token,
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, message: messageFor(res.reason), reason: res.reason }, { status: 400 });
    }
    return NextResponse.json({ ok: true, accounts: res.accounts ?? [] });
  } catch (error) {
    console.error("[org-accounts:list]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}