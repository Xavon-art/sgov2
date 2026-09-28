import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { currentAccount, readSessionToken } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { sendBranded } from "@/lib/mail/send";
import { inviteEmail } from "@/lib/mail/templates";

export const runtime = "nodejs";

/**
 * Each accepted invite writes a row and hands a letter to the mail transport, so
 * this endpoint is the most expensive per call. The window is set for an officer
 * working through a list by hand; a hall-sized broadcast would need to be
 * batched somewhere else rather than widened here.
 */
const IP_LIMIT = 30;
const IP_WINDOW_MS = 10 * 60_000;

/** `p_unit_id` is a uuid column, so a malformed id has to be caught here rather
 * than surfacing as a 500 out of the PostgREST cast. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type InviteRow = {
  id: string;
  email: string;
  campusName: string;
  unitType: string;
  status: "pending" | "activated" | "expired";
  invitedBy: string;
  createdAt: string;
  activatedAt: string | null;
  expiresAt: string;
};

/** Status feed for the dashboard: who is still pending, who has activated. */
export async function GET() {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  try {
    const res = await callRpc<RpcResult & { invites?: InviteRow[] }>("list_invites", {
      p_session_token: token,
    });

    if (!res.ok) {
      return NextResponse.json({ ok: false, message: messageFor(res.reason) }, { status: 403 });
    }

    return NextResponse.json({ ok: true, invites: res.invites ?? [] });
  } catch (error) {
    console.error("[invites:list]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load your invitations." },
      { status: 500 },
    );
  }
}

/**
 * Invites one person by email and campus.
 *
 * Two shapes reach the same RPC: a unit-scoped, seat-less invite when `unitId`
 * is present (the LSG officer flow, where the unit already exists), and the
 * legacy org-wide invite when it is absent (the name in the body creates the
 * unit). `p_position_id` is left at its default so a unit invite carries no seat.
 *
 * The organization comes from the caller's own account inside the function, so
 * there is no way to invite into somebody else's workspace.
 *
 * A delivery failure is reported as its own outcome rather than an error: the
 * invitation row exists and shows up as pending, so the officer can see it and
 * resend instead of thinking nothing happened.
 */
export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: { email?: string; campusName?: string; unitType?: string; unitId?: string };
  try {
    body = ((await req.json()) ?? {}) as {
      email?: string;
      campusName?: string;
      unitType?: string;
      unitId?: string;
    };
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const unitId = typeof body.unitId === "string" ? body.unitId : "";

  if (unitId !== "" && !UUID_RE.test(unitId)) {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const limit = rateLimit(`invite:create:ip:${clientIp(req)}`, IP_LIMIT, IP_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, message: messageFor("rate_limited") },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const account = await currentAccount();

  try {
    const res = await callRpc<RpcResult>("create_invite", {
      p_session_token: token,
      p_email: body.email?.trim() ?? "",
      p_campus_name: body.campusName?.trim() ?? "",
      p_unit_type: body.unitType ?? "lsg",
      p_unit_id: unitId === "" ? null : unitId,
    });

    if (!res.ok) {
      return NextResponse.json({ ok: false, message: messageFor(res.reason) }, { status: 400 });
    }

    const to = String(res.email);
    // `create_invite` does not echo the campus back, so the letter is addressed
    // from the name that was validated above -- the unit's name on the
    // units-first flow, the free-text campus on the centralized one.
    const campusName = body.campusName?.trim() ?? "";

    try {
      await sendBranded(
        inviteEmail({
          to,
          inviter: account?.displayName ?? "Your student government",
          organizationName: String(res.organizationName ?? ""),
          universityName: String(res.universityName ?? ""),
          campusName,
          token: String(res.token),
        }),
      );
    } catch (mailError) {
      console.error("[invites:send]", mailError);
      return NextResponse.json({
        ok: false,
        delivered: false,
        code: "delivery_failed",
        email: to,
        message:
          "The invitation was recorded but the email could not be sent. Ask them to check spam, then resend.",
      });
    }

    return NextResponse.json({ ok: true, delivered: true, email: to });
  } catch (error) {
    console.error("[invites:create]", error);
    return NextResponse.json(
      { ok: false, message: "We could not create that invitation." },
      { status: 500 },
    );
  }
}
