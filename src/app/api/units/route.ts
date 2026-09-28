import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { canManageChart, currentAccount, readSessionToken } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/** Adds by hand, not for a bulk import: the 10-minute ceiling matches the invite routes. */
const IP_LIMIT = 60;
const IP_WINDOW_MS = 10 * 60_000;

const MAX_NAME = 120;
const UNIT_TYPES = ["college", "campus", "department"] as const;

type Unit = { id: string; name: string; unitType: string; parentId: string | null };

export type UnitsResponse = RpcResult & {
  root?: Unit | null;
  units?: Unit[];
  unitId?: string;
  name?: string;
  unitType?: string;
};

/**
 * The owner's unit list for the dashboard — one scoped read through
 * `unit_chart`, which is what the org chart already renders. The client
 * drops the root; this endpoint returns it plus all children unchanged.
 */
export async function GET() {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  try {
    const res = await callRpc<UnitsResponse>("unit_chart", {
      p_session_token: token,
    });

    if (!res.ok) {
      return NextResponse.json({ ok: false, message: messageFor(res.reason) }, { status: 403 });
    }

    return NextResponse.json({ ok: true, root: res.root ?? null, units: res.units ?? [] });
  } catch (error) {
    console.error("[units:list]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load your campuses and departments." },
      { status: 500 },
    );
  }
}

/**
 * Adds one campus, college, or department under the caller's USG root.
 *
 * Owner authority is proven twice — as an `accountScope === "owner"` gate
 * here, and again inside `add_unit` via the founding-member row — and no
 * organization id is read from the body.
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

  let body: { name?: string; unitType?: string };
  try {
    body = (await req.json()) as { name?: string; unitType?: string };
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const limit = rateLimit(`units:create:ip:${clientIp(req)}`, IP_LIMIT, IP_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, reason: "rate_limited", message: messageFor("rate_limited") },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json(
      { ok: false, reason: "invalid_name", message: messageFor("invalid_name") },
      { status: 400 },
    );
  }

  if (name.length > MAX_NAME) {
    return NextResponse.json(
      { ok: false, message: `Keep the name to ${MAX_NAME} characters or fewer.` },
      { status: 400 },
    );
  }

  const unitType = typeof body.unitType === "string" ? body.unitType : "";
  if (!UNIT_TYPES.includes(unitType as (typeof UNIT_TYPES)[number])) {
    return NextResponse.json(
      { ok: false, reason: "invalid_type", message: messageFor("invalid_type") },
      { status: 400 },
    );
  }

  try {
    const res = await callRpc<RpcResult & { unitId?: string; name?: string; unitType?: string }>(
      "add_unit",
      { p_session_token: token, p_name: name, p_unit_type: unitType },
    );

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, reason: res.reason, message: messageFor(res.reason) },
        { status: res.reason === "forbidden" ? 403 : 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      unitId: res.unitId,
      name: res.name,
      unitType: res.unitType,
    });
  } catch (error) {
    console.error("[units:create]", error);
    return NextResponse.json(
      { ok: false, message: "We could not add that campus or department." },
      { status: 500 },
    );
  }
}
