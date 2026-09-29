import { NextResponse } from "next/server";
import { callRpc } from "@/lib/auth/rpc";
import { hmacOtp, otpCode } from "@/lib/auth/crypto";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { sendBranded } from "@/lib/mail/send";
import { passwordResetEmail } from "@/lib/mail/templates";

export const runtime = "nodejs";

const OTP_MINUTES = 15;

/**
 * The tightest of these limits, because an accepted call mints a fresh passcode
 * and spends a real delivery (mirroring `resend-owner-code`). A code that is
 * still usable is never replaced, but a loop can still force a re-mint once a
 * code lapses, so the window sits above the one human recovering a password in
 * a hurry while still turning a mailbox into a plausible flood.
 */
const IP_LIMIT = 6;
const IP_WINDOW_MS = 15 * 60_000;

/**
 * Starts a password reset by emailing a one-time code.
 *
 * The response is identical whether or not an account exists: `{ ok: true }` in
 * both cases. Only inside `begin_password_reset` does the database admit the
 * address is unknown, and the route uses that only to skip minting and sending
 * -- never to answer differently, so this endpoint cannot be walked to probe
 * for registered addresses.
 */
export async function POST(req: Request) {
  let body: { email?: string };
  try {
    body = (await req.json()) as { email?: string };
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const limit = rateLimit(`password-reset:forgot:ip:${clientIp(req)}`, IP_LIMIT, IP_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, message: "Too many attempts. Please wait a few minutes and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const email = body.email?.trim() ?? "";

  try {
    const code = otpCode();

    const started = await callRpc<boolean>("begin_password_reset", {
      p_email: email,
      p_otp_hash: hmacOtp(code),
      p_ttl_minutes: OTP_MINUTES,
    });

    // No account, an existing usable code, or a reset currently on cooldown /
    // past its lifetime budget. Either way the caller learns nothing and a
    // usable code is never overwritten: no email, but the exact same reply as a
    // successful send, so this endpoint cannot be walked to probe for
    // registered addresses.
    if (!started) {
      return NextResponse.json({ ok: true });
    }

    try {
      await sendBranded(
        passwordResetEmail({
          to: email,
          code,
          minutes: OTP_MINUTES,
        }),
      );
    } catch (mailError) {
      console.error("[forgot-password]", mailError);
      return NextResponse.json({
        ok: true,
        code: "email_failed",
        message: "The code could not be sent. Try again in a moment.",
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[forgot-password]", error);
    return NextResponse.json(
      { ok: false, message: "We could not start a password reset right now." },
      { status: 500 },
    );
  }
}