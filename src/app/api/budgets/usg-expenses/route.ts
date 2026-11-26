import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { readSessionToken } from "@/lib/auth/session";
import {
  budgetAmount,
  budgetFailure,
  budgetJson,
  optionalBudgetUuid,
} from "@/lib/budget-api";

export const runtime = "nodejs";

type ExpenseResult = RpcResult & { id?: string };

function invalidBody(message: string) {
  return budgetJson({ ok: false, message, reason: "invalid_request" }, { status: 400 });
}

export async function GET(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return budgetJson({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const periodId = optionalBudgetUuid(new URL(req.url).searchParams.get("periodId"));
  if (periodId === undefined) {
    return budgetJson({ ok: false, message: "That budget period reference is not valid." }, { status: 400 });
  }

  try {
    const res = await callRpc<RpcResult & { expenses?: unknown[] }>("list_usg_expenses", {
      p_session_token: token,
      p_period_id: periodId,
    });
    if (!res.ok) return budgetFailure(res);
    return budgetJson({ ok: true, expenses: res.expenses ?? [] });
  } catch (error) {
    console.error("[usg-expenses:list]", error);
    return budgetJson({ ok: false, message: "We could not load USG expenses." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return budgetJson({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: { periodId?: unknown; amount?: unknown; description?: unknown; receiptFile?: unknown };
  try {
    body = await req.json();
  } catch {
    return invalidBody("Send the expense as JSON.");
  }

  const periodId = optionalBudgetUuid(body.periodId);
  const amount = budgetAmount(body.amount);
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const receiptFile = typeof body.receiptFile === "string" ? body.receiptFile.trim() : "";
  if (!periodId) return invalidBody("Choose a budget period.");
  if (amount === null || amount <= 0) return invalidBody("Enter an amount above zero.");
  if (!description) return invalidBody("Write a short description.");

  try {
    const res = await callRpc<ExpenseResult>("create_usg_expense", {
      p_session_token: token,
      p_period_id: periodId,
      p_amount: amount,
      p_description: description,
      p_receipt_file: receiptFile || null,
    });
    if (!res.ok) return budgetFailure(res);
    return budgetJson({ ok: true, id: res.id ?? null });
  } catch (error) {
    console.error("[usg-expenses:create]", error);
    return budgetJson({ ok: false, message: "We could not save that expense." }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return budgetJson({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: { id?: unknown; amount?: unknown; description?: unknown; receiptFile?: unknown };
  try {
    body = await req.json();
  } catch {
    return invalidBody("Send the expense as JSON.");
  }

  const id = optionalBudgetUuid(body.id);
  const amount = budgetAmount(body.amount);
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const receiptFile = typeof body.receiptFile === "string" ? body.receiptFile.trim() : "";
  if (!id) return invalidBody("Choose an expense to update.");
  if (amount === null || amount <= 0) return invalidBody("Enter an amount above zero.");
  if (!description) return invalidBody("Write a short description.");

  try {
    const res = await callRpc<RpcResult>("update_usg_expense", {
      p_session_token: token,
      p_expense_id: id,
      p_amount: amount,
      p_description: description,
      p_receipt_file: receiptFile || null,
    });
    if (!res.ok) return budgetFailure(res);
    return budgetJson({ ok: true });
  } catch (error) {
    console.error("[usg-expenses:update]", error);
    return budgetJson({ ok: false, message: "We could not update that expense." }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return budgetJson({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const id = optionalBudgetUuid(new URL(req.url).searchParams.get("id"));
  if (!id) {
    return invalidBody("Choose an expense to delete.");
  }

  try {
    const res = await callRpc<RpcResult>("delete_usg_expense", {
      p_session_token: token,
      p_expense_id: id,
    });
    if (!res.ok) return budgetFailure(res);
    return budgetJson({ ok: true });
  } catch (error) {
    console.error("[usg-expenses:delete]", error);
    return budgetJson({ ok: false, message: "We could not delete that expense." }, { status: 500 });
  }
}
