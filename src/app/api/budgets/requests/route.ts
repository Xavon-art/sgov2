import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { readSessionToken } from "@/lib/auth/session";
import { budgetFailure, budgetJson, optionalBudgetUuid } from "@/lib/budget-api";

export const runtime = "nodejs";

type RequestsResult = RpcResult & { periodId?: string; budgets?: unknown[] };

export async function GET(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return budgetJson({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const params = new URL(req.url).searchParams;
  const periodId = optionalBudgetUuid(params.get("periodId"));
  const unitId = optionalBudgetUuid(params.get("unitId"));
  if (periodId === undefined || unitId === undefined) {
    return budgetJson({ ok: false, message: "That filter is not valid." }, { status: 400 });
  }

  try {
    const res = await callRpc<RequestsResult>("list_budget_requests_filtered", {
      p_session_token: token,
      p_period_id: periodId,
      p_campus: params.get("campus"),
      p_unit_type: params.get("unitType"),
      p_unit_id: unitId,
      p_status: params.get("status"),
    });
    if (!res.ok) return budgetFailure(res);
    return budgetJson({ ok: true, periodId: res.periodId ?? periodId, budgets: res.budgets ?? [] });
  } catch (error) {
    console.error("[budget-requests:list]", error);
    return budgetJson(
      { ok: false, message: "We could not filter the budget requests." },
      { status: 500 },
    );
  }
}
