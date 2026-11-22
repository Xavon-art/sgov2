import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { contentDispositionFor, readLargeObject } from "@/lib/large-objects";

export const runtime = "nodejs";

type DocumentResult = RpcResult & {
  oid?: number | string;
  originalName?: string;
  mimeType?: string;
  sizeBytes?: number;
  downloadUrl?: string | null;
  externalUrl?: string | null;
  title?: string;
};

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "forbidden") return 403;
  if (reason === "not_found") return 404;
  if (reason === "rate_limited") return 429;
  return 400;
}

export async function GET(_req: Request, ctx: { params: Promise<{ documentKey: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const { documentKey } = await ctx.params;
  if (!/^[a-f0-9]{32}$/i.test(documentKey)) {
    return NextResponse.json(
      { ok: false, message: "That document reference is not valid." },
      { status: 400 },
    );
  }

  try {
    const res = await callRpc<DocumentResult>("get_catalog_document", {
      p_session_token: token,
      p_document_key: documentKey,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }

    if (res.externalUrl) {
      let target: URL;
      try {
        target = new URL(res.externalUrl);
      } catch {
        return NextResponse.json(
          { ok: false, message: "That support link is not valid." },
          { status: 400 },
        );
      }
      return NextResponse.redirect(target, 302);
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
        "Content-Disposition": contentDispositionFor(res.originalName ?? res.title ?? "document"),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("[catalog-files:get]", error);
    return NextResponse.json(
      { ok: false, message: "We could not fetch that file." },
      { status: 500 },
    );
  }
}
