import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { readSessionToken } from "@/lib/auth/session";
import { budgetFailure, budgetJson, optionalBudgetUuid } from "@/lib/budget-api";

export const runtime = "nodejs";

type ExportResult = RpcResult & { csv?: string };

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
    const res = await callRpc<ExportResult>("budget_export_data", {
      p_session_token: token,
      p_period_id: periodId,
    });
    if (!res.ok) return budgetFailure(res);
    return new Response(res.csv ?? "", {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="budget-export.csv"',
      },
    });
  } catch (error) {
    console.error("[budget-export]", error);
    return budgetJson(
      { ok: false, message: "We could not export the budget requests." },
      { status: 500 },
    );
  }
}
