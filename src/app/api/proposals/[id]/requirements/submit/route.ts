import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { UUID_RE } from "@/lib/documents";

export const runtime = "nodejs";

type RequirementResponseItem = {
  requirementId: string;
  kind: "file" | "link";
  storagePath?: string;
  originalName?: string;
  mimeType?: string;
  sizeBytes?: number;
  linkUrl?: string;
};

type SubmitResult = RpcResult & {
  proposalId?: string;
  status?: string;
  version?: number;
  answered?: number;
};

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "rate_limited") return 429;
  if (reason === "forbidden") return 403;
  if (reason === "no_proposal") return 404;
  return 400;
}

/**
 * The loop back to the LSG: answers every open `requested` requirement on a
 * `requirements_requested` proposal in one call, mints the next proposal
 * version, and flips the proposal to `under_review`. The RPC is the authority
 * on what is open and what a file must satisfy, so the route only shapes the
 * request.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const { id } = await ctx.params;

  let body: { items?: RequirementResponseItem[]; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: messageFor("invalid_request") },
      { status: 400 },
    );
  }

  const items = Array.isArray(body.items) ? body.items : null;
  if (!items || items.length < 1) {
    return NextResponse.json(
      { ok: false, message: messageFor("invalid_request") },
      { status: 400 },
    );
  }
  if (items.some((item) => !UUID_RE.test(item?.requirementId ?? ""))) {
    return NextResponse.json(
      { ok: false, message: messageFor("invalid_request") },
      { status: 400 },
    );
  }

  try {
    const res = await callRpc<SubmitResult>("submit_requirement_response", {
      p_session_token: token,
      p_proposal_id: id,
      p_note: typeof body.note === "string" ? body.note : "",
      p_items: items,
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
      answered: res.answered,
    });
  } catch (error) {
    console.error("[proposals:requirements:submit]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}