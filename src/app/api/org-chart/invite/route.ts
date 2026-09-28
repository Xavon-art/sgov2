import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { canManageChart, currentAccount, readSessionToken } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { sendBranded } from "@/lib/mail/send";
import { inviteEmail } from "@/lib/mail/templates";

export const runtime = "nodejs";

/**
 * Same ceiling as `POST /api/invites`: each call writes a row, fills a seat,
 * and hands a letter to the mail transport, and the database applies its own
 * per-session and per-address budgets on top of this one.
 */
const IP_LIMIT = 30;
const IP_WINDOW_MS = 10 * 60_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type InviteSeatResponse = {
  ok: boolean;
  reason?: string;
  message?: string;
  delivered?: boolean;
  code?: string;
  email?: string;
};

/**
 * Invites a new person straight into a vacant seat.
 *
 * The database writes the roster row, the active membership, and the invite
 * in one transaction, so the seat is filled the moment the invite exists and
 * there is no half-sent state for the client to reconstruct. Accepting the
 * invite still has one job left -- link the new account to the roster row --
 * which is why the mailed link and the OTP flow are unchanged from the
 * organization-wide invite.
 *
 * The organization comes from the caller's own account inside the function, so
 * no organization id is read from the body.
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

  let body: {
    email?: string;
    campusName?: string;
    unitType?: string;
    unitId?: string;
    positionId?: string;
  };
  try {
    body = (await req.json()) as {
      email?: string;
      campusName?: string;
      unitType?: string;
      unitId?: string;
      positionId?: string;
    };
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const limit = rateLimit(`org-chart:invite:ip:${clientIp(req)}`, IP_LIMIT, IP_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, reason: "rate_limited", message: messageFor("rate_limited") },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const campusName = typeof body.campusName === "string" ? body.campusName.trim() : "";
  const unitType = body.unitType ?? "lsg";
  const unitId = typeof body.unitId === "string" ? body.unitId : "";
  const positionId = typeof body.positionId === "string" ? body.positionId : "";

  if (!email || !unitId || !positionId) {
    return NextResponse.json(
      { ok: false, reason: "invalid_request", message: messageFor("invalid_request") },
      { status: 400 },
    );
  }

  if (!UUID.test(unitId) || !UUID.test(positionId)) {
    return NextResponse.json(
      { ok: false, reason: "invalid_request", message: messageFor("invalid_request") },
      { status: 400 },
    );
  }

  try {
    const res = await callRpc<
      RpcResult & {
        token?: string;
        email?: string;
        organizationName?: string;
        universityName?: string;
      }
    >("create_invite", {
      p_session_token: token,
      p_email: email,
      p_campus_name: campusName,
      p_unit_type: unitType,
      p_unit_id: unitId,
      p_position_id: positionId,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, reason: res.reason, message: messageFor(res.reason) },
        { status: res.reason === "forbidden" ? 403 : 400 },
      );
    }

    const to = String(res.email);

    try {
      await sendBranded(
        inviteEmail({
          to,
          inviter: account.displayName,
          organizationName: String(res.organizationName ?? ""),
          universityName: String(res.universityName ?? ""),
          campusName,
          token: String(res.token),
        }),
      );
    } catch (mailError) {
      console.error("[org-chart:invite:send]", mailError);
      return NextResponse.json({
        ok: false,
        delivered: false,
        code: "delivery_failed",
        email: to,
        message:
          "The seat was reserved and the invitation recorded, but the email could not be sent. Ask them to check spam, then resend.",
      });
    }

    return NextResponse.json({ ok: true, delivered: true, email: to });
  } catch (error) {
    console.error("[org-chart:invite]", error);
    return NextResponse.json(
      { ok: false, message: "We could not create that invitation." },
      { status: 500 },
    );
  }
}
