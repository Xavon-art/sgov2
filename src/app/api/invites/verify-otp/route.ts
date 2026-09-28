import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { hmacOtp } from "@/lib/auth/crypto";
import { messageFor } from "@/lib/auth/messages";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * The five-attempt ceiling that `verify_otp` keeps per code is the real guard on
 * guessing; this is deliberately higher, because a shared campus address is
 * where a whole hall of people enters their codes at once, and the response is
 * still a 429 either way.
 */
const IP_LIMIT = 20;
const IP_WINDOW_MS = 10 * 60_000;

/**
 * Step 2 of the invited flow: exchange the emailed code for an active account.
 *
 * Verification is bound to the invite token, so this never accepts an account id
 * from the client. The comparison happens in Postgres against the stored HMAC,
 * which also enforces the five-attempt ceiling.
 */
export async function POST(req: Request) {
  let body: { token?: string; code?: string };
  try {
    body = (await req.json()) as { token?: string; code?: string };
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const limit = rateLimit(`invite:verify-otp:ip:${clientIp(req)}`, IP_LIMIT, IP_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, message: messageFor("rate_limited") },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const code = (body.code ?? "").replace(/\D/g, "");
  if (code.length !== 6) {
    return NextResponse.json(
      { ok: false, message: "Enter the six-digit code from your email." },
      { status: 400 },
    );
  }

  try {
    const res = await callRpc<RpcResult>("verify_otp", {
      p_invite_token: body.token ?? "",
      p_code_hash: hmacOtp(code),
    });

    if (!res.ok) {
      const status = res.reason === "too_many_attempts" ? 429 : 400;
      return NextResponse.json(
        {
          ok: false,
          message: messageFor(res.reason),
          attemptsLeft: res.attemptsLeft,
        },
        { status },
      );
    }

    if (res.alreadyActive === true) {
      return NextResponse.json(
        { ok: true, alreadyActive: true, message: "This account is already active." },
        { status: 200 },
      );
    }

    return NextResponse.json({
      ok: true,
      alreadyActive: false,
      campusName: String(res.campusName ?? ""),
      universityName: String(res.universityName ?? ""),
    });
  } catch (error) {
    console.error("[verify-otp]", error);
    return NextResponse.json(
      { ok: false, message: "We could not verify that code." },
      { status: 500 },
    );
  }
}
