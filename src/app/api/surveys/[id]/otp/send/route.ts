import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { drainPendingEmails } from "@/lib/mail/send";

export const runtime = "nodejs";

function statusForReason(reason?: string): number {
  switch (reason) {
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "rate_limited":
      return 429;
    default:
      return 400;
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { email?: string };
  try { body = (await req.json()) as { email?: string }; } catch { body = {}; }
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ ok: false, message: "Enter a valid email." }, { status: 400 });
  }
  try {
    const res = await callRpc<RpcResult>("create_survey_otp", {
      p_survey_id: id,
      p_email: email,
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }
    await drainPendingEmails(10, 2);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[survey-otp-send]", error);
    return NextResponse.json({ ok: false, message: "Could not send code." }, { status: 500 });
  }
}
