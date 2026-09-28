import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { hmacOtp, otpCode } from "@/lib/auth/crypto";
import { maskEmail, messageFor } from "@/lib/auth/messages";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { sendBranded } from "@/lib/mail/send";
import { otpEmail } from "@/lib/mail/templates";

export const runtime = "nodejs";

const OTP_MINUTES = 15;

/**
 * Account creation is a one-shot per person, so nothing legitimate comes close
 * to this. The database already caps it at five per address per hour; this sits
 * above that only to keep a spray across many addresses from ever reaching the
 * function in the first place.
 */
const IP_LIMIT = 8;
const IP_WINDOW_MS = 10 * 60_000;

type OwnerBody = {
  email?: string;
  password?: string;
  displayName?: string;
  accountKind?: "usg" | "central";
  organizationId?: string | null;
  universityName?: string;
  campusName?: string;
};

/**
 * Step 1 of the USG flow: create the registration, then mail a passcode.
 *
 * The account is created in `pending` — the `verifyToken` returned here is the
 * only way to feed the OTP back in — and only becomes `active` once
 * `/api/auth/verify-owner` succeeds. "Approval" is precisely that: proving the
 * registration email belongs to the person who registered.
 *
 * Unlike the invited flow, the session is NOT minted here: `login_account`
 * refuses `pending` accounts, and approving the code on the client re-runs
 * `login_account` through the existing login route, so sign-in is only possible
 * after approval.
 *
 * The code is never returned to the caller — it exists in the mail and in the
 * HMAC that was stored. If the code email fails, the registration still exists,
 * so the response says `canResend` and the client offers a retry rather than a
 * dead end.
 */
export async function POST(req: Request) {
  let body: OwnerBody;
  try {
    body = (await req.json()) as OwnerBody;
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const limit = rateLimit(`register:ip:${clientIp(req)}`, IP_LIMIT, IP_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, message: messageFor("rate_limited") },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const email = body.email?.trim() ?? "";
  const password = body.password ?? "";

  try {
    const created = await callRpc<RpcResult>("create_owner_account", {
      p_payload: {
        email,
        password,
        displayName: body.displayName?.trim() ?? "",
        accountKind: body.accountKind === "central" ? "central" : "usg",
        organizationId: body.organizationId ?? null,
        universityName: body.universityName?.trim() ?? "",
        campusName: body.campusName?.trim() ?? "",
      },
    });

    if (!created.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(created.reason) },
        { status: 400 },
      );
    }

    const verifyToken = typeof created.verifyToken === "string" ? created.verifyToken : "";
    if (!verifyToken) {
      return NextResponse.json(
        { ok: false, message: "We could not start verification. Please try again." },
        { status: 500 },
      );
    }

    const code = otpCode();

    const stored = await callRpc<boolean>("set_owner_otp", {
      p_verify_token: verifyToken,
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
          organizationName: String(created.organizationName ?? ""),
          campusName: String(created.campusName ?? ""),
          minutes: OTP_MINUTES,
        }),
      );
    } catch (mailError) {
      console.error("[register:otp-email]", mailError);
      return NextResponse.json({
        ok: true,
        code: "email_failed",
        canResend: true,
        verifyToken,
        email: maskEmail(email),
        organizationName: String(created.organizationName ?? ""),
        message: "Your registration was saved but the code did not send. Use “Send the code again” below.",
      });
    }

    return NextResponse.json({
      ok: true,
      verifyToken,
      email: maskEmail(email),
      organizationName: String(created.organizationName ?? ""),
    });
  } catch (error) {
    console.error("[register]", error);
    return NextResponse.json(
      { ok: false, message: "We could not finish setting up the account." },
      { status: 500 },
    );
  }
}