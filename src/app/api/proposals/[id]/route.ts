import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

type DetailResult = RpcResult & {
  proposal?: Record<string, unknown>;
};

type SubmitResult = RpcResult & {
  proposalId?: string;
  status?: string;
  version?: number;
};

type SubmissionItem = {
  requirement_item_id?: string;
  kind?: string;
  originalName?: string;
  storagePath?: string;
  sizeBytes?: number;
  mimeType?: string;
  linkUrl?: string;
};

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "rate_limited") return 429;
  if (reason === "forbidden") return 403;
  return 400;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const { id } = await ctx.params;
  try {
    const res = await callRpc<DetailResult>("proposal_detail", {
      p_session_token: token,
      p_proposal_id: id,
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason) },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true, proposal: res.proposal });
  } catch (error) {
    console.error("[proposals:detail]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load that proposal." },
      { status: 500 },
    );
  }
}

/**
 * Submit a revision.
 *
 * The route does not inspect the files. It could not check them honestly anyway:
 * the bytes are in a large object, and the only connection in the app that could
 * read one belongs to the route that serves downloads. Instead `proposal_items_valid`
 * re-reads each stored document inside the transaction that writes the submission,
 * which is strictly better than a pre-read -- the document and the row claiming it
 * are checked against each other at the same instant.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const { id } = await ctx.params;

  let body: { items?: SubmissionItem[]; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Something went wrong. Please try again." },
      { status: 400 },
    );
  }

  const items = Array.isArray(body.items) ? body.items : [];
  try {
    // No pre-flight size check here. `proposal_items_valid` re-reads each stored
    // document inside the same transaction that writes the submission, so the bytes
    // and the row that claims them are checked against each other atomically. A
    // pre-read would only be able to agree with them at some earlier moment.
    const res = await callRpc<SubmitResult>("submit_revision", {
      p_session_token: token,
      p_proposal_id: id,
      p_items: items,
      p_note: body.note ?? "",
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
    console.error("[proposals:revise]", error);
    return NextResponse.json(
      { ok: false, message: "We could not submit that revision." },
      { status: 500 },
    );
  }
}