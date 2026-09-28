import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { hmacOtp } from "@/lib/auth/crypto";
import { messageFor } from "@/lib/auth/messages";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Looser than `forgot-password` on purpose: each call here either spends the
 * row's five-attempt budget or revokes every session, and the database's own
 * `consume_rate_limit` already caps it at twenty per account per quarter hour.
 * This layer only stops a spray across many accounts from one host.
 */
const IP_LIMIT = 20;
const IP_WINDOW_MS = 5 * 60_000;

/**
 * Completes a password reset: verifies the emailed code and, on a match,
 * replaces the password and revokes every existing session. A stale code, a
 * wrong code, or a code burned by its own attempt ceiling all come back as a
 * stable `reason`; nothing about whether the account exists is revealed.
 */
export async function POST(req: Request) {
  let body: { email?: string; code?: string; newPassword?: string };
  try {
    body = (await req.json()) as {
      email?: string;
      code?: string;
      newPassword?: string;
    };
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const limit = rateLimit(`password-reset:complete:ip:${clientIp(req)}`, IP_LIMIT, IP_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, message: messageFor("rate_limited") },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const email = body.email?.trim() ?? "";
  const code = body.code?.replace(/\D/g, "") ?? "";
  const newPassword = body.newPassword ?? "";

  if (code.length !== 6) {
    return NextResponse.json(
      { ok: false, message: "Enter the six-digit code from your email." },
      { status: 400 },
    );
  }

  try {
    const res = await callRpc<RpcResult>("complete_password_reset", {
      p_email: email,
      p_code_hash: hmacOtp(code),
      p_new_password: newPassword,
    });

    if (!res.ok) {
      const status = res.reason === "rate_limited" ? 429 : res.reason === "too_many_attempts" ? 423 : 400;
      return NextResponse.json({ ok: false, message: messageFor(res.reason) }, { status });
    }

    return NextResponse.json({ ok: true, email: res.email ?? null });
  } catch (error) {
    console.error("[reset-password]", error);
    return NextResponse.json(
      { ok: false, message: "We could not reset your password right now." },
      { status: 500 },
    );
  }
}