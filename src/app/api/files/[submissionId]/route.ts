import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { createSignedDownloadUrl } from "@/lib/storage";

export const runtime = "nodejs";

type FileResult = RpcResult & {
  storagePath?: string;
};

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "rate_limited") return 429;
  if (reason === "forbidden") return 403;
  return 400;
}

/**
 * Download gate for a single submitted document. `get_item_file` re-scopes the
 * caller inside Postgres and only returns a storage path the caller may read;
 * this route turns that allowed path into a short-lived signed URL and redirects
 * the browser to it. A caller who is neither the author, a reviewer, nor in the
 * submitting unit gets the same answer as a missing row.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ submissionId: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const { submissionId } = await ctx.params;
  try {
    const res = await callRpc<FileResult>("get_item_file", {
      p_session_token: token,
      p_submission_id: submissionId,
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason) },
        { status: statusForReason(res.reason) },
      );
    }
    if (!res.storagePath) {
      return NextResponse.json(
        { ok: false, message: messageFor("not_found") },
        { status: 404 },
      );
    }
    const url = await createSignedDownloadUrl(res.storagePath);
    return NextResponse.redirect(url);
  } catch (error) {
    console.error("[files:get]", error);
    return NextResponse.json(
      { ok: false, message: "We could not fetch that file." },
      { status: 500 },
    );
  }
}