import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { UUID_RE, type DocumentDecision } from "@/lib/document-search";

export const runtime = "nodejs";

type ApproveResult = RpcResult & { status?: string };

const DECISIONS = new Set<DocumentDecision>(["pending", "approved", "rejected"]);

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "forbidden") return 403;
  if (reason === "not_found") return 404;
  return 400;
}

/**
 * The USG decision on a catalog row. Only an owner or reviewer may call this,
 * and the role is proven inside SQL from the session. A rejection needs a remark
 * so the filing unit knows what to change.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ submissionId: string }> },
) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const { submissionId } = await ctx.params;
  if (!UUID_RE.test(submissionId)) {
    return NextResponse.json(
      { ok: false, message: "That document reference is not valid." },
      { status: 400 },
    );
  }

  let body: { decision?: unknown; remark?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Send the decision as JSON." },
      { status: 400 },
    );
  }

  const decision = typeof body.decision === "string" ? body.decision.trim() : "";
  if (!DECISIONS.has(decision as DocumentDecision)) {
    return NextResponse.json(
      { ok: false, message: "Choose approve, reject, or return to pending." },
      { status: 400 },
    );
  }

  const remark = typeof body.remark === "string" ? body.remark.trim() : "";
  if (decision === "rejected" && !remark) {
    return NextResponse.json(
      { ok: false, message: messageFor("remark_required"), reason: "remark_required" },
      { status: 400 },
    );
  }

  try {
    const res = await callRpc<ApproveResult>("approve_document", {
      p_session_token: token,
      p_submission_id: submissionId,
      p_decision: decision,
      p_remark: remark || null,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }

    return NextResponse.json({ ok: true, status: res.status });
  } catch (error) {
    console.error("[documents:approve]", error);
    return NextResponse.json(
      { ok: false, message: "We could not record that decision." },
      { status: 500 },
    );
  }
}
