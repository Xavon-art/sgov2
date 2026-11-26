import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { readSessionToken } from "@/lib/auth/session";
import {
  budgetAmount,
  budgetFailure,
  budgetJson,
  optionalBudgetUuid,
} from "@/lib/budget-api";

export const runtime = "nodejs";

type SubmitResult = RpcResult & {
  budgetId?: string;
  requestedTotal?: number;
  unitId?: string;
};

type SpendResult = RpcResult & {
  id?: string;
  actualSpent?: number;
  remaining?: number;
};

function invalidBody(message: string) {
  return budgetJson({ ok: false, message, reason: "invalid_request" }, { status: 400 });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return budgetJson({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const eventId = optionalBudgetUuid((await ctx.params).id);
  if (!eventId) return invalidBody("That event reference is not valid.");

  let body: { title?: unknown; justification?: unknown; periodId?: unknown; items?: unknown };
  try {
    body = await req.json();
  } catch {
    return invalidBody("Send the budget as JSON.");
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const periodId = optionalBudgetUuid(body.periodId);
  if (title.length < 4 || title.length > 140) {
    return invalidBody("Give the budget a name of at least 4 characters.");
  }
  if (periodId === undefined) return invalidBody("That budget period reference is not valid.");
  if (!Array.isArray(body.items)) return invalidBody("Add at least one budget line.");

  const sendsSubtotal = body.items.some(
    (item) =>
      item !== null &&
      typeof item === "object" &&
      Object.prototype.hasOwnProperty.call(item, "subtotal"),
  );
  if (sendsSubtotal) {
    return invalidBody("Send each line's label, quantity, and unit cost; totals are calculated on the server.");
  }

  try {
    const res = await callRpc<SubmitResult>("submit_unit_budget_request", {
      p_session_token: token,
      p_unit_id: null,
      p_period_id: periodId,
      p_title: title,
      p_justification: typeof body.justification === "string" ? body.justification.trim() : "",
      p_items: body.items,
      p_event_id: eventId,
      p_proposal_id: null,
    });
    if (!res.ok) return budgetFailure(res);
    return budgetJson({
      ok: true,
      budgetId: res.budgetId ?? null,
      eventId,
      unitId: res.unitId ?? null,
      requestedTotal: res.requestedTotal ?? null,
    });
  } catch (error) {
    console.error("[event-budget:submit]", error);
    return budgetJson({ ok: false, message: "We could not send that budget." }, { status: 500 });
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return budgetJson({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const eventId = optionalBudgetUuid((await ctx.params).id);
  if (!eventId) return invalidBody("That event reference is not valid.");

  let body: { budgetId?: unknown; amount?: unknown; description?: unknown; receiptFile?: unknown };
  try {
    body = await req.json();
  } catch {
    return invalidBody("Send the spending as JSON.");
  }

  const budgetId = optionalBudgetUuid(body.budgetId);
  const amount = budgetAmount(body.amount);
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const receiptFile = typeof body.receiptFile === "string" ? body.receiptFile.trim() : "";
  if (!budgetId) return invalidBody("Choose the approved event budget.");
  if (amount === null || amount <= 0) return invalidBody("Enter an amount above zero.");
  if (!description) return invalidBody("Write a short description.");

  try {
    const detail = await callRpc<RpcResult & { eventId?: string }>("budget_detail", {
      p_session_token: token,
      p_budget_id: budgetId,
    });
    if (!detail.ok) return budgetFailure(detail);
    if (detail.eventId !== eventId) {
      return budgetJson({ ok: false, message: "That budget does not belong to this event." }, { status: 400 });
    }

    const res = await callRpc<SpendResult>("record_budget_expense_by_request", {
      p_session_token: token,
      p_request_id: budgetId,
      p_amount: amount,
      p_description: description,
      p_receipt_file: receiptFile || null,
    });
    if (!res.ok) return budgetFailure(res);
    return budgetJson({
      ok: true,
      eventId,
      budgetId,
      id: res.id ?? null,
      actualSpent: res.actualSpent ?? null,
      remaining: res.remaining ?? null,
    });
  } catch (error) {
    console.error("[event-budget:spend]", error);
    return budgetJson({ ok: false, message: "We could not record that spending." }, { status: 500 });
  }
}
