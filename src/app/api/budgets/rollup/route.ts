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
  if (!unitId || periodId === undefined) {
    return budgetJson({ ok: false, message: "Choose a unit to roll up." }, { status: 400 });
  }

  try {
    const res = await callRpc<RpcResult>("budget_parent_rollup", {
      p_session_token: token,
      p_unit_id: unitId,
      p_period_id: periodId,
    });
    if (!res.ok) return budgetFailure(res);
    return budgetJson({ ok: true, rollup: res });
  } catch (error) {
    console.error("[budget-rollup]", error);
    return budgetJson({ ok: false, message: "We could not load that roll-up." }, { status: 500 });
  }
}
