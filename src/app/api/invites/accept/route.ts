import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { hmacOtp, otpCode } from "@/lib/auth/crypto";
import { maskEmail, messageFor } from "@/lib/auth/messages";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { sendBranded } from "@/lib/mail/send";
import { otpEmail } from "@/lib/mail/templates";

export const runtime = "nodejs";

const OTP_MINUTES = 15;

/** One account and one passcode letter per accepted call, so this stays modest. */
const IP_LIMIT = 15;
const IP_WINDOW_MS = 10 * 60_000;

/**
 * Step 1 of the invited flow: set a password, then mail a passcode.
 *
 * The account is created in `pending` here and only becomes `active` once the
 * code is verified, which is what `verify_otp` does. If the code email fails the
 * account still exists, so the response says `canResend` and the client offers a
 * retry rather than a dead end.
 *
 * The code is never returned to the caller -- it exists in the mail and in the
 * HMAC that was stored.
 */
export async function POST(req: Request) {
  let body: { token?: string; password?: string };
  try {
    body = (await req.json()) as { token?: string; password?: string };
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  // No `canResend` here: the retry button would only be refused too, since
  // resending is metered on its own.
  const limit = rateLimit(`invite:accept:ip:${clientIp(req)}`, IP_LIMIT, IP_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, message: messageFor("rate_limited") },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const token = body.token ?? "";
  const password = body.password ?? "";

  try {
    const accepted = await callRpc<RpcResult>("accept_invite", {
      p_token: token,
      p_password: password,
    });

    if (!accepted.ok) {
      return NextResponse.json({ ok: false, message: messageFor(accepted.reason) }, { status: 400 });
    }

    const code = otpCode();
    const email = String(accepted.email);

    const stored = await callRpc<boolean>("set_otp", {
      p_invite_token: token,
      p_otp_hash: hmacOtp(code),
      p_ttl_minutes: OTP_MINUTES,
    });

    if (!stored) {
      return NextResponse.json(
        { ok: false, message: "We could not start verification. Please try again." },
        { status: 500 },
      );
    }

    try {
      await sendBranded(
        otpEmail({
          to: email,
          code,
          organizationName: String(accepted.organizationName ?? ""),
          campusName: String(accepted.campusName ?? ""),
          minutes: OTP_MINUTES,
        }),
      );
    } catch (mailError) {
      console.error("[accept:otp-email]", mailError);
      return NextResponse.json({
        ok: false,
        code: "email_failed",
        canResend: true,
        message:
          "Your password was saved but the code did not send. Use “Send the code again” below.",
      });
    }

    return NextResponse.json({
      ok: true,
      email: maskEmail(email),
      campusName: String(accepted.campusName ?? ""),
    });
  } catch (error) {
    console.error("[accept]", error);
    return NextResponse.json(
      { ok: false, message: "We could not activate that invitation." },
      { status: 500 },
    );
  }
}
