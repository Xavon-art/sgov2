import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { canManageChart, currentAccount, readSessionToken } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/** The write path is a `SECURITY DEFINER` call into Postgres. */
export const runtime = "nodejs";

/** Releasing is one click per seat, far below the assign ceiling. */
const IP_LIMIT = 240;
const IP_WINDOW_MS = 10 * 60_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReleaseSeatResponse = {
  ok: boolean;
  reason?: string;
  message?: string;
  membershipId?: string;
};

/**
 * Empties a seated seat by dating the membership, never deleting it.
 *
 * The membership id is resolved through its unit against the caller's
 * organization inside the function, so a uuid from somebody else's chart
 * answers `not_found` rather than emptying a seat the caller cannot see.
 */
export async function POST(req: Request) {
  const account = await currentAccount();
  if (!account) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  if (!canManageChart(account)) {
    return NextResponse.json(
      { ok: false, reason: "forbidden", message: messageFor("forbidden") },
      { status: 403 },
    );
  }

  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: { membershipId?: string };
  try {
    body = (await req.json()) as { membershipId?: string };
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const limit = rateLimit(`org-chart:release:ip:${clientIp(req)}`, IP_LIMIT, IP_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, reason: "rate_limited", message: messageFor("rate_limited") },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const membershipId = typeof body.membershipId === "string" ? body.membershipId : "";

  if (!UUID.test(membershipId)) {
    return NextResponse.json(
      { ok: false, reason: "invalid_request", message: messageFor("invalid_request") },
      { status: 400 },
    );
  }

  try {
    const res = await callRpc<RpcResult & { membershipId?: string }>("release_officer", {
      p_session_token: token,
      p_membership_id: membershipId,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, reason: res.reason, message: messageFor(res.reason) },
        { status: res.reason === "forbidden" ? 403 : 400 },
      );
    }

    return NextResponse.json({ ok: true, membershipId: res.membershipId });
  } catch (error) {
    console.error("[org-chart:release]", error);
    return NextResponse.json(
      { ok: false, message: "We could not release that seat." },
      { status: 500 },
    );
  }
}
