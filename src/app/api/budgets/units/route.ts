import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { readSessionToken } from "@/lib/auth/session";
import { budgetFailure, budgetJson, optionalBudgetUuid } from "@/lib/budget-api";

export const runtime = "nodejs";

type UnitsResult = RpcResult & { periodId?: string; units?: unknown[] };

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
    const res = await callRpc<UnitsResult>("list_budget_units", {
      p_session_token: token,
      p_period_id: periodId,
    });
    if (!res.ok) return budgetFailure(res);
    return budgetJson({ ok: true, periodId: res.periodId ?? periodId, units: res.units ?? [] });
  } catch (error) {
    console.error("[budget-units:list]", error);
    return budgetJson(
      { ok: false, message: "We could not load the unit budget totals." },
      { status: 500 },
    );
  }
}
