import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { UUID_RE } from "@/lib/resolutions";

export const runtime = "nodejs";

type ReviewResult = RpcResult & { id?: string; status?: string };

const DECISIONS = new Set(["under_review", "approved", "returned", "published"]);

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "forbidden") return 403;
  if (reason === "not_found") return 404;
  return 400;
}

/**
 * The USG decision on a resolution. Only a USG reviewer may call this, and the
 * role is proven inside SQL from the session -- the route only checks that the
 * decision is one the database knows before asking.
 *
 * `returned` needs a remark so the unit knows what to change; the rest may carry
 * one or not.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "That resolution id is not valid." }, { status: 400 });
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

  const decision = typeof body.decision === "string" ? body.decision : "";
  if (!DECISIONS.has(decision)) {
    return NextResponse.json(
      { ok: false, message: "Choose under review, approve, return or publish." },
      { status: 400 },
    );
  }

  const remark = typeof body.remark === "string" ? body.remark.trim() : "";
  if (decision === "returned" && !remark) {
    return NextResponse.json(
      { ok: false, message: messageFor("remark_required"), reason: "remark_required" },
      { status: 400 },
    );
  }

  try {
    const res = await callRpc<ReviewResult>("review_resolution", {
      p_session_token: token,
      p_resolution_id: id,
      p_decision: decision,
      p_remark: remark || null,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }

    return NextResponse.json({ ok: true, id: res.id, status: res.status });
  } catch (error) {
    console.error("[resolutions:review]", error);
    return NextResponse.json(
      { ok: false, message: "We could not record that decision." },
      { status: 500 },
    );
  }
}
