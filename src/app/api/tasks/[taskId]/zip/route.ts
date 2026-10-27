import { NextResponse } from "next/server";
import JSZip from "jszip";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { readSessionToken } from "@/lib/auth/session";
import { readLargeObject } from "@/lib/large-objects";

export const runtime = "nodejs";

type Detail = RpcResult & {
  task?: { title?: string };
  requirements?: Array<{
    id: string;
    label: string;
    verdicts?: Array<{ unitId: string; unitName: string; storagePath?: string | null; originalName?: string | null; largeObjectOid?: number }>;
  }>;
};

export async function GET(req: Request, ctx: { params: Promise<{ taskId: string }> }) {
  const token = await readSessionToken();
  if (!token) return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  const { taskId } = await ctx.params;
  try {
    const detail = await callRpc<Detail>("task_detail", { p_session_token: token, p_task_id: taskId });
    if (!detail.ok) return NextResponse.json({ ok: false, message: "Could not load task." }, { status: 404 });

    const zip = new JSZip();
    const folder = zip.folder(detail.task?.title || "task")!;

    for (const req of detail.requirements ?? []) {
      for (const v of req.verdicts ?? []) {
        if (!v.storagePath) continue;
        const fileRes = await callRpc<RpcResult & { largeObjectOid?: number; originalName?: string }>(
          "get_task_requirement_file",
          { p_session_token: token, p_requirement_id: req.id, p_unit_id: v.unitId },
        );
        if (!fileRes.ok || !fileRes.largeObjectOid) continue;
        const { stream: s } = await readLargeObject(fileRes.largeObjectOid);
        const chunks: Buffer[] = [];
        for await (const c of s) chunks.push(Buffer.from(c));
        const buf = Buffer.concat(chunks);
        const name = `${req.label}/${v.unitName}/${fileRes.originalName || v.originalName || "file"}`;
        folder.file(name, buf);
      }
    }

    const content = await zip.generateAsync({ type: "nodebuffer" });
    return new NextResponse(new Uint8Array(content), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="task-${taskId}.zip"`,
        "Content-Length": String(content.length),
      },
    });
  } catch (e) {
    console.error("[task-zip]", e);
    return NextResponse.json({ ok: false, message: "Could not build archive." }, { status: 500 });
  }
}