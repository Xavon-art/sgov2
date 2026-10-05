import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import type { Task } from "@/lib/tasks";

export const runtime = "nodejs";

type ListResult = RpcResult & { scope?: string; tasks?: Task[] };
type WriteResult = RpcResult & {
  taskId?: string;
  assignedUnits?: number;
  status?: string;
  unitId?: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITIES = new Set(["low", "normal", "high"]);
const STATUSES = new Set(["assigned", "in_progress", "done"]);

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "rate_limited") return 429;
  if (reason === "forbidden" || reason === "not_your_decision") return 403;
  if (reason === "not_found") return 404;
  return 400;
}

/**
 * Every task the caller may see, scoped in SQL.
 *
 * USG gets the organization with every unit's answer attached. An LSG officer gets
 * only tasks addressed to their own unit, and the assignment list is trimmed to
 * that same unit -- the payload never carries a row naming a unit they are not in,
 * so there is nothing to filter out in the browser.
 */
export async function GET() {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  try {
    const res = await callRpc<ListResult>("list_tasks", { p_session_token: token });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({
      ok: true,
      scope: res.scope ?? "unit",
      tasks: res.tasks ?? [],
    });
  } catch (error) {
    console.error("[tasks:list]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load the tasks." },
      { status: 500 },
    );
  }
}

/**
 * Assign a new task to one unit, several, or all of them.
 *
 * An empty `unitIds` means every unit, which is a convenience the SQL expands. This
 * route only checks the shape, because whether the caller may create a task at all
 * is a question the function answers on its own.
 */
export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: {
    title?: unknown;
    details?: unknown;
    dueDate?: unknown;
    priority?: unknown;
    unitIds?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Send the task as JSON." },
      { status: 400 },
    );
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length < 4 || title.length > 140) {
    return NextResponse.json(
      { ok: false, message: messageFor("invalid_title"), reason: "invalid_title" },
      { status: 400 },
    );
  }

  let dueDate: string | null = null;
  if (typeof body.dueDate === "string" && body.dueDate.trim()) {
    dueDate = body.dueDate.trim();
    if (!ISO_DATE.test(dueDate)) {
      return NextResponse.json(
        { ok: false, message: "That deadline is not a date this office can use." },
        { status: 400 },
      );
    }
  }

  const priority = typeof body.priority === "string" ? body.priority : "normal";
  if (!PRIORITIES.has(priority)) {
    return NextResponse.json(
      { ok: false, message: "Choose a priority of low, normal or high." },
      { status: 400 },
    );
  }

  if (!Array.isArray(body.unitIds)) {
    return NextResponse.json(
      { ok: false, message: messageFor("invalid_request"), reason: "invalid_request" },
      { status: 400 },
    );
  }

  try {
    const res = await callRpc<WriteResult>("create_task", {
      p_session_token: token,
      p_title: title,
      p_details: typeof body.details === "string" ? body.details.trim() : "",
      p_due_date: dueDate,
      p_priority: priority,
      p_unit_ids: body.unitIds,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }

    return NextResponse.json({
      ok: true,
      taskId: res.taskId,
      assignedUnits: res.assignedUnits ?? 0,
    });
  } catch (error) {
    console.error("[tasks:create]", error);
    return NextResponse.json(
      { ok: false, message: "We could not create that task." },
      { status: 500 },
    );
  }
}

/**
 * Move one unit's answer on one task.
 *
 * This is a POST and not a PATCH because the target is not the task: a task to
 * twelve units has twelve answers, and the row being written is a single unit's.
 * Routing on `taskId` alone would leave no way to say which one moved.
 */
export async function PATCH(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: { taskId?: unknown; unitId?: unknown; status?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Send the update as JSON." },
      { status: 400 },
    );
  }

  const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
  const unitId = typeof body.unitId === "string" ? body.unitId.trim() : "";
  const status = typeof body.status === "string" ? body.status : "";

  if (!taskId || !unitId) {
    return NextResponse.json(
      { ok: false, message: "A task and a unit are both needed." },
      { status: 400 },
    );
  }
  if (!STATUSES.has(status)) {
    return NextResponse.json(
      { ok: false, message: "Choose not started, in progress or done." },
      { status: 400 },
    );
  }

  try {
    const res = await callRpc<WriteResult>("update_task_status", {
      p_session_token: token,
      p_task_id: taskId,
      p_unit_id: unitId,
      p_status: status,
      p_note: typeof body.note === "string" ? body.note.trim() : "",
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }

    return NextResponse.json({
      ok: true,
      taskId: res.taskId,
      unitId: res.unitId,
      status: res.status,
    });
  } catch (error) {
    console.error("[tasks:update]", error);
    return NextResponse.json(
      { ok: false, message: "We could not record that update." },
      { status: 500 },
    );
  }
}