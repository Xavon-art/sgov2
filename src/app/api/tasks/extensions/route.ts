import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const token = await readSessionToken();
  if (!token) return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  const taskId = new URL(req.url).searchParams.get("taskId");
  if (!taskId) return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  try {
    const res = await callRpc<RpcResult & { extensions?: unknown }>("list_task_extensions", {
      p_session_token: token,
      p_task_id: taskId,
    });
    if (!res.ok) return NextResponse.json({ ok: false, message: messageFor(res.reason) }, { status: 400 });
    return NextResponse.json({ ok: true, extensions: res.extensions ?? [] });
  } catch {
    return NextResponse.json({ ok: false, message: "Could not load extensions." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 }); }
  const action = body.action;
  try {
    if (action === "request") {
      const requestedDueAt = typeof body.requestedDueAt === "string" ? body.requestedDueAt : "";
      if (!requestedDueAt) {
        return NextResponse.json({ ok: false, reason: "past_deadline", message: messageFor("past_deadline") }, { status: 400 });
      }
      const res = await callRpc<RpcResult>("request_task_extension", {
        p_session_token: token,
        p_task_id: String(body.taskId ?? ""),
        p_unit_id: String(body.unitId ?? ""),
        p_requested_due_at: requestedDueAt,
        p_reason: String(body.reason ?? ""),
      });
      if (!res.ok) return NextResponse.json({ ok: false, message: messageFor(res.reason) }, { status: 400 });
      return NextResponse.json({ ok: true });
    }
    if (action === "decide") {
      const rawDecision = String(body.decision ?? "").toLowerCase();
      const decision = rawDecision === "granted" ? "approved" : rawDecision === "denied" ? "rejected" : rawDecision;
      const note = String(body.note ?? "");
      if (decision === "rejected" && note.trim().length < 2) {
        return NextResponse.json({ ok: false, reason: "remark_required", message: messageFor("remark_required") }, { status: 400 });
      }
      const res = await callRpc<RpcResult>("decide_task_extension", {
        p_session_token: token,
        p_extension_id: String(body.extensionId ?? ""),
        p_decision: decision,
        p_note: note,
      });
      if (!res.ok) return NextResponse.json({ ok: false, message: messageFor(res.reason) }, { status: 400 });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, message: "Unknown action." }, { status: 400 });
  } catch {
    return NextResponse.json({ ok: false, message: "Could not save." }, { status: 500 });
  }
}