import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { canManageChart, currentAccount, readSessionToken } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/** The write path is a `SECURITY DEFINER` call into Postgres. */
export const runtime = "nodejs";

/** One unit can carry a dozen seats and a chart has a dozen units. */
const IP_LIMIT = 240;
const IP_WINDOW_MS = 10 * 60_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ToggleSeatResponse = {
  ok: boolean;
  reason?: string;
  message?: string;
  unitId?: string;
  positionId?: string;
  enabled?: boolean;
};

/**
 * Enables or disables one seat on one unit.
 *
 * Both ids are resolved against the caller's organization inside the function,
 * because `unit_positions` carries no organization of its own and a uuid is
 * guessable; the shape check here only keeps an id that is not a uuid from
 * becoming a cast error in Postgres.
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

  let body: { unitId?: string; positionId?: string; enabled?: boolean };
  try {
    body = (await req.json()) as { unitId?: string; positionId?: string; enabled?: boolean };
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const limit = rateLimit(`org-chart:seat:ip:${clientIp(req)}`, IP_LIMIT, IP_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, reason: "rate_limited", message: messageFor("rate_limited") },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const unitId = typeof body.unitId === "string" ? body.unitId : "";
  const positionId = typeof body.positionId === "string" ? body.positionId : "";

  if (!UUID.test(unitId) || !UUID.test(positionId)) {
    return NextResponse.json(
      { ok: false, reason: "invalid_request", message: messageFor("invalid_request") },
      { status: 400 },
    );
  }

  // The function coalesces a missing flag to false, so a client that dropped the
  // key would disable a seat rather than fail. A refusal is the safe direction.
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json(
      { ok: false, reason: "invalid_request", message: messageFor("invalid_request") },
      { status: 400 },
    );
  }

  try {
    const res = await callRpc<RpcResult>("toggle_unit_position", {
      p_session_token: token,
      p_unit_id: unitId,
      p_position_id: positionId,
      p_enabled: body.enabled,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, reason: res.reason, message: messageFor(res.reason) },
        { status: res.reason === "forbidden" ? 403 : 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      unitId: res.unitId,
      positionId: res.positionId,
      enabled: res.enabled,
    });
  } catch (error) {
    console.error("[org-chart:unit-position]", error);
    return NextResponse.json(
      { ok: false, message: "We could not change that seat." },
      { status: 500 },
    );
  }
}
