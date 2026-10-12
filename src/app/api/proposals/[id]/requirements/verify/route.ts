import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { UUID_RE } from "@/lib/documents";

export const runtime = "nodejs";

type VerifyDecision = {
  requirementId: string;
  decision: "accepted" | "waived";
  note?: string;
};

type VerifyResult = RpcResult & {
  proposalId?: string;
  status?: string;
  version?: number;
};

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "rate_limited") return 429;
  if (reason === "forbidden") return 403;
  if (reason === "no_proposal") return 404;
  return 400;
}

/**
 * The USG end of the requirements loop: accepts or waives each `submitted`
 * requirement. The RPC refuses a partial verdict, so the route only forwards
 * the full decision list the panel assembled.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const { id } = await ctx.params;

  let body: { decisions?: VerifyDecision[]; remark?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: messageFor("invalid_request") },
      { status: 400 },
    );
  }

  const decisions = Array.isArray(body.decisions) ? body.decisions : null;
  if (!decisions || decisions.length < 1) {
    return NextResponse.json(
      { ok: false, message: messageFor("invalid_request") },
      { status: 400 },
    );
  }
  if (
    decisions.some(
      (d) =>
        !UUID_RE.test(d?.requirementId ?? "") || !["accepted", "waived"].includes(d?.decision),
    )
  ) {
    return NextResponse.json(
      { ok: false, message: messageFor("invalid_request") },
      { status: 400 },
    );
  }

  try {
    const res = await callRpc<VerifyResult>("verify_proposal_requirements", {
      p_session_token: token,
      p_proposal_id: id,
      p_decisions: decisions,
      p_remark: typeof body.remark === "string" ? body.remark : null,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason) },
        { status: statusForReason(res.reason) },
      );
    }

    return NextResponse.json({
      ok: true,
      proposalId: res.proposalId,
      status: res.status,
      version: res.version,
    });
  } catch (error) {
    console.error("[proposals:requirements:verify]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}