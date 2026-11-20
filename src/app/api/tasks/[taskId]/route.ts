import { NextResponse } from "next/server";

import { messageFor } from "@/lib/auth/messages";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

/**
 * One task, opened.
 *
 * GET reads the task, its requirements, every unit's progress, and -- for the
 * office only -- each unit's answer with the verdict on it. `task_detail`
 * decides that; this route just forwards.
 *
 * PATCH is the office closing a task (the closing statement travels with it) or
 * a unit recording its own status. Three different write paths share one verb
 * here because they are all "change something about this assignment", and the
 * RPCs each enforce their own scope -- a unit passing `closeTask` is refused by
 * `close_task`, not by this route guessing.
 */
type DetailPayload = RpcResult & {
  task?: Record<string, unknown>;
  requirements?: Array<Record<string, unknown>>;
  assignments?: Array<Record<string, unknown>>;
  responses?: Array<Record<string, unknown>>;
  canClose?: boolean;
  isUsg?: boolean;
  myUnitIds?: string[];
};

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "rate_limited") return 429;
  if (reason === "forbidden") return 403;
  if (reason === "not_found") return 404;
  return 400;
}

export async function GET(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const taskId = new URL(req.url).searchParams.get("taskId");
  if (!taskId) {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  try {
    const res = await callRpc<DetailPayload>("task_detail", {
      p_session_token: token,
      p_task_id: taskId,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, reason: res.reason, message: messageFor(res.reason) },
        { status: statusForReason(res.reason) },
      );
    }

    const responses = await callRpc<DetailPayload>("task_assignment_responses", {
      p_session_token: token,
      p_task_id: taskId,
    });

    return NextResponse.json({
      ok: true,
      task: res.task ?? null,
      requirements: res.requirements ?? [],
      assignments: res.assignments ?? [],
      responses: responses.ok ? (responses.assignments ?? []) : [],
      canClose: Boolean(res.canClose),
      isUsg: Boolean(res.isUsg),
      myUnitIds: res.myUnitIds ?? [],
    });
  } catch (error) {
    console.error("[task:read]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load that task." },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const action = body.action;
  const taskId = typeof body.taskId === "string" ? body.taskId : "";
  if (!taskId) {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  try {
    // Closing the task is the office's, and it applies to every unit at once.
    if (action === "close") {
      const res = await callRpc<RpcResult>("close_task", {
        p_session_token: token,
        p_task_id: taskId,
        p_note: typeof body.note === "string" ? body.note : "",
      });
      if (!res.ok) {
        return NextResponse.json(
          { ok: false, reason: res.reason, message: messageFor(res.reason) },
          { status: statusForReason(res.reason) },
        );
      }
      return NextResponse.json({ ok: true });
    }

    // Granting completion is also the office's, per unit.
    if (action === "grant") {
      const res = await callRpc<RpcResult>("confirm_assignment_done", {
        p_session_token: token,
        p_task_id: taskId,
        p_unit_id: typeof body.unitId === "string" ? body.unitId : "",
        p_note: typeof body.note === "string" ? body.note : "",
      });
      if (!res.ok) {
        return NextResponse.json(
          { ok: false, reason: res.reason, message: messageFor(res.reason) },
          { status: statusForReason(res.reason) },
        );
      }
      return NextResponse.json({ ok: true });
    }

    // An assigned unit filing its own answer: a note and, optionally, one
    // uploaded document. The RPC owns the scope check.
    if (action === "respond") {
      const res = await callRpc<RpcResult>("submit_assignment_response", {
        p_session_token: token,
        p_task_id: taskId,
        p_unit_id: typeof body.unitId === "string" ? body.unitId : "",
        p_note: typeof body.note === "string" ? body.note : "",
        p_storage_path: typeof body.storagePath === "string" ? body.storagePath : null,
      });
      if (!res.ok) {
        return NextResponse.json(
          { ok: false, reason: res.reason, message: messageFor(res.reason) },
          { status: statusForReason(res.reason) },
        );
      }
      return NextResponse.json({ ok: true });
    }

    // A unit moving its own assignment along the ladder.
    if (action === "status") {
      const res = await callRpc<RpcResult>("update_assignment_status", {
        p_session_token: token,
        p_task_id: taskId,
        p_unit_id: typeof body.unitId === "string" ? body.unitId : "",
        p_status: typeof body.status === "string" ? body.status : "",
        p_note: typeof body.note === "string" ? body.note : "",
      });
      if (!res.ok) {
        return NextResponse.json(
          { ok: false, reason: res.reason, message: messageFor(res.reason) },
          { status: statusForReason(res.reason) },
        );
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, message: "Unknown action." }, { status: 400 });
  } catch (error) {
    console.error("[task:write]", error);
    return NextResponse.json(
      { ok: false, message: "We could not save that. Please try again." },
      { status: 500 },
    );
  }
}
