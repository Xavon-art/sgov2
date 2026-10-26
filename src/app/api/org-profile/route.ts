import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }
  let body: { accent?: unknown; theme?: unknown; logoUrl?: unknown };
  try {
    body = (await request.json()) as { accent?: unknown; theme?: unknown; logoUrl?: unknown };
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  try {
    const res = await callRpc<RpcResult>("update_org_profile", {
      p_session_token: token,
      p_accent: typeof body.accent === "string" ? body.accent.trim() : null,
      p_theme: typeof body.theme === "string" ? body.theme.trim() : null,
      p_logo_url: typeof body.logoUrl === "string" ? body.logoUrl.trim() : null,
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[org-profile:update]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}