import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "rate_limited") return 429;
  if (reason === "forbidden") return 403;
  if (reason === "no_proposal") return 404;
  return 400;
}

/**
 * Starts the explicit review step: flips a `submitted` proposal to
 * `under_review`. The review panel is not offered until this has happened, so
 * the reviewer's later decision always lands on a proposal that is provably
 * under review. Idempotent -- already-under-review reads as success.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const { id } = await ctx.params;

  try {
    const res = await callRpc<RpcResult & { status?: string }>("start_proposal_review", {
      p_session_token: token,
      p_proposal_id: id,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason) },
        { status: statusForReason(res.reason) },
      );
    }

    return NextResponse.json({ ok: true, status: res.status });
  } catch (error) {
    console.error("[proposals:start-review]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}