import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { readSessionToken } from "@/lib/auth/session";
import {
  budgetAmount,
  budgetFailure,
  budgetJson,
  optionalBudgetUuid,
} from "@/lib/budget-api";

export const runtime = "nodejs";

type ExpenseResult = RpcResult & {
  id?: string;
  actualSpent?: number;
  remaining?: number;
};

function invalidBody(message: string) {
  return budgetJson({ ok: false, message, reason: "invalid_request" }, { status: 400 });
}

export async function GET(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return budgetJson({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const params = new URL(req.url).searchParams;
  const unitId = optionalBudgetUuid(params.get("unitId"));
  const periodId = optionalBudgetUuid(params.get("periodId"));
  if (unitId === undefined || periodId === undefined) {
    return budgetJson({ ok: false, message: "That filter is not valid." }, { status: 400 });
  }

  try {
    const res = await callRpc<RpcResult & { expenses?: unknown[] }>("list_unit_budget_expenses", {
      p_session_token: token,
      p_unit_id: unitId,
      p_period_id: periodId,
    });
    if (!res.ok) return budgetFailure(res);
    return budgetJson({ ok: true, expenses: res.expenses ?? [] });
  } catch (error) {
    console.error("[budget-unit-expenses:list]", error);
    return budgetJson({ ok: false, message: "We could not load those expenses." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return budgetJson({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: { requestId?: unknown; amount?: unknown; description?: unknown; receiptFile?: unknown };
  try {
    body = await req.json();
  } catch {
    return invalidBody("Send the expense as JSON.");
  }

  const requestId = optionalBudgetUuid(body.requestId);
  const amount = budgetAmount(body.amount);
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const receiptFile = typeof body.receiptFile === "string" ? body.receiptFile.trim() : "";
  if (!requestId) return invalidBody("Choose the approved budget request.");
  if (amount === null || amount <= 0) return invalidBody("Enter an amount above zero.");
  if (!description) return invalidBody("Write a short description.");

  try {
    const res = await callRpc<ExpenseResult>("record_budget_expense_by_request", {
      p_session_token: token,
      p_request_id: requestId,
      p_amount: amount,
      p_description: description,
      p_receipt_file: receiptFile || null,
    });
    if (!res.ok) return budgetFailure(res);
    return budgetJson({
      ok: true,
      id: res.id ?? null,
      actualSpent: res.actualSpent ?? null,
      remaining: res.remaining ?? null,
    });
  } catch (error) {
    console.error("[budget-unit-expenses:record]", error);
    return budgetJson({ ok: false, message: "We could not record that expense." }, { status: 500 });
  }
}
