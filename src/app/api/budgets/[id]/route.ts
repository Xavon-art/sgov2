import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import type { BudgetDetail } from "@/lib/budgets";

export const runtime = "nodejs";

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "forbidden") return 403;
  if (reason === "not_found") return 404;
  return 400;
}

/**
 * One budget request with its lines.
 *
 * `budget_detail` repeats the caller's own scoping check, so asking for another
 * unit's request answers `not_found` rather than handing it over. There is no
 * separate authorisation step to keep in step with it.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const { id } = await ctx.params;

  try {
    const res = await callRpc<RpcResult & Partial<BudgetDetail>>("budget_detail", {
      p_session_token: token,
      p_budget_id: id,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }

    return NextResponse.json({ ok: true, budget: res });
  } catch (error) {
    console.error("[budgets:detail]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load that request." },
      { status: 500 },
    );
  }
}