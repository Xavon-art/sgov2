import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

type ReviewResult = RpcResult & {
  proposalId?: string;
  status?: string;
  version?: number;
};

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "rate_limited") return 429;
  if (reason === "forbidden") return 403;
  return 400;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const { id } = await ctx.params;

  let body: {
    decision?: string;
    remark?: string;
    requirements?: Array<{ label: string; detail?: string }> | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Something went wrong. Please try again." },
      { status: 400 },
    );
  }

  try {
    const res = await callRpc<ReviewResult>("review_proposal", {
      p_session_token: token,
      p_proposal_id: id,
      p_decision: body.decision,
      p_remark: body.remark ?? "",
      p_requirements:
        Array.isArray(body.requirements) && body.requirements.length > 0
          ? body.requirements
          : null,
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
    console.error("[proposals:review]", error);
    return NextResponse.json(
      { ok: false, message: "We could not record that decision." },
      { status: 500 },
    );
  }
}