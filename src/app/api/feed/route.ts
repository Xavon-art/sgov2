import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import type { FeedPost } from "@/lib/feed";

export const runtime = "nodejs";

type FeedResult = RpcResult & { scope?: string; posts?: FeedPost[] };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "forbidden") return 403;
  return 400;
}

/**
 * The announcements an officer is allowed to read.
 *
 * There is no `status` query parameter here on purpose. A caller asking for
 * "submitted" posts would be asking for something they may not see, and letting
 * the route express that would mean the boundary lives in a request string instead
 * of in SQL. The function returns only what this caller may read, so there is
 * nothing to filter and nothing to ask for.
 */
export async function GET(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const url = new URL(req.url);
  const raw = url.searchParams.get("limit");
  let limit: number | null = null;

  if (raw !== null) {
    const n = Number(raw);
    // A limit the caller sent but which is not a usable number is refused rather
    // than silently replaced, so a broken client finds out. SQL clamps the rest.
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
      return NextResponse.json(
        { ok: false, message: "That limit is not a usable number." },
        { status: 400 },
      );
    }
    limit = n;
  }

  try {
    const res = await callRpc<FeedResult>("list_feed", {
      p_session_token: token,
      p_limit: limit,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }

    return NextResponse.json({
      ok: true,
      scope: res.scope ?? "unit",
      posts: res.posts ?? [],
    });
  } catch (error) {
    console.error("[feed:list]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load the announcements." },
      { status: 500 },
    );
  }
}

/**
 * Events by day, for one window.
 *
 * `month` is the first day of the month being shown and `days` how far forward to
 * look. The window is sent rather than derived because an officer paging through a
 * calendar needs to move one month at a time, and letting the browser ask for a
 * wider window than it needs would ship dates nobody is looking at.
 */
export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: { month?: unknown; days?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Send the window as JSON." },
      { status: 400 },
    );
  }

  let month: string | null = null;
  if (typeof body.month === "string" && body.month.trim()) {
    month = body.month.trim();
    if (!ISO_DATE.test(month)) {
      return NextResponse.json(
        { ok: false, message: "That month is not a date this calendar can use." },
        { status: 400 },
      );
    }
  }

  let days: number | null = null;
  if (body.days !== undefined && body.days !== null) {
    const n = Number(body.days);
    if (!Number.isInteger(n) || n <= 0 || n > 400) {
      return NextResponse.json(
        { ok: false, message: "Choose a window of between 1 and 400 days." },
        { status: 400 },
      );
    }
    days = n;
  }

  try {
    const res = await callRpc<RpcResult & {
      from?: string;
      to?: string;
      days?: Record<string, CalendarEvent[]>;
    }>("list_calendar", {
      p_session_token: token,
      p_month: month,
      p_days: days,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }

    return NextResponse.json({
      ok: true,
      from: res.from ?? null,
      to: res.to ?? null,
      days: res.days ?? {},
    });
  } catch (error) {
    console.error("[feed:calendar]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load the calendar." },
      { status: 500 },
    );
  }
}

type CalendarEvent = {
  id: string;
  title: string;
  venue: string | null;
  activityType: string;
  unitName: string | null;
};