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
 * Until the Request module lands in the next phase those counters come back
 * zero rather than pretending. The shape is stable so the screen does not have
 * to change when the numbers become real.
 */
type ApiResponse = RpcResult & {
  account?: Record<string, unknown>;
  organization?: Record<string, unknown> | null;
  canCustomise?: boolean;
  counts?: {
    tasksOpen: number;
    tasksOverdue: number;
    requestsOpen: number;
    eventsPending: number;
    surveysOpen: number;
  };
};

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
    const counts = { tasksOpen: 0, tasksOverdue: 0, requestsOpen: 0, eventsPending: 0, surveysOpen: 0 };

    try {
      const tasks = await callRpc<RpcResult & { tasks?: { status?: string; deadline?: string }[] }>(
        "list_my_tasks",
        { p_session_token: token },
      );
      if (tasks.ok && Array.isArray(tasks.tasks)) {
        const now = Date.now();
        for (const t of tasks.tasks) {
          const st = String(t.status ?? "").toLowerCase();
          if (st !== "closed" && st !== "completed" && st !== "done") counts.tasksOpen += 1;
          if (t.deadline && new Date(t.deadline).getTime() < now && st !== "closed" && st !== "completed" && st !== "done")
            counts.tasksOverdue += 1;
        }
      }
    } catch {
      // ignore
    }

    try {
      const reqs = await callRpc<RpcResult & { requests?: { status?: string }[] }>(
        "list_personal_requests",
        { p_session_token: token },
      );
      if (reqs.ok && Array.isArray(reqs.requests)) {
        counts.requestsOpen = reqs.requests.filter((r) => {
          const st = String(r.status ?? "").toLowerCase();
          return st === "pending" || st === "returned";
        }).length;
      }
    } catch {
      // ignore
    }

    try {
      const evs = await callRpc<RpcResult & { events?: { status?: string }[] }>("list_events", {
        p_session_token: token,
      });
      if (evs.ok && Array.isArray(evs.events)) {
        counts.eventsPending = evs.events.filter((e) => {
          const st = String(e.status ?? "").toLowerCase();
          return st === "claimed" || st === "upcoming";
        }).length;
      }
    } catch {
      // ignore
    }

    try {
      const survs = await callRpc<RpcResult & { surveys?: { status?: string }[] }>("list_surveys", {
        p_session_token: token,
      });
      if (survs.ok && Array.isArray(survs.surveys)) {
        counts.surveysOpen = survs.surveys.filter((s) => String(s.status ?? "").toLowerCase() === "open").length;
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
    });
  } catch (error) {
    console.error("[overview:read]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load your overview." },
      { status: 500 },
    );
  }
}
