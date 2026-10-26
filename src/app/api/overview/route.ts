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

    const counts = { tasksOpen: 0, tasksOverdue: 0, requestsOpen: 0, eventsPending: 0, surveysOpen: 0 };

    if (!profile.ok) {
      return NextResponse.json(
        { ok: false, reason: profile.reason, message: messageFor(profile.reason) },
        { status: 403 },
      );
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
