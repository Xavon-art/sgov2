import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { objectSize } from "@/lib/storage";

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
 * Submit a revision. Every `file` entry must have already been uploaded to the
 * path it names: the presign route mints the slot, the browser PUTs the bytes,
 * and only then does this route let the write go through. Verifying against
 * Storage (not just the body) is what stops a client from naming a path it
 * never uploaded to -- the DB trusts the path and later binds the document to
 * it, so the object has to exist here, now, at the declared size.
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
    for (const entry of items) {
      if (entry.kind !== "file") continue;
      if (!entry.storagePath) {
        return NextResponse.json(
          { ok: false, message: "That file has not uploaded yet." },
          { status: 400 },
        );
      }
      const size = await objectSize(entry.storagePath);
      if (size === null || size !== entry.sizeBytes) {
        return NextResponse.json(
          { ok: false, message: "That file has not uploaded yet." },
          { status: 400 },
        );
      }
    }

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