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

/** The only `unit_type` values `add_unit` accepts: children of a root USG. */
const TREE_UNIT_TYPES = new Set(["campus", "college", "department"]);

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

  let targetUnitId = unitId === "" ? null : unitId;
  const campusName = body.campusName?.trim() ?? "";

  /* A name with no id does not make a unit. `accept_invite` copies the name onto
     the account and stops, while the seat in the org chart is written by
     `create_invite` only when `p_unit_id` is present -- so on a federated org that
     shape mints an invite for somebody who joins no campus and appears nowhere in
     the chart. `add_unit` is the writer that does create the unit, so an invite
     naming a campus that does not exist yet creates it first and invites into the
     result. Both are owner-gated, so this cannot widen who may extend the tree,
     only what a single request may do.

     Only the three tree types are attempted. `lsg` and `council` are deliberately
     absent: they are seats and tiers rather than children of the root USG, so
     `add_unit` would refuse them, and the centralized branch below already sends
     `lsg` for an org-wide invite that must keep working untouched.

     A duplicate name is refused rather than silently reusing the row. The officer
     is told which unit already exists and can pick it, instead of a typed
     near-match quietly filing somebody under the wrong campus. `unitary_model` is
     the centralized org declining a tree it does not have, and falls through to
     the original org-wide shape unchanged. */
  if (targetUnitId === null && campusName !== "" && TREE_UNIT_TYPES.has(body.unitType ?? "")) {
    try {
      const created = await callRpc<RpcResult & { unitId?: string }>("add_unit", {
        p_session_token: token,
        p_name: campusName,
        p_unit_type: body.unitType as string,
      });

      if (created.ok) {
        targetUnitId = created.unitId ?? null;
      } else if (created.reason === "duplicate_unit_name") {
        return NextResponse.json(
          {
            ok: false,
            reason: created.reason,
            message: `You already have a unit called \u201c${campusName}\u201d. Choose it from the list instead of creating it again.`,
          },
          { status: 409 },
        );
      } else if (created.reason !== "unitary_model") {
        return NextResponse.json(
          { ok: false, reason: created.reason, message: messageFor(created.reason) },
          { status: 400 },
        );
      }
    } catch (error) {
      console.error("[invites:resolve-unit]", error);
      return NextResponse.json(
        { ok: false, message: "We could not create that unit. Please try again." },
        { status: 500 },
      );
    }
  }

  try {
    const res = await callRpc<RpcResult>("create_invite", {
      p_session_token: token,
      p_email: body.email?.trim() ?? "",
      p_campus_name: campusName,
      p_unit_type: body.unitType ?? "lsg",
      p_unit_id: targetUnitId,
    });

    if (!res.ok) {
      return NextResponse.json({ ok: false, message: messageFor(res.reason) }, { status: 400 });
    }

    const to = String(res.email);
    // `create_invite` does not echo the campus back, so the letter is addressed
    // from the name that was validated above -- the unit's name on the
    // units-first flow, the free-text campus on the centralized one.
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
