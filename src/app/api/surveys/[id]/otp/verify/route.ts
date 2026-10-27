import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import crypto from "node:crypto";

export const runtime = "nodejs";

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { email?: string; code?: string };
  try { body = (await req.json()) as { email?: string; code?: string }; } catch { body = {}; }
  const email = String(body.email ?? "").trim().toLowerCase();
  const code = String(body.code ?? "").trim();
  if (!email || !code) {
    return NextResponse.json({ ok: false, message: "Email and code are required." }, { status: 400 });
  }
  try {
    const res = await callRpc<RpcResult>("verify_survey_otp", {
      p_survey_id: id,
      p_email: email,
      p_code_hash: hashCode(code),
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, message: messageFor(res.reason) }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, message: "Could not verify code." }, { status: 500 });
  }
}