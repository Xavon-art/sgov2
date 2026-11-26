import { NextResponse } from "next/server";

import { messageFor } from "@/lib/auth/messages";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { readSessionToken } from "@/lib/auth/session";
import { loadUnitRecipientIds, notifyAccounts } from "@/lib/notifications-server";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * The Request section's task surface.
 *
 * One route for both sides, because the office and a unit read the same list
 * from `list_my_tasks` -- the function decides scope from the session, and the
 * response tells the client which side it is on so the screen can adapt. That
 * is deliberate: two near-identical routes would eventually disagree about
 * scoping, and the scoping is the security boundary.
 *
 * GET   list the caller's tasks
 * POST  author a task (USG only; the function enforces it, not this route)
 */
type TaskPayload = RpcResult & {
  isUsg?: boolean;
  tasks?: Array<Record<string, unknown>>;
  taskId?: string;
  assignedUnits?: number;
  requirements?: number;
};

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "rate_limited") return 429;
  if (reason === "forbidden" || reason === "not_your_decision") return 403;
  if (reason === "not_found") return 404;
  return 400;
}

export async function GET(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const status = new URL(req.url).searchParams.get("status");

  try {
    const res = await callRpc<TaskPayload>("list_my_tasks", {
      p_session_token: token,
      p_status: status && status !== "all" ? status : null,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, reason: res.reason, message: messageFor(res.reason) },
        { status: statusForReason(res.reason) },
      );
    }

    return NextResponse.json({
      ok: true,
      isUsg: Boolean(res.isUsg),
      tasks: res.tasks ?? [],
    });
  } catch (error) {
    console.error("[tasks:read]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load your tasks." },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  // Authoring a task is the heaviest write in the section: it fans out to every
  // assigned unit and can carry a checklist. The limit is generous because an
  // office legitimately posts several in a sitting.
  const limit = rateLimit(`tasks:write:ip:${clientIp(req)}`, 40, 10 * 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, reason: "rate_limited", message: messageFor("rate_limited") },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const unitIds = Array.isArray(body.unitIds)
    ? body.unitIds.filter((value): value is string => typeof value === "string")
    : [];
  const gracePeriodMinutes = Number(body.gracePeriodMinutes ?? 0);
  const reviewSlaDays = body.reviewSlaDays === null || body.reviewSlaDays === undefined || body.reviewSlaDays === ""
    ? null
    : Number(body.reviewSlaDays);
  if (!Number.isInteger(gracePeriodMinutes) || gracePeriodMinutes < 0 || gracePeriodMinutes > 10080) {
    return NextResponse.json({ ok: false, reason: "invalid_request", message: messageFor("invalid_request") }, { status: 400 });
  }
  if (reviewSlaDays !== null && (!Number.isInteger(reviewSlaDays) || reviewSlaDays < 1 || reviewSlaDays > 30)) {
    return NextResponse.json({ ok: false, reason: "invalid_request", message: messageFor("invalid_request") }, { status: 400 });
  }

  try {
    const res = await callRpc<TaskPayload>("create_task_v2", {
      p_session_token: token,
      p_title: typeof body.title === "string" ? body.title : "",
      p_details: typeof body.details === "string" ? body.details : "",
      p_due_date: typeof body.dueDate === "string" && body.dueDate ? body.dueDate : null,
      p_due_time: typeof body.dueTime === "string" && body.dueTime ? body.dueTime : null,
      p_due_timezone: typeof body.dueTimezone === "string" && body.dueTimezone ? body.dueTimezone : null,
      p_priority: typeof body.priority === "string" ? body.priority : "normal",
      p_auto_close: body.autoClose === true,
      p_unit_ids: unitIds,
      p_requirements: Array.isArray(body.requirements) ? body.requirements : [],
      p_grace_period_minutes: gracePeriodMinutes,
      p_review_sla_days: reviewSlaDays,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, reason: res.reason, message: messageFor(res.reason) },
        { status: statusForReason(res.reason) },
      );
    }

    if (res.taskId) {
      const recipients = await loadUnitRecipientIds(token, unitIds);
      await notifyAccounts(
        token,
        recipients.map((id) => ({ id })),
        {
          kind: "task_created",
          title: "New task assigned",
          body: `A new task was assigned: ${typeof body.title === "string" ? body.title.trim() : "Untitled task"}`,
          link: `/lsg/request?tab=tasks&task=${res.taskId}`,
        },
      );
    }

    return NextResponse.json({
      ok: true,
      taskId: res.taskId,
      assignedUnits: res.assignedUnits ?? 0,
      requirements: res.requirements ?? 0,
    });
  } catch (error) {
    console.error("[tasks:write]", error);
    return NextResponse.json(
      { ok: false, message: "We could not create that task. Please try again." },
      { status: 500 },
    );
  }
}
