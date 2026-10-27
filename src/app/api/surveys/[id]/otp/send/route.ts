import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { sendBranded } from "@/lib/mail/send";
import crypto from "node:crypto";

export const runtime = "nodejs";

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { email?: string };
  try { body = (await req.json()) as { email?: string }; } catch { body = {}; }
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ ok: false, message: "Enter a valid email." }, { status: 400 });
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  try {
    await callRpc<RpcResult>("create_survey_otp", {
      p_survey_id: id,
      p_email: email,
      p_code_hash: hashCode(code),
      p_ttl_minutes: 10,
    });
    await sendBranded({
      to: email,
      subject: "Your SmartGov survey access code",
      html: `<p>Your access code is <strong>${code}</strong>. It expires in 10 minutes.</p>`,
      text: `Your access code is ${code}. It expires in 10 minutes.`,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[survey-otp-send]", e);
    return NextResponse.json({ ok: false, message: "Could not send code." }, { status: 500 });
  }
}