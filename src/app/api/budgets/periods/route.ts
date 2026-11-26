import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { readSessionToken } from "@/lib/auth/session";
import { budgetFailure, budgetJson } from "@/lib/budget-api";

export const runtime = "nodejs";

type PeriodsResult = RpcResult & { periods?: unknown[] };

export async function GET() {
  const token = await readSessionToken();
  if (!token) {
    return budgetJson({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  try {
    const res = await callRpc<PeriodsResult>("list_budget_periods", {
      p_session_token: token,
    });
    if (!res.ok) return budgetFailure(res);
    return budgetJson({ ok: true, periods: res.periods ?? [] });
  } catch (error) {
    console.error("[budget-periods:list]", error);
    return budgetJson(
      { ok: false, message: "We could not load the budget periods." },
      { status: 500 },
    );
  }
}
