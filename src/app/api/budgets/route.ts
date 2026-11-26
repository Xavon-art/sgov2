import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import type { BudgetDashboard, BudgetRow, BudgetSummary } from "@/lib/budgets";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, { ...init, headers: NO_STORE_HEADERS });
}

type ListResult = RpcResult & { scope?: string; budgets?: BudgetRow[] };
type SummaryResult = RpcResult & BudgetSummary;
type DashboardResult = RpcResult & BudgetDashboard;

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "rate_limited") return 429;
  if (reason === "forbidden") return 403;
  return 400;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every budget the caller is allowed to see, plus the money summary when they are
 * the ones who decide.
 *
 * Both answers come back in one response on purpose. The USG screen shows a
 * per-unit table above the list, and splitting it into two fetches would let the
 * table and the list disagree for a moment after a decision.
 *
 * The summary is requested only once `list_budgets` has confirmed the caller is
 * on the USG side, so the RPC is never asked to answer a question the LSG caller
 * should not hear.
 */
export async function GET() {
  const token = await readSessionToken();
  if (!token) {
    return json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  try {
    const res = await callRpc<ListResult>("list_budgets", { p_session_token: token });
    if (!res.ok) {
      return json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }

    const scope = res.scope ?? "unit";
    let summary: BudgetSummary | null = null;
    let dashboard: BudgetDashboard | null = null;

    if (scope === "organization") {
      const sum = await callRpc<SummaryResult>("budget_summary", { p_session_token: token });
      if (sum.ok) {
        summary = { units: sum.units ?? [], totals: sum.totals ?? null } as BudgetSummary;
      }
    } else {
      const dash = await callRpc<DashboardResult>("lsg_budget_dashboard", { p_session_token: token });
      if (dash.ok) {
        dashboard = {
          totalSpent: dash.totalSpent ?? 0,
          requestCount: dash.requestCount ?? 0,
          approvedCount: dash.approvedCount ?? 0,
          remaining: dash.remaining ?? 0,
          periods: dash.periods ?? [],
        };
      }
    }

    return json({
      ok: true,
      scope,
      budgets: res.budgets ?? [],
      summary,
      dashboard,
    });
  } catch (error) {
    console.error("[budgets:list]", error);
    return json(
      { ok: false, message: "We could not load the budget requests." },
      { status: 500 },
    );
  }
}

/**
 * A new budget request.
 *
 * `proposalId` is optional on purpose: a request may stand on its own, or hang off
 * an open proposal the unit already submitted. Attaching is checked in SQL --
 * the unit has to own that proposal and it has to still be open -- so this route
 * only has to decide whether the shape of the request is usable at all.
 */
export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: {
    title?: unknown;
    justification?: unknown;
    proposalId?: unknown;
    eventId?: unknown;
    periodId?: unknown;
    items?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return json(
      { ok: false, message: "Send the request as JSON." },
      { status: 400 },
    );
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length < 4 || title.length > 140) {
    return json(
      { ok: false, message: messageFor("invalid_title"), reason: "invalid_title" },
      { status: 400 },
    );
  }

  let proposalId: string | null = null;
  if (typeof body.proposalId === "string" && body.proposalId.trim()) {
    proposalId = body.proposalId.trim();
    if (!UUID.test(proposalId)) {
      return json(
        { ok: false, message: "That proposal reference is not valid." },
        { status: 400 },
      );
    }
  }

  let eventId: string | null = null;
  if (typeof body.eventId === "string" && body.eventId.trim()) {
    eventId = body.eventId.trim();
    if (!UUID.test(eventId)) {
      return json(
        { ok: false, message: "That event reference is not valid." },
        { status: 400 },
      );
    }
  }

  let periodId: string | null = null;
  if (typeof body.periodId === "string" && body.periodId.trim()) {
    periodId = body.periodId.trim();
    if (!UUID.test(periodId)) {
      return json(
        { ok: false, message: "That budget period reference is not valid." },
        { status: 400 },
      );
    }
  }

  if (proposalId && eventId) {
    return json(
      {
        ok: false,
        message: "A budget can link to a proposal or an event, not both.",
        reason: "invalid_request",
      },
      { status: 400 },
    );
  }

  if (!Array.isArray(body.items)) {
    return json(
      { ok: false, message: messageFor("invalid_items"), reason: "invalid_items" },
      { status: 400 },
    );
  }

  // Totals are the server's to compute. A client-sent subtotal is either a bug
  // or an attempt to choose the number the reviewer sees, so refuse it instead
  // of silently ignoring it.
  const sendsSubtotal = body.items.some(
    (item) =>
      item !== null &&
      typeof item === "object" &&
      Object.prototype.hasOwnProperty.call(item, "subtotal"),
  );
  if (sendsSubtotal) {
    return json(
      {
        ok: false,
        message: "Send each line's label, quantity, and unit cost; totals are calculated on the server.",
        reason: "invalid_items",
      },
      { status: 400 },
    );
  }

  try {
    const res = await callRpc<
      RpcResult & { budgetId?: string; requestedTotal?: number; eventId?: string }
    >("submit_unit_budget_request", {
      p_session_token: token,
      p_unit_id: null,
      p_period_id: periodId,
      p_title: title,
      p_justification: typeof body.justification === "string" ? body.justification.trim() : "",
      p_items: body.items,
      p_event_id: eventId,
      p_proposal_id: proposalId,
    });

    if (!res.ok) {
      return json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }

    return json({
      ok: true,
      budgetId: res.budgetId,
      requestedTotal: res.requestedTotal,
      eventId: res.eventId ?? eventId,
    });
  } catch (error) {
    console.error("[budgets:submit]", error);
    return json(
      { ok: false, message: "We could not send that request." },
      { status: 500 },
    );
  }
}