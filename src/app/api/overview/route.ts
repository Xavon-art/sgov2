import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { currentAccount, readSessionToken } from "@/lib/auth/session";
import { normalizeStatus, type Status } from "@/lib/status";

export const runtime = "nodejs";

type Counts = {
  tasksOpen: number;
  tasksOverdue: number;
  requestsOpen: number;
  eventsPending: number;
  surveysOpen: number;
};

type Breakdown = {
  tasks: Record<string, number>;
  requests: Record<string, number>;
  events: Record<string, number>;
  surveys: Record<string, number>;
};

type OverviewTask = {
  id?: string;
  title?: string;
  dueAt?: string | null;
  dueDate?: string | null;
  daysLeft?: number | null;
  gracePeriodMinutes?: number | null;
  closed?: boolean;
  overdue?: boolean;
  myStatus?: string | null;
  createdAt?: string | null;
};

type PersonalRequest = {
  id?: string;
  subject?: string;
  status?: string | null;
  decisionNote?: string | null;
  decidedAt?: string | null;
  mine?: boolean;
};

type ResolutionRow = {
  id?: string;
  title?: string;
  status?: string | null;
  decisionRemark?: string | null;
  decidedAt?: string | null;
};

type QueueItem = {
  taskId?: string;
  unitId?: string;
  taskTitle?: string;
  unitName?: string;
  campusName?: string;
  departmentName?: string;
  status?: string | null;
  submittedAt?: string | null;
  dueAt?: string | null;
  overdue?: boolean;
  late?: boolean;
};

type ActionItem = {
  id: string;
  title: string;
  dueAt: string | null;
  status: Status;
  tab: "tasks";
};

type DecisionItem = {
  id: string;
  title: string;
  status: Status;
  remark: string | null;
  decidedAt: string | null;
  tab: "personal" | "resolutions";
};

type FallingBehind = {
  unitId: string;
  unitName: string;
  campusName: string;
  departmentName: string;
  overdueCount: number;
};

type TaskProgress = {
  taskId: string;
  title: string;
  submitted: number;
  total: number;
  dueAt: string | null;
  overdue: boolean;
};

type LsgOverview = {
  nextAction: ActionItem | null;
  dueSoon: ActionItem[];
  statusCounts: Record<string, number>;
  recentDecisions: DecisionItem[];
  budget: {
    totalSpent: number;
    requestCount: number;
    approvedCount: number;
    remaining: number;
    periodCount: number;
  } | null;
};

type UsgOverview = {
  needsReview: number;
  statusCounts: Record<string, number>;
  fallingBehind: FallingBehind[];
  taskProgress: TaskProgress[];
  budget: {
    allocated: number;
    requested: number;
    approved: number;
    committed: number;
    spent: number;
    remaining: number;
    unitCount: number;
  } | null;
};

type ApiResponse = RpcResult & {
  account?: Record<string, unknown>;
  organization?: Record<string, unknown> | null;
  canCustomise?: boolean;
  counts?: Counts;
  breakdown?: Breakdown;
  lsg?: LsgOverview;
  usg?: UsgOverview;
};

function bump(bucket: Record<string, number>, key: string) {
  const normalized = key || "unknown";
  bucket[normalized] = (bucket[normalized] ?? 0) + 1;
}

function countStatus(bucket: Record<string, number>, status: Status) {
  bump(bucket, status);
}

function statusFor(raw: string | null | undefined, overdue = false): Status {
  const base = normalizeStatus(raw);
  if (base === "draft") return "pending";
  if (overdue && base !== "approved" && base !== "rejected") return "overdue";
  return base;
}

