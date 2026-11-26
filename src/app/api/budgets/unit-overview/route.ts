import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { readSessionToken } from "@/lib/auth/session";
import { budgetFailure, budgetJson, optionalBudgetUuid } from "@/lib/budget-api";

export const runtime = "nodejs";

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
    const res = await callRpc<RpcResult>("get_unit_budget_overview", {
      p_session_token: token,
      p_unit_id: unitId,
      p_period_id: periodId,
    });
    if (!res.ok) return budgetFailure(res);
    return budgetJson({ ok: true, overview: res });
  } catch (error) {
    console.error("[budget-unit-overview]", error);
    return budgetJson({ ok: false, message: "We could not load that unit budget." }, { status: 500 });
  }
}
