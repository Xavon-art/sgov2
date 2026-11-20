import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { contentDispositionFor, readLargeObject } from "@/lib/large-objects";

export const runtime = "nodejs";

type DocumentResult = RpcResult & {
  oid?: string | number;
  originalName?: string;
  mimeType?: string;
  sizeBytes?: number;
};

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "rate_limited") return 429;
  if (reason === "forbidden") return 403;
  return 400;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ resolutionId: string }> },
) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const { resolutionId } = await ctx.params;

  try {
    const res = await callRpc<DocumentResult>("get_resolution_file", {
      p_session_token: token,
      p_resolution_id: resolutionId,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason) },
        { status: statusForReason(res.reason) },
      );
    }
    if (res.oid === undefined) {
      return NextResponse.json(
        { ok: false, message: messageFor("not_found") },
        { status: 404 },
      );
    }

    const { stream, sizeBytes } = await readLargeObject(res.oid);

    return new NextResponse(stream as unknown as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": res.mimeType || "application/octet-stream",
        "Content-Length": String(res.sizeBytes ?? sizeBytes),
        "Content-Disposition": contentDispositionFor(res.originalName ?? "resolution"),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("[files:resolution]", error);
    return NextResponse.json(
      { ok: false, message: "We could not fetch that file." },
      { status: 500 },
    );
  }
}
