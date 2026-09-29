import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { currentAccount, readSessionToken } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { sendBranded } from "@/lib/mail/send";
import { inviteEmail } from "@/lib/mail/templates";

export const runtime = "nodejs";

/**
 * Owner re-invites someone over email: a fresh link replaces the old one (the
 * old link dies immediately) and the clock resets to a fresh 14 days, so the
 * invite row keeps its audit history instead of being re-created. Resending
 * costs a letter, hence a tighter per-IP budget than cancel (20 vs 60 over the
 * same 10 minutes).
 *
 * Every caller behind one egress shares this bucket, and so does anyone whose
 * `X-Forwarded-For` cannot be read -- deliberately, since every resend costs a
 * letter and a campus NAT is not a single person.
 */
const IP_LIMIT = 20;
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

  const limit = rateLimit(`invite:resend:ip:${clientIp(req)}`, IP_LIMIT, IP_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, message: messageFor("rate_limited") },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const account = await currentAccount();

    const res = await callRpc<RpcResult & {
      token?: string;
      email?: string;
      campusName?: string;
      organizationName?: string;
      universityName?: string;
    }>("resend_invite", {
      p_session_token: token,
      p_invite_id: inviteId,
    });

    if (!res.ok) {
      const status = res.reason === "forbidden" ? 403 : res.reason === "unauthenticated" ? 401 : res.reason === "rate_limited" ? 429 : 400;
      return NextResponse.json({ ok: false, message: messageFor(res.reason) }, { status });
    }

    try {
      await sendBranded(
        inviteEmail({
          to: String(res.email),
          inviter: account?.displayName ?? "Your student government",
          organizationName: String(res.organizationName ?? ""),
          universityName: String(res.universityName ?? ""),
          campusName: String(res.campusName ?? ""),
          token: String(res.token),
        }),
      );
    } catch (mailError) {
      // Unlike create, the old link is already dead: `resend_invite` rotated
      // the token before this point, so nothing was delivered *and* the link
      // the invitee holds no longer works. Say so rather than sending them to
      // a spam folder that has nothing new in it.
      console.error("[invites:resend:mail]", mailError);
      return NextResponse.json({
        ok: false,
        delivered: false,
        code: "delivery_failed",
        email: String(res.email),
        message: "The old link no longer works and the new email could not be sent. Please resend in a moment.",
      });
    }

    return NextResponse.json({ ok: true, delivered: true, email: String(res.email) });
  } catch (error) {
    console.error("[invites:resend]", error);
    return NextResponse.json(
      { ok: false, message: "We could not resend that invitation." },
      { status: 500 },
    );
  }
}
