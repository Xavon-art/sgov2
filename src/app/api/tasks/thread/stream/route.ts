import { NextRequest } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = await readSessionToken();
  if (!token) return new Response("unauthorized", { status: 401 });
  const taskId = req.nextUrl.searchParams.get("taskId");
  if (!taskId) return new Response("bad request", { status: 400 });

  const encoder = new TextEncoder();
  let lastHash = "";
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      const tick = async () => {
        if (closed) return;
        try {
          const res = await callRpc<RpcResult & { messages?: unknown[]; closed?: boolean }>(
            "list_task_thread",
            { p_session_token: token, p_task_id: taskId },
          );
          if (res.ok) {
            const hash = JSON.stringify(res.messages ?? []);
            if (hash !== lastHash) {
              lastHash = hash;
              send({ messages: res.messages ?? [], closed: res.closed ?? false });
            }
          }
        } catch {
          // ignore
        }
      };
      await tick();
      const interval = setInterval(() => void tick(), 2000);
      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(interval);
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}