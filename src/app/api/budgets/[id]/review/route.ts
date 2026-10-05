import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

type ReviewResult = RpcResult & {
  id?: string;
  status?: string;
  approvedTotal?: number | null;
  requestedTotal?: number;
};

const DECISIONS = new Set(["approved", "returned", "rejected"]);

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "rate_limited") return 429;
  if (reason === "forbidden") return 403;
  if (reason === "not_found") return 404;
  return 400;
}

/**
 * The USG decision on a budget request.
 *
 * `approvedTotal` is optional, and that is the whole convenience: leave it out
 * and the request is approved at exactly what was asked for. Send a smaller
 * number and the officer sees both figures side by side, so an adjustment is
 * never mistaken for the original ask. SQL refuses anything above the ask.
 *
 * A `returned` request can come back through here after a conversation, but
 * `approved` and `rejected` are final.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const { id } = await ctx.params;

  let body: { decision?: unknown; approvedTotal?: unknown; remark?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Send the decision as JSON." },
      { status: 400 },
    );
  }

  const decision = typeof body.decision === "string" ? body.decision : "";
  if (!DECISIONS.has(decision)) {
    return NextResponse.json(
      { ok: false, message: "Choose approve, return or reject." },
      { status: 400 },
    );
  }

  // Absent means "the full amount". Present-but-empty means the same, because a
  // number input that was cleared should not be read as a request to approve zero.
  let approvedTotal: number | null = null;
  if (typeof body.approvedTotal === "number" && Number.isFinite(body.approvedTotal)) {
    approvedTotal = body.approvedTotal;
  } else if (typeof body.approvedTotal === "string" && body.approvedTotal.trim()) {
    const n = Number(body.approvedTotal.replace(/[,\s]/g, ""));
    if (!Number.isFinite(n)) {
      return NextResponse.json(
        { ok: false, message: messageFor("invalid_amount"), reason: "invalid_amount" },
        { status: 400 },
      );
    }
    approvedTotal = n;
  }

  const remark = typeof body.remark === "string" ? body.remark : "";

  try {
    const res = await callRpc<ReviewResult>("review_budget", {
      p_session_token: token,
      p_budget_id: id,
      p_decision: decision,
      p_approved_total: approvedTotal,
      p_remark: remark,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }

    return NextResponse.json({
      ok: true,
      budgetId: res.id,
      status: res.status,
      approvedTotal: res.approvedTotal ?? null,
      requestedTotal: res.requestedTotal ?? null,
    });
  } catch (error) {
    console.error("[budgets:review]", error);
    return NextResponse.json(
      { ok: false, message: "We could not record that decision." },
      { status: 500 },
    );
  }
}