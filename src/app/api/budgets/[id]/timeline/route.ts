import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { readSessionToken } from "@/lib/auth/session";
import { BUDGET_UUID_RE, budgetFailure, budgetJson } from "@/lib/budget-api";

export const runtime = "nodejs";

type TimelineResult = RpcResult & { events?: unknown[] };

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return budgetJson({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!BUDGET_UUID_RE.test(id)) {
    return budgetJson({ ok: false, message: "That budget reference is not valid." }, { status: 400 });
  }

  try {
    const res = await callRpc<TimelineResult>("list_budget_timeline", {
      p_session_token: token,
      p_budget_id: id,
    });
    if (!res.ok) return budgetFailure(res);
    return budgetJson({ ok: true, events: res.events ?? [] });
  } catch (error) {
    console.error("[budget-timeline:list]", error);
    return budgetJson({ ok: false, message: "We could not load that timeline." }, { status: 500 });
  }
}
