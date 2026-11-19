import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { currentAccount, readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

/**
 * The federated overview: one read that answers "what is on my desk today".
 *
 * The rebuilt dashboard is organised as Overview / Manage / Request / Events /
 * Survey / Settings, and this is the first of them. It deliberately does not
 * fetch proposals, budgets, or the old feed -- that work is no longer surfaced
 * anywhere in the new IA, so counting it here would be the only place a user
 * ever saw those numbers again.
 *
 * What it does count is what the two sides of the federation actually owe each
 * other, in the two directions the Request section runs:
 *   * tasks the USG pushed down and this side still has to answer, and
 *   * tasks this side pushed up (or had pushed at it) that are waiting.
 *
 * Each module is read best-effort so one unavailable section cannot blank the
 * whole desk; the response also carries status breakdowns for the report and
 * chart widgets.
 */
type Counts = {
  tasksOpen: number;
  tasksOverdue: number;
  requestsOpen: number;
  eventsPending: number;
  surveysOpen: number;
};

type Breakdown = {
  tasks: Record<string, number>;
  requests: Record<string, number>;
  events: Record<string, number>;
  surveys: Record<string, number>;
};

type ApiResponse = RpcResult & {
  account?: Record<string, unknown>;
  organization?: Record<string, unknown> | null;
  canCustomise?: boolean;
  counts?: Counts;
  breakdown?: Breakdown;
};

function bump(bucket: Record<string, number>, key: string) {
  const normalized = key || "unknown";
  bucket[normalized] = (bucket[normalized] ?? 0) + 1;
}

export async function GET() {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  try {
    const account = await currentAccount();
    if (!account) {
      return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
    }

    // The profile read is the one live call Phase 1 can make. It is also what
    // the screen needs for the greeting and the unit name, so the overview and
    // the profile are not two round trips.
    const profile = await callRpc<ApiResponse>("my_profile", { p_session_token: token });

    if (!profile.ok) {
      return NextResponse.json(
        { ok: false, reason: profile.reason, message: messageFor(profile.reason) },
        { status: 403 },
      );
    }

    // Real counts from the modules that already exist. Each read is best-effort:
    // a failure on one leaves that counter at zero rather than failing the whole
    // overview.
    const counts: Counts = { tasksOpen: 0, tasksOverdue: 0, requestsOpen: 0, eventsPending: 0, surveysOpen: 0 };
    const breakdown: Breakdown = { tasks: {}, requests: {}, events: {}, surveys: {} };

    try {
      const tasks = await callRpc<
        RpcResult & {
          tasks?: Array<{
            closed?: boolean;
            overdue?: boolean;
            myStatus?: string | null;
          }>;
        }
      >("list_my_tasks", { p_session_token: token, p_status: "" });
      if (tasks.ok && Array.isArray(tasks.tasks)) {
        for (const task of tasks.tasks) {
          const closed = task.closed === true;
          if (!closed) counts.tasksOpen += 1;
          if (task.overdue === true) counts.tasksOverdue += 1;
          bump(breakdown.tasks, closed ? "closed" : task.overdue ? "overdue" : task.myStatus ?? "in progress");
        }
      }
    } catch {
      // ignore
    }

    try {
      const reqs = await callRpc<RpcResult & { requests?: Array<{ status?: string }> }>(
        "list_personal_requests",
        { p_session_token: token, p_status: "" },
      );
      if (reqs.ok && Array.isArray(reqs.requests)) {
        for (const request of reqs.requests) {
          const status = String(request.status ?? "").toLowerCase();
          if (status === "submitted") counts.requestsOpen += 1;
          bump(breakdown.requests, status);
        }
      }
    } catch {
      // ignore
    }

    try {
      const evs = await callRpc<
        RpcResult & {
          events?: Array<{ status?: string; honorStatus?: string; cancelledAt?: string | null }>;
        }
      >("list_events", { p_session_token: token });
      if (evs.ok && Array.isArray(evs.events)) {
        for (const event of evs.events) {
          const status = String(event.status ?? "").toLowerCase();
          if (status === "claimed" || status === "upcoming") counts.eventsPending += 1;
          bump(breakdown.events, status);
          if (event.honorStatus) bump(breakdown.events, `honor:${String(event.honorStatus).toLowerCase()}`);
          if (event.cancelledAt) bump(breakdown.events, "cancelled");
        }
      }
    } catch {
      // ignore
    }

    try {
      const survs = await callRpc<RpcResult & { surveys?: Array<{ status?: string }> }>("list_surveys", {
        p_session_token: token,
      });
      if (survs.ok && Array.isArray(survs.surveys)) {
        for (const survey of survs.surveys) {
          const status = String(survey.status ?? "").toLowerCase();
          if (status === "open") counts.surveysOpen += 1;
          bump(breakdown.surveys, status);
        }
      }
    } catch {
      // ignore
    }

    return NextResponse.json({
      ok: true,
      account: profile.account ?? null,
      organization: profile.organization ?? null,
      canCustomise: Boolean(profile.canCustomise),
      counts,
      breakdown,
    });
  } catch (error) {
    console.error("[overview:read]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load your overview." },
      { status: 500 },
    );
  }
}
