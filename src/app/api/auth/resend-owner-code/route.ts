import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { maskEmail, messageFor } from "@/lib/auth/messages";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { sendBranded } from "@/lib/mail/send";
import { activationEmail } from "@/lib/mail/templates";

export const runtime = "nodejs";

/**
 * The tightest of these limits, because each accepted call is a real email
 * delivery. `owner_send_activation` keeps its own two-minute cooldown and a
 * five-send budget on the registration, so a caller looping here cannot flood a
 * mailbox either — the deny path just answers honestly instead of mailing.
 */
const IP_LIMIT = 6;
const IP_WINDOW_MS = 15 * 60_000;

/**
 * Re-sends the activation email against a live, still-pending registration.
 *
 * Needed because the registration can finish with the email lost, and re-running
 * `create_owner_account` would be rejected as `email_taken` — the verify token
 * is persistent until activation, so the same link just goes out again.
 * `owner_send_activation` only touches accounts still in `pending`, so this
 * cannot disturb an account that has already been activated.
 */
export async function POST(req: Request) {
  let body: { verifyToken?: string };
  try {
    body = (await req.json()) as { verifyToken?: string };
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const limit = rateLimit(`owner:resend:ip:${clientIp(req)}`, IP_LIMIT, IP_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, message: messageFor("rate_limited") },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const verifyToken = body.verifyToken ?? "";

  try {
    const res = await callRpc<RpcResult>("owner_send_activation", {
      p_verify_token: verifyToken,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason) },
        { status: res.reason === "too_many_attempts" ? 429 : 400 },
      );
    }

    if (res.alreadyActive === true) {
      return NextResponse.json({
        ok: true,
        alreadyActive: true,
        message: "This account is already active — sign in with the email and password you set.",
      });
    }

    if (res.cooldown === true) {
      return NextResponse.json({
        ok: true,
        code: "resend_denied",
        message:
          "A fresh activation email is already waiting — check your inbox and spam. If it still has not arrived, try again in a couple of minutes.",
      });
    }

    try {
      await sendBranded(
        activationEmail({
          to: String(res.email),
          organizationName: String(res.organizationName ?? ""),
          campusName: String(res.campusName ?? ""),
          token: verifyToken,
        }),
      );
    } catch (mailError) {
      console.error("[resend-owner-code]", mailError);
      return NextResponse.json({
        ok: false,
        code: "email_failed",
        message: "The email still did not send. Please try again in a moment.",
      });
    }

    return NextResponse.json({ ok: true, email: maskEmail(String(res.email)) });
  } catch (error) {
    console.error("[resend-owner-code]", error);
    return NextResponse.json(
      { ok: false, message: "We could not send a new email." },
      { status: 500 },
    );
  }
}