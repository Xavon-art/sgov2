import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { canManageChart, currentAccount, readSessionToken } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/** The write path is a `SECURITY DEFINER` call into Postgres. */
export const runtime = "nodejs";

/** One chart has a dozen units with a dozen seats each. */
const IP_LIMIT = 240;
const IP_WINDOW_MS = 10 * 60_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AssignSeatResponse = {
  ok: boolean;
  reason?: string;
  message?: string;
  membershipId?: string;
  unitId?: string;
  positionId?: string;
  rosterId?: string;
};

/**
 * Seats an existing roster member in a vacant seat.
 *
 * All three ids are resolved against the caller's organization inside the
 * function, because a uuid is guessable and none of the tables carries an
 * organization of its own; the shape check here only keeps an id that is not
 * a uuid from becoming a cast error in Postgres.
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

  let body: { unitId?: string; positionId?: string; rosterId?: string };
  try {
    body = (await req.json()) as { unitId?: string; positionId?: string; rosterId?: string };
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const limit = rateLimit(`org-chart:assign:ip:${clientIp(req)}`, IP_LIMIT, IP_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, reason: "rate_limited", message: messageFor("rate_limited") },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const unitId = typeof body.unitId === "string" ? body.unitId : "";
  const positionId = typeof body.positionId === "string" ? body.positionId : "";
  const rosterId = typeof body.rosterId === "string" ? body.rosterId : "";

  if (!UUID.test(unitId) || !UUID.test(positionId) || !UUID.test(rosterId)) {
    return NextResponse.json(
      { ok: false, reason: "invalid_request", message: messageFor("invalid_request") },
      { status: 400 },
    );
  }

  try {
    const res = await callRpc<
      RpcResult & {
        membershipId?: string;
        unitId?: string;
        positionId?: string;
        rosterId?: string;
      }
    >("assign_officer", {
      p_session_token: token,
      p_unit_id: unitId,
      p_position_id: positionId,
      p_roster_id: rosterId,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, reason: res.reason, message: messageFor(res.reason) },
        { status: res.reason === "forbidden" ? 403 : 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      membershipId: res.membershipId,
      unitId: res.unitId,
      positionId: res.positionId,
      rosterId: res.rosterId,
    });
  } catch (error) {
    console.error("[org-chart:assign]", error);
    return NextResponse.json(
      { ok: false, message: "We could not assign that seat." },
      { status: 500 },
    );
  }
}
