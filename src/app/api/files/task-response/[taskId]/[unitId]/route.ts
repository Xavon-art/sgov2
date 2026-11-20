import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { readLargeObject, contentDispositionFor } from "@/lib/large-objects";

export const runtime = "nodejs";

type FileResult = RpcResult & {
  originalName?: string;
  mimeType?: string;
  sizeBytes?: number;
  largeObjectOid?: number;
};

export async function GET(_req: Request, ctx: { params: Promise<{ taskId: string; unitId: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const { taskId, unitId } = await ctx.params;

  try {
    const res = await callRpc<FileResult>("get_task_assignment_file", {
      p_session_token: token,
      p_task_id: taskId,
      p_unit_id: unitId,
    });

    if (!res.ok || !res.largeObjectOid) {
      return NextResponse.json({ ok: false, message: messageFor(res.reason) }, { status: 404 });
    }

    const { stream } = await readLargeObject(res.largeObjectOid);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c));
    const buf = Buffer.concat(chunks);

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": res.mimeType || "application/octet-stream",
        "Content-Disposition": contentDispositionFor(res.originalName || "response"),
        "Content-Length": String(buf.length),
      },
    });
  } catch (e) {
    console.error("[task-response-file]", e);
    return NextResponse.json({ ok: false, message: "Could not read file." }, { status: 500 });
  }
}
