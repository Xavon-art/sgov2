import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { contentDispositionFor, readLargeObject } from "@/lib/large-objects";

export const runtime = "nodejs";

type AccomplishmentFileResult = RpcResult & {
  oid?: string | number;
  originalName?: string;
  mimeType?: string;
  sizeBytes?: number;
};

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "rate_limited") return 429;
  if (reason === "forbidden") return 403;
  if (reason === "not_found") return 404;
  return 400;
}

/**
 * Streams one file attached to an accomplishment report.
 *
 * `get_accomplishment_file` applies the same visibility rule as the report
 * itself, so a caller who cannot see the report cannot learn whether a file id
 * exists. As with `/api/files`, the bytes live in a large object and the route
 * has to send them itself.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ fileId: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const { fileId } = await ctx.params;

  try {
    const res = await callRpc<AccomplishmentFileResult>("get_accomplishment_file", {
      p_session_token: token,
      p_file_id: fileId,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason) },
        { status: statusForReason(res.reason) },
      );
    }

    if (res.oid === undefined) {
      return NextResponse.json({ ok: false, message: messageFor("not_found") }, { status: 404 });
    }

    const { stream, sizeBytes } = await readLargeObject(res.oid);

    return new NextResponse(stream as unknown as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": res.mimeType || "application/octet-stream",
        "Content-Length": String(res.sizeBytes ?? sizeBytes),
        "Content-Disposition": contentDispositionFor(res.originalName ?? "document"),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("[accomplishment-files:get]", error);
    return NextResponse.json({ ok: false, message: "We could not fetch that file." }, { status: 500 });
  }
}