function dueTime(item: { dueAt?: string | null; dueDate?: string | null }): number {
  const raw = item.dueAt ?? item.dueDate;
  if (!raw) return Number.MAX_SAFE_INTEGER;
  const time = new Date(raw).getTime();
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

function actionItem(task: OverviewTask): ActionItem {
  return {
    id: String(task.id ?? ""),
    title: String(task.title ?? "Untitled task"),
    dueAt: task.dueAt ?? task.dueDate ?? null,
    status: statusFor(task.myStatus, task.overdue === true),
    tab: "tasks",
  };
}

function isActionable(task: OverviewTask): boolean {
  if (task.closed === true) return false;
  const status = normalizeStatus(task.myStatus);
  return status !== "approved" && status !== "rejected";
}

function normalizedDecisionStatus(raw: string | null | undefined): Status | null {
  const status = normalizeStatus(raw);
  return status === "approved" || status === "returned" ? status : null;
}

export async function GET(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const side = new URL(req.url).searchParams.get("side");

  try {
    const account = await currentAccount();
    if (!account) {
      return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
    }

    const profile = await callRpc<ApiResponse>("my_profile", { p_session_token: token });
    if (!profile.ok) {
      return NextResponse.json(
        { ok: false, reason: profile.reason, message: messageFor(profile.reason) },
        { status: 403 },
      );
    }

    const counts: Counts = {
      tasksOpen: 0,
      tasksOverdue: 0,
      requestsOpen: 0,
      eventsPending: 0,
      surveysOpen: 0,
    };
    const breakdown: Breakdown = { tasks: {}, requests: {}, events: {}, surveys: {} };

    let tasks: OverviewTask[] = [];
    try {
      const res = await callRpc<
        RpcResult & {
          tasks?: OverviewTask[];
        }
      >("list_my_tasks", { p_session_token: token, p_status: "" });
      if (res.ok && Array.isArray(res.tasks)) tasks = res.tasks;
      for (const task of tasks) {
        const closed = task.closed === true;
        if (!closed) counts.tasksOpen += 1;
        if (task.overdue === true) counts.tasksOverdue += 1;
        bump(
          breakdown.tasks,
          closed ? "closed" : task.overdue ? "overdue" : task.myStatus ?? "in progress",
        );
      }
    } catch {
      tasks = [];
    }

    let personal: PersonalRequest[] = [];
    try {
      const res = await callRpc<RpcResult & { requests?: PersonalRequest[] }>(
        "list_personal_requests",
        { p_session_token: token, p_status: "" },
      );
      if (res.ok && Array.isArray(res.requests)) personal = res.requests;
      for (const request of personal) {
        const raw = String(request.status ?? "").toLowerCase();
        if (raw === "submitted" || normalizeStatus(raw) === "under_review") counts.requestsOpen += 1;
        bump(breakdown.requests, raw);
      }
    } catch {
      personal = [];
    }

    try {
      const res = await callRpc<
        RpcResult & {
          events?: Array<{ status?: string; honorStatus?: string; cancelledAt?: string | null }>;
        }
      >("list_events", { p_session_token: token });
      if (res.ok && Array.isArray(res.events)) {
        for (const event of res.events) {
          const status = String(event.status ?? "").toLowerCase();
          if (normalizeStatus(status) === "under_review") counts.eventsPending += 1;
          bump(breakdown.events, status);
          if (event.honorStatus) bump(breakdown.events, `honor:${String(event.honorStatus).toLowerCase()}`);
          if (event.cancelledAt) bump(breakdown.events, "cancelled");
        }
      }
    } catch {
      counts.eventsPending = 0;
      breakdown.events = {};
    }

    try {
      const res = await callRpc<RpcResult & { surveys?: Array<{ status?: string }> }>("list_surveys", {
        p_session_token: token,
      });
      if (res.ok && Array.isArray(res.surveys)) {
        for (const survey of res.surveys) {
          const status = String(survey.status ?? "").toLowerCase();
          if (status === "open") counts.surveysOpen += 1;
          bump(breakdown.surveys, status);
        }
      }
    } catch {
      counts.surveysOpen = 0;
      breakdown.surveys = {};
    }

    let lsg: LsgOverview | undefined;
    let usg: UsgOverview | undefined;

    if (side === "lsg") {
      const lsgStatusCounts: Record<string, number> = {
        pending: 0,
        under_review: 0,
        returned: 0,
        approved: 0,
        overdue: 0,
      };
      for (const task of tasks) countStatus(lsgStatusCounts, statusFor(task.myStatus, task.overdue === true));

      const actionable = tasks.filter(isActionable).sort((a, b) => dueTime(a) - dueTime(b));
      const recentDecisions: DecisionItem[] = [];

      for (const request of personal) {
        const status = normalizedDecisionStatus(request.status);
        if (!status || !request.decidedAt) continue;
        recentDecisions.push({
          id: String(request.id ?? ""),
          title: String(request.subject ?? "Personal request"),
          status,
          remark: request.decisionNote ?? null,
          decidedAt: request.decidedAt,
          tab: "personal",
        });
      }

      try {
        const res = await callRpc<RpcResult & { rows?: ResolutionRow[] }>("list_resolutions", {
          p_session_token: token,
        });
        if (res.ok && Array.isArray(res.rows)) {
          for (const row of res.rows) {
            const status = normalizedDecisionStatus(row.status);
            if (!status || !row.decidedAt) continue;
            recentDecisions.push({
              id: String(row.id ?? ""),
              title: String(row.title ?? "Resolution"),
              status,
              remark: row.decisionRemark ?? null,
              decidedAt: row.decidedAt,
              tab: "resolutions",
            });
          }
        }
      } catch {
        recentDecisions.length = Math.min(recentDecisions.length, personal.length);
      }

      recentDecisions.sort((a, b) => String(b.decidedAt ?? "").localeCompare(String(a.decidedAt ?? "")));

      let budget: LsgOverview["budget"] = null;
      try {
        const res = await callRpc<
          RpcResult & {
            totalSpent?: number;
            requestCount?: number;
            approvedCount?: number;
            remaining?: number;
            periods?: unknown[];
          }
        >("lsg_budget_dashboard", { p_session_token: token });
        if (res.ok) {
          budget = {
            totalSpent: Number(res.totalSpent ?? 0),
            requestCount: Number(res.requestCount ?? 0),
            approvedCount: Number(res.approvedCount ?? 0),
            remaining: Number(res.remaining ?? 0),
            periodCount: Array.isArray(res.periods) ? res.periods.length : 0,
          };
        }
      } catch {
        budget = null;
      }

      lsg = {
        nextAction: actionable.length > 0 ? actionItem(actionable[0]) : null,
        dueSoon: actionable.slice(0, 5).map(actionItem),
        statusCounts: lsgStatusCounts,
        recentDecisions: recentDecisions.slice(0, 5),
        budget,
      };
    }

    if (side === "usg") {
      const queue: QueueItem[] = [];
      try {
        const res = await callRpc<RpcResult & { items?: QueueItem[] }>("list_review_queue", {
          p_session_token: token,
          p_status: null,
          p_campus: null,
          p_unit_id: null,
          p_due_from: null,
          p_due_to: null,
          p_overdue: null,
          p_late: null,
        });
        if (res.ok && Array.isArray(res.items)) queue.push(...res.items);
      } catch {
        queue.length = 0;
      }

      const statusCounts: Record<string, number> = {
        pending: 0,
        under_review: 0,
        returned: 0,
        approved: 0,
        overdue: 0,
      };
      for (const item of queue) countStatus(statusCounts, statusFor(item.status, item.overdue === true));

      const byUnit = new Map<string, FallingBehind>();
      for (const item of queue) {
        if (statusFor(item.status, item.overdue === true) !== "overdue") continue;
        const key = String(item.unitId ?? item.unitName ?? "unknown");
        const current =
          byUnit.get(key) ?? {
            unitId: String(item.unitId ?? ""),
            unitName: String(item.unitName ?? "Unnamed unit"),
            campusName: String(item.campusName ?? ""),
            departmentName: String(item.departmentName ?? ""),
            overdueCount: 0,
          };
        current.overdueCount += 1;
        byUnit.set(key, current);
      }
      const fallingBehind = [...byUnit.values()]
        .sort((a, b) => b.overdueCount - a.overdueCount || a.unitName.localeCompare(b.unitName))
        .slice(0, 5);

      const byTask = new Map<string, TaskProgress>();
      for (const item of queue) {
        const key = String(item.taskId ?? "");
        if (!key) continue;
        const progress =
          byTask.get(key) ?? {
            taskId: key,
            title: String(item.taskTitle ?? "Untitled task"),
            submitted: 0,
            total: 0,
            dueAt: item.dueAt ?? null,
            overdue: false,
          };
        progress.total += 1;
        if (item.submittedAt || normalizeStatus(item.status) !== "pending") progress.submitted += 1;
        if (item.overdue === true) progress.overdue = true;
        if (dueTime({ dueAt: item.dueAt }) < dueTime({ dueAt: progress.dueAt })) {
          progress.dueAt = item.dueAt ?? null;
        }
        byTask.set(key, progress);
      }
      const taskProgress = [...byTask.values()]
        .sort((a, b) => dueTime(a) - dueTime(b))
        .slice(0, 5);

      let budget: UsgOverview["budget"] = null;
      try {
        const res = await callRpc<
          RpcResult & {
            units?: unknown[];
            totals?: {
              allocated?: number;
              requested?: number;
              approved?: number;
              committed?: number;
              spent?: number;
              remaining?: number;
            };
          }
        >("budget_summary", { p_session_token: token });
        if (res.ok) {
          budget = {
            allocated: Number(res.totals?.allocated ?? 0),
            requested: Number(res.totals?.requested ?? 0),
            approved: Number(res.totals?.approved ?? 0),
            committed: Number(res.totals?.committed ?? 0),
            spent: Number(res.totals?.spent ?? 0),
            remaining: Number(res.totals?.remaining ?? 0),
            unitCount: Array.isArray(res.units) ? res.units.length : 0,
          };
        }
      } catch {
        budget = null;
      }

      usg = {
        needsReview: queue.filter((item) => normalizeStatus(item.status) === "under_review").length,
        statusCounts,
        fallingBehind,
        taskProgress,
        budget,
      };
    }

    return NextResponse.json({
      ok: true,
      account: profile.account ?? null,
      organization: profile.organization ?? null,
      canCustomise: Boolean(profile.canCustomise),
      counts,
      breakdown,
      ...(lsg ? { lsg } : {}),
      ...(usg ? { usg } : {}),
    });
  } catch (error) {
    console.error("[overview:read]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load your overview." },
      { status: 500 },
    );
  }
}
