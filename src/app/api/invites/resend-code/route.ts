import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { hmacOtp, otpCode } from "@/lib/auth/crypto";
import { maskEmail, messageFor } from "@/lib/auth/messages";
import { sendBranded } from "@/lib/mail/send";
import { otpEmail } from "@/lib/mail/templates";

export const runtime = "nodejs";

const OTP_MINUTES = 15;

/**
 * Re-sends the activation code against a live invite.
 *
 * Needed because the password is already set by the time a code can expire or
 * fail to send, and re-running `accept_invite` would be rejected as
 * `already_registered`. `set_otp` only touches accounts still in `pending`, so
 * this cannot disturb an account that has already activated.
 */
export async function POST(req: Request) {
  let body: { token?: string };
  try {
    body = (await req.json()) as { token?: string };
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const token = body.token ?? "";

  try {
    // Reading the invite first gives a precise reason, and confirms the address
    // the code will go to without needing the account id.
    const probe = await callRpc<RpcResult>("accept_invite_probe", {
      p_token: token,
    });

    if (!probe.ok) {
      return NextResponse.json({ ok: false, message: messageFor(probe.reason) }, { status: 400 });
    }

    const code = otpCode();

    const stored = await callRpc<boolean>("set_otp", {
      p_invite_token: token,
      p_otp_hash: hmacOtp(code),
      p_ttl_minutes: OTP_MINUTES,
    });

    if (!stored) {
      return NextResponse.json(
        {
          ok: false,
          message: "That account has already been activated. Sign in instead.",
        },
        { status: 409 },
      );
    }

    try {
      await sendBranded(
        otpEmail({
          to: String(probe.email),
          code,
          organizationName: String(probe.organizationName ?? ""),
          campusName: String(probe.campusName ?? ""),
          minutes: OTP_MINUTES,
        }),
      );
    } catch (mailError) {
      console.error("[resend-code]", mailError);
      return NextResponse.json({
        ok: false,
        code: "email_failed",
        message: "The code still did not send. Please try again in a moment.",
      });
    }

    return NextResponse.json({ ok: true, email: maskEmail(String(probe.email)) });
  } catch (error) {
    console.error("[resend-code]", error);
    return NextResponse.json(
      { ok: false, message: "We could not send a new code." },
      { status: 500 },
    );
  }
}
