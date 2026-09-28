import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { canManageChart, currentAccount, readSessionToken } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/** The write path is a `SECURITY DEFINER` call into Postgres. */
export const runtime = "nodejs";

/** Set for an owner working down a long template, not for a single add. */
const IP_LIMIT = 60;
const IP_WINDOW_MS = 10 * 60_000;

const MAX_LABEL = 120;
const SMALLINT_MIN = -32_768;
const SMALLINT_MAX = 32_767;

export type AddPositionResponse = {
  ok: boolean;
  reason?: string;
  message?: string;
  positionId?: string;
  label?: string;
  enabledUnits?: number;
};

/**
 * `p_sort_order` is a `smallint`, and PostgREST raises rather than truncating on
 * a value it cannot cast -- which would surface to the owner as a 500 for a
 * typo in a field they cannot see. Anything non-integral or out of range is
 * refused here as the bad input it is.
 */
function sortOrderFrom(value: unknown): number | null {
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number" && typeof value !== "string") return null;

  const text = typeof value === "string" ? value.trim() : "";
  if (typeof value === "string" && text === "") return null;

  const parsed = typeof value === "number" ? value : Number(text);
  if (!Number.isInteger(parsed)) return null;
  if (parsed < SMALLINT_MIN || parsed > SMALLINT_MAX) return null;
  return parsed;
}

/**
 * Adds one position to the organization template.
 *
 * The function enables the new seat on every existing unit in the same call, so
 * the owner is not left with a position that exists in the template and nowhere
 * else, and `enabledUnits` is what the page reports back.
 *
 * The organization comes from the caller's own account inside the function, so
 * no organization id is read from the body -- accepting one would mean a route
 * that forwards a scope the client chose.
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

  let body: { label?: string; sortOrder?: number };
  try {
    body = (await req.json()) as { label?: string; sortOrder?: number };
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const limit = rateLimit(`org-chart:position:ip:${clientIp(req)}`, IP_LIMIT, IP_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, reason: "rate_limited", message: messageFor("rate_limited") },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label) {
    return NextResponse.json(
      { ok: false, reason: "invalid_label", message: messageFor("invalid_label") },
      { status: 400 },
    );
  }

  if (label.length > MAX_LABEL) {
    return NextResponse.json(
      { ok: false, message: `Keep the name to ${MAX_LABEL} characters or fewer.` },
      { status: 400 },
    );
  }

  const sortOrder = sortOrderFrom(body.sortOrder);
  if (sortOrder === null) {
    return NextResponse.json(
      { ok: false, message: "Sort order must be a whole number." },
      { status: 400 },
    );
  }

  try {
    const res = await callRpc<
      RpcResult & { positionId?: string; label?: string; enabledUnits?: number }
    >("add_position", {
      p_session_token: token,
      p_label: label,
      p_sort_order: sortOrder,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, reason: res.reason, message: messageFor(res.reason) },
        { status: res.reason === "forbidden" ? 403 : 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      positionId: res.positionId,
      label: res.label,
      enabledUnits: res.enabledUnits,
    });
  } catch (error) {
    console.error("[org-chart:position]", error);
    return NextResponse.json(
      { ok: false, message: "We could not add that position." },
      { status: 500 },
    );
  }
}
