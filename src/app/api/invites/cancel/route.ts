import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Owner revokes an invitation: the row stays for the audit trail but the link
 * and any issued OTP stop working, and the invite leaves the dashboard list.
 * The RPC is idempotent, so double-clicks are safe.
 */
const IP_LIMIT = 60;
const IP_WINDOW_MS = 10 * 60_000;

/** `p_invite_id` is a uuid column, so a malformed id has to be caught here rather
 * than surfacing as a 500 out of the PostgREST cast. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: { inviteId?: string };
  try {
    body = ((await req.json()) ?? {}) as { inviteId?: string };
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const inviteId = typeof body.inviteId === "string" ? body.inviteId : "";
  if (!UUID_RE.test(inviteId)) {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const limit = rateLimit(`invite:cancel:ip:${clientIp(req)}`, IP_LIMIT, IP_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, message: messageFor("rate_limited") },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const res = await callRpc<RpcResult>("revoke_invite", {
      p_session_token: token,
      p_invite_id: inviteId,
    });
    if (!res.ok) {
      const status = res.reason === "forbidden" ? 403 : res.reason === "unauthenticated" ? 401 : res.reason === "rate_limited" ? 429 : 400;
      return NextResponse.json({ ok: false, message: messageFor(res.reason) }, { status });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[invites:cancel]", error);
    return NextResponse.json(
      { ok: false, message: "We could not cancel that invitation." },
      { status: 500 },
    );
  }
}
