import { NextResponse } from "next/server";
import { messageFor } from "@/lib/auth/messages";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

type TimelinePayload = RpcResult & {
  events?: Array<Record<string, unknown>>;
};

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "forbidden" || reason === "not_your_decision") return 403;
  if (reason === "not_found") return 404;
  return 400;
}

export async function GET(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const params = new URL(req.url).searchParams;
  const taskId = params.get("taskId");
  const unitId = params.get("unitId");
  if (!taskId || !unitId) {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  try {
    const res = await callRpc<TimelinePayload>("list_item_timeline", {
      p_session_token: token,
      p_task_id: taskId,
      p_unit_id: unitId,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, reason: res.reason, message: messageFor(res.reason) },
        { status: statusForReason(res.reason) },
      );
    }

    return NextResponse.json({ ok: true, events: res.events ?? [] });
  } catch (error) {
    console.error("[timeline:read]", error);
    return NextResponse.json({ ok: false, message: "We could not load the timeline." }, { status: 500 });
  }
}
