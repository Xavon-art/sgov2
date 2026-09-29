import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { hmacOtp } from "@/lib/auth/crypto";
import { messageFor } from "@/lib/auth/messages";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * The five-attempt ceiling that `verify_owner_otp` keeps per code is the real
 * guard on guessing; this is deliberately higher, because a shared campus
 * address is where a whole hall of people enters codes at once.
 */
const IP_LIMIT = 20;
const IP_WINDOW_MS = 10 * 60_000;

/**
 * Step 2 of the USG flow: exchange the emailed code for an approved account.
 *
 * Verification is bound to the `verifyToken` the register route handed back
 * once, so this never accepts an account id or email from the client. The
 * comparison happens in Postgres against the stored HMAC, which also enforces
 * the five-attempt ceiling.
 *
 * The session is not minted here. It is minted by re-running `login_account`
 * through the login route, exactly as the register route documents — there is
 * deliberately no RPC that takes an account id and returns a token, and the
 * registrant's password is already held by the client-side flow.
 *
 * No mail goes out here. The emailed passcode already was the activation
 * notice; the dashboard's `recentlyApproved` callout is the in-app half, so the
 * owner is not hit with a second "you were approved" letter for an account they
 * just verified.
 */
export async function POST(req: Request) {
  let body: { verifyToken?: string; code?: string };
  try {
    body = (await req.json()) as { verifyToken?: string; code?: string };
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const limit = rateLimit(`owner:verify-otp:ip:${clientIp(req)}`, IP_LIMIT, IP_WINDOW_MS);
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
    const res = await callRpc<RpcResult>("verify_owner_otp", {
      p_verify_token: body.verifyToken ?? "",
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
        { ok: true, alreadyActive: true, message: "This registration is already approved." },
        { status: 200 },
      );
    }

    return NextResponse.json({
      ok: true,
      alreadyActive: false,
      email: String(res.email),
      accountKind: res.accountKind === "central" ? "central" : "usg",
    });
  } catch (error) {
    console.error("[verify-owner]", error);
    return NextResponse.json(
      { ok: false, message: "We could not verify that code." },
      { status: 500 },
    );
  }
}