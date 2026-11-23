import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { setSessionCookie } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Tokens are 24 random bytes, so guessing is hopeless; this limit exists only
 * so one flagged mailbox cannot hammer Postgres.
 */
const IP_LIMIT = 12;
const IP_WINDOW_MS = 10 * 60_000;

type ActivationResult = RpcResult & { token?: string };

/**
 * The target of the "Activate my USG account" button in the registration email.
 *
 * `activate_owner` flips the pending registration to `active` and mints the
 * session in one step, so this page only has to set the cookie and hand the
 * person to their dashboard — they are signed in as the USG federated account
 * with no password entry. If the link is used twice, the second visit finds the
 * account already active and still lands on the dashboard.
 *
 * A failed or unknown token just falls back to sign-in; an active account can
 * get in there, and a genuinely invalid link is better answered by the login
 * form than by an error page.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";

  const limit = rateLimit(`activate:ip:${clientIp(req)}`, IP_LIMIT, IP_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.redirect(new URL("/", url.origin));
  }

  if (!token) {
    return NextResponse.redirect(new URL("/login", url.origin));
  }

  try {
    const res = await callRpc<ActivationResult>("activate_owner", {
      p_verify_token: token,
    });

    if (!res?.ok) {
      return NextResponse.redirect(new URL("/login", url.origin));
    }

    if (typeof res.token === "string" && res.token) {
      await setSessionCookie(res.token);
    }

    return NextResponse.redirect(
      new URL(`/activate/complete?token=${encodeURIComponent(token)}`, url.origin),
    );
  } catch (error) {
    console.error("[activate]", error);
    return NextResponse.redirect(new URL("/login", url.origin));
  }
}