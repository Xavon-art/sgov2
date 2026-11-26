import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { budgetStatusForReason } from "@/lib/budget-api";
import { contentDispositionFor, readLargeObject } from "@/lib/large-objects";

export const runtime = "nodejs";

type FileResult = RpcResult & {
  oid?: string | number;
  originalName?: string;
  mimeType?: string;
  sizeBytes?: number;
};

export async function GET(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const storagePath = new URL(req.url).searchParams.get("path");
  if (!storagePath) {
    return NextResponse.json({ ok: false, message: "Choose a file to open." }, { status: 400 });
  }

  try {
    const res = await callRpc<FileResult>("get_budget_file", {
      p_session_token: token,
      p_storage_path: storagePath,
    });
    if (!res.ok || res.oid === undefined) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason ?? "not_found") },
        { status: res.ok ? 404 : budgetStatusForReason(res.reason) },
      );
    }

    const { stream, sizeBytes } = await readLargeObject(res.oid);

    return new NextResponse(stream as unknown as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": res.mimeType || "application/octet-stream",
        "Content-Length": String(res.sizeBytes ?? sizeBytes),
        "Content-Disposition": contentDispositionFor(res.originalName ?? "budget-file"),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("[budget-files:download]", error);
    return NextResponse.json({ ok: false, message: "We could not open that file." }, { status: 500 });
  }
}
