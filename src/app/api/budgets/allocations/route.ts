import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { readSessionToken } from "@/lib/auth/session";
import {
  budgetAmount,
  budgetFailure,
  budgetJson,
  optionalBudgetUuid,
} from "@/lib/budget-api";

export const runtime = "nodejs";

type AllocationResult = RpcResult & {
  allocatedAmount?: number;
  previousAmount?: number | null;
  updated?: number;
};

function invalidBody(message: string) {
  return budgetJson({ ok: false, message, reason: "invalid_request" }, { status: 400 });
}

export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return budgetJson({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: { periodId?: unknown; unitId?: unknown; amount?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return invalidBody("Send the allocation as JSON.");
  }

  const periodId = optionalBudgetUuid(body.periodId);
  const unitId = optionalBudgetUuid(body.unitId);
  const amount = budgetAmount(body.amount);
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!periodId || !unitId) return invalidBody("Choose a period and a unit.");
  if (amount === null || amount < 0) return invalidBody("Enter an allocation of zero or more.");
  if (note.length < 2) return invalidBody("Write a short note explaining the allocation.");

  try {
    const res = await callRpc<AllocationResult>("set_budget_allocation", {
      p_session_token: token,
      p_period_id: periodId,
      p_unit_id: unitId,
      p_amount: amount,
      p_note: note,
    });
    if (!res.ok) return budgetFailure(res);
    return budgetJson({
      ok: true,
      periodId,
      unitId,
      allocatedAmount: res.allocatedAmount ?? amount,
      previousAmount: res.previousAmount ?? null,
    });
  } catch (error) {
    console.error("[budget-allocations:set]", error);
    return budgetJson({ ok: false, message: "We could not save that allocation." }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return budgetJson({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: { periodId?: unknown; items?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return invalidBody("Send the allocations as JSON.");
  }

  const periodId = optionalBudgetUuid(body.periodId);
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!periodId) return invalidBody("Choose a period.");
  if (!Array.isArray(body.items) || body.items.length === 0) return invalidBody("Add at least one allocation.");
  if (note.length < 2) return invalidBody("Write a short note explaining the allocations.");

  try {
    const res = await callRpc<AllocationResult>("bulk_set_budget_allocations", {
      p_session_token: token,
      p_period_id: periodId,
      p_items: body.items,
      p_note: note,
    });
    if (!res.ok) return budgetFailure(res);
    return budgetJson({ ok: true, periodId, updated: res.updated ?? 0 });
  } catch (error) {
    console.error("[budget-allocations:bulk]", error);
    return budgetJson({ ok: false, message: "We could not save those allocations." }, { status: 500 });
  }
}
