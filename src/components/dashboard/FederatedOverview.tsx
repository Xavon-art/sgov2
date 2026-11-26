"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Reveal } from "@/components/fx/Reveal";
import { ButtonLink } from "@/components/ui/Button";
import { CountdownChip } from "@/components/ui/CountdownChip";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { type NavItem } from "@/components/dashboard/AppShell";
import { SectionIcon } from "@/components/dashboard/workspace-shared";
import { formatDate, formatMoney } from "@/lib/budgets";
import { STATUS_LABEL, type Status } from "@/lib/status";
import { IconArrowRight, IconDashboard } from "@/components/ui/Icons";

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

type LsgPayload = {
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

type UsgPayload = {
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

type OverviewPayload = {
  ok: boolean;
  lsg?: LsgPayload;
  usg?: UsgPayload;
  message?: string;
};

type Signal = { key: Status; label: string };

const SIGNALS: Signal[] = [
  { key: "pending", label: STATUS_LABEL.pending },
  { key: "under_review", label: STATUS_LABEL.under_review },
  { key: "returned", label: STATUS_LABEL.returned },
  { key: "approved", label: STATUS_LABEL.approved },
  { key: "overdue", label: STATUS_LABEL.overdue },
];

function hrefFor(nav: NavItem[], id: string, fallback: string): string {
  return nav.find((item) => item.id === id)?.href ?? fallback;
}

function withParams(href: string, params: Record<string, string>): string {
  const [path, query] = href.split("?");
  const next = new URLSearchParams(query ?? "");
  for (const [key, value] of Object.entries(params)) {
    if (value) next.set(key, value);
  }
  const encoded = next.toString();
  return encoded ? `${path}?${encoded}` : path;
}

function taskHref(requestHref: string, taskId: string): string {
  return withParams(requestHref, { tab: "tasks", task: taskId });
}

function tabHref(requestHref: string, tab: string): string {
  return withParams(requestHref, { tab });
}

function statusHref(requestHref: string, status: Status): string {
  return withParams(requestHref, { tab: "tasks", status });
}

function countFor(counts: Record<string, number> | undefined, status: Status): number {
  return Number(counts?.[status] ?? 0);
}

function ProgressBar({ value, total }: { value: number; total: number }) {
  const percent = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-canvas" aria-hidden="true">
      <div className="h-full rounded-full bg-brass" style={{ width: `${percent}%` }} />
    </div>
  );
}

export function FederatedOverview({
  nav,
  side,
}: {
  nav: NavItem[];
  side: "usg" | "lsg";
}) {
  const [payload, setPayload] = useState<OverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`/api/overview?side=${side}`);
        const body = (await res.json().catch(() => ({}))) as OverviewPayload;
        if (!alive) return;
        if (res.ok && body.ok) {
          setPayload(body);
          setError("");
        } else {
          setPayload(null);
          setError(body.message ?? "We could not load your overview.");
        }
      } catch {
        if (alive) setError("We could not load your overview.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [side]);

  const requestHref = useMemo(() => hrefFor(nav, "request", `/${side}/request`), [nav, side]);
  const manageHref = useMemo(() => hrefFor(nav, "manage", `/${side}/manage`), [nav, side]);
  const eventsHref = useMemo(() => hrefFor(nav, "events", `/${side}/events`), [nav, side]);
  const inboxHref = useMemo(() => hrefFor(nav, "messages", `/${side}/messages`), [nav, side]);

  const signals = payload?.[side]?.statusCounts;
  const headerTitle = side === "usg" ? "What needs your decision" : "What you must do next";
  const headerCopy =
    side === "usg"
      ? "Start with the oldest review, then work down the status strip."
      : "Start with the earliest deadline, then work down the status strip.";

  return (
    <div className="mx-auto flex w-full max-w-[76rem] flex-col gap-5 px-4 py-8 sm:px-6 lg:px-10">
      <Reveal>
        <header data-tour="workspace-header" className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <p className="eyebrow">Overview</p>
            <div className="flex items-center gap-3">
              <SectionIcon>
                <IconDashboard className="h-5 w-5" strokeWidth={1.7} />
              </SectionIcon>
              <h1 className="text-[clamp(1.8rem,3.4vw,2.8rem)] leading-tight">{headerTitle}</h1>
            </div>
            <p className="max-w-2xl text-sm text-body">{headerCopy}</p>
          </div>
          <ButtonLink href={tabHref(requestHref, "tasks")} variant="outline" size="sm">
            Open Request
            <IconArrowRight className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          </ButtonLink>
        </header>
      </Reveal>

      {error ? (
        <p role="alert" className="rounded-xl border border-[#a5442c] bg-[#a5442c]/[0.08] p-4 text-sm text-[#a5442c]">
          {error}
        </p>
      ) : null}

      <section data-tour="workspace-tiles" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {SIGNALS.map((signal) => (
          <Link
            key={signal.key}
            href={statusHref(requestHref, signal.key)}
            className="rounded-2xl border border-line bg-paper p-3 text-left transition hover:border-ink/25 hover:shadow-lift"
          >
            <div className="text-[0.7rem] uppercase tracking-[0.16em] text-muted">{signal.label}</div>
            <div className="mt-1 text-2xl font-medium tabular-nums">{countFor(signals, signal.key)}</div>
          </Link>
        ))}
      </section>

      {loading ? <p className="text-sm text-muted">Loading your overview...</p> : null}

      {!loading && side === "lsg" && payload?.lsg ? (
        <LsgPath data={payload.lsg} requestHref={requestHref} manageHref={manageHref} />
      ) : null}

      {!loading && side === "usg" && payload?.usg ? (
        <UsgPath data={payload.usg} requestHref={requestHref} manageHref={manageHref} />
      ) : null}

      {!loading && !error ? (
        <div data-tour="workspace-shortcuts" className="flex flex-wrap gap-2 rounded-2xl border border-line bg-paper p-4">
          {side === "usg" ? (
            <ButtonLink href={tabHref(requestHref, "tasks")} size="sm" variant="brass">
              Create Task
            </ButtonLink>
          ) : (
            <ButtonLink href={tabHref(requestHref, "tasks")} size="sm" variant="brass">
              Request
            </ButtonLink>
          )}
          <ButtonLink href={eventsHref} size="sm" variant="outline">
            Events
          </ButtonLink>
          <ButtonLink href={inboxHref} size="sm" variant="outline">
            Inbox
          </ButtonLink>
        </div>
      ) : null}
    </div>
  );
}

function LsgPath({
  data,
  requestHref,
  manageHref,
}: {
  data: LsgPayload;
  requestHref: string;
  manageHref: string;
}) {
  return (
    <div className="grid gap-5">
      <section
        data-tour="workspace-overview-action"
        className="rounded-2xl border border-line bg-paper p-5 sm:p-6"
      >
        <p className="eyebrow">Next action</p>
        {data.nextAction ? (
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div className="grid gap-2">
              <div className="text-xl font-medium">{data.nextAction.title}</div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={data.nextAction.status} />
                <CountdownChip dueAt={data.nextAction.dueAt} />
              </div>
            </div>
            <ButtonLink href={taskHref(requestHref, data.nextAction.id)}>
              Open item
              <IconArrowRight className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            </ButtonLink>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <p className="text-sm text-muted">Nothing urgent is waiting right now.</p>
            <ButtonLink href={tabHref(requestHref, "tasks")} variant="outline" size="sm">
              Review all tasks
            </ButtonLink>
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <section data-tour="workspace-overview-list" className="rounded-2xl border border-line bg-paper p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Deadlines</p>
              <h2 className="text-lg font-medium">Due soon</h2>
            </div>
            <Link href={statusHref(requestHref, "overdue")} className="text-sm underline">
              See overdue
            </Link>
          </div>
          <div className="grid gap-2">
            {data.dueSoon.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">
                No open deadlines.
              </p>
            ) : null}
            {data.dueSoon.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-3">
                <div className="grid gap-1">
                  <Link href={taskHref(requestHref, item.id)} className="text-sm font-medium hover:underline">
                    {item.title}
                  </Link>
                  <StatusBadge status={item.status} />
                </div>
                <div className="flex items-center gap-2">
                  <CountdownChip dueAt={item.dueAt} />
                  <ButtonLink href={taskHref(requestHref, item.id)} size="sm" variant="ghost">
                    Open
                  </ButtonLink>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-paper p-5">
          <p className="eyebrow">Feedback</p>
          <h2 className="text-lg font-medium">Recent USG decisions</h2>
          <div className="mt-3 grid gap-2">
            {data.recentDecisions.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">
                No decisions yet.
              </p>
            ) : null}
            {data.recentDecisions.map((item) => (
              <div key={`${item.tab}:${item.id}`} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    href={tabHref(requestHref, item.tab)}
                    className="text-sm font-medium hover:underline"
                  >
                    {item.title}
                  </Link>
                  <StatusBadge status={item.status} />
                </div>
                <p className="mt-1 text-sm text-body">{item.remark || "No remark recorded."}</p>
                <p className="mt-1 text-xs text-muted">{formatDate(item.decidedAt)}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section data-tour="workspace-overview-budget" className="rounded-2xl border border-line bg-paper p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Budget</p>
            <h2 className="text-lg font-medium">Your unit budget</h2>
          </div>
          <ButtonLink href={withParams(manageHref, { tab: "budget" })} size="sm" variant="outline">
            Open budget
          </ButtonLink>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-line p-3">
            <div className="text-xs text-muted">Remaining</div>
            <div className="mt-1 text-lg font-medium tabular-nums">{formatMoney(data.budget?.remaining ?? 0)}</div>
          </div>
          <div className="rounded-xl border border-line p-3">
            <div className="text-xs text-muted">Spent</div>
            <div className="mt-1 text-lg font-medium tabular-nums">{formatMoney(data.budget?.totalSpent ?? 0)}</div>
          </div>
          <div className="rounded-xl border border-line p-3">
            <div className="text-xs text-muted">Requests</div>
            <div className="mt-1 text-lg font-medium tabular-nums">{data.budget?.requestCount ?? 0}</div>
          </div>
          <div className="rounded-xl border border-line p-3">
            <div className="text-xs text-muted">Approved</div>
            <div className="mt-1 text-lg font-medium tabular-nums">{data.budget?.approvedCount ?? 0}</div>
          </div>
        </div>
      </section>
    </div>
  );
}

function UsgPath({
  data,
  requestHref,
  manageHref,
}: {
  data: UsgPayload;
  requestHref: string;
  manageHref: string;
}) {
  const reviewHref = tabHref(requestHref, "review");

  return (
    <div className="grid gap-5">
      <section
        data-tour="workspace-overview-action"
        className="rounded-2xl border border-line bg-paper p-5 sm:p-6"
      >
        <p className="eyebrow">Needs review now</p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-end gap-3">
            <span className="text-4xl font-medium tabular-nums">{data.needsReview}</span>
            <span className="pb-1 text-sm text-muted">submissions waiting on a decision</span>
          </div>
          <ButtonLink href={reviewHref}>
            Open Review Queue
            <IconArrowRight className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          </ButtonLink>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <section data-tour="workspace-overview-list" className="rounded-2xl border border-line bg-paper p-5">
          <p className="eyebrow">Risk</p>
          <h2 className="text-lg font-medium">LSGs falling behind</h2>
          <div className="mt-3 grid gap-2">
            {data.fallingBehind.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">
                No overdue units right now.
              </p>
            ) : null}
            {data.fallingBehind.map((unit) => (
              <div key={unit.unitId || unit.unitName} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-3">
                <div className="grid gap-1">
                  <Link
                    href={withParams(requestHref, {
                      tab: "tasks",
                      status: "overdue",
                      unit: unit.unitId,
                    })}
                    className="text-sm font-medium hover:underline"
                  >
                    {unit.unitName}
                  </Link>
                  <span className="text-xs text-muted">
                    {[unit.departmentName, unit.campusName].filter(Boolean).join(" · ") || "Unit"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium tabular-nums">{unit.overdueCount} overdue</span>
                  <ButtonLink
                    href={withParams(requestHref, {
                      tab: "tasks",
                      status: "overdue",
                      unit: unit.unitId,
                    })}
                    size="sm"
                    variant="ghost"
                  >
                    Open
                  </ButtonLink>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-paper p-5">
          <p className="eyebrow">Progress</p>
          <h2 className="text-lg font-medium">Per-task submissions</h2>
          <div className="mt-3 grid gap-3">
            {data.taskProgress.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">
                No task progress yet.
              </p>
            ) : null}
            {data.taskProgress.map((task) => (
              <div key={task.taskId} className="grid gap-2 rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={taskHref(requestHref, task.taskId)} className="text-sm font-medium hover:underline">
                    {task.title}
                  </Link>
                  <span className="text-sm tabular-nums">
                    {task.submitted}/{task.total} LSGs submitted
                  </span>
                </div>
                <ProgressBar value={task.submitted} total={task.total} />
                {task.overdue ? <span className="text-xs text-[#a5442c]">Past due</span> : null}
              </div>
            ))}
          </div>
        </section>
      </div>

      <section data-tour="workspace-overview-budget" className="rounded-2xl border border-line bg-paper p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Budget</p>
            <h2 className="text-lg font-medium">University budget</h2>
          </div>
          <ButtonLink href={withParams(manageHref, { tab: "budget" })} size="sm" variant="outline">
            Open unit budget table
          </ButtonLink>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-line p-3">
            <div className="text-xs text-muted">Allocated</div>
            <div className="mt-1 text-lg font-medium tabular-nums">{formatMoney(data.budget?.allocated ?? 0)}</div>
          </div>
          <div className="rounded-xl border border-line p-3">
            <div className="text-xs text-muted">Requested</div>
            <div className="mt-1 text-lg font-medium tabular-nums">{formatMoney(data.budget?.requested ?? 0)}</div>
          </div>
          <div className="rounded-xl border border-line p-3">
            <div className="text-xs text-muted">Approved</div>
            <div className="mt-1 text-lg font-medium tabular-nums">{formatMoney(data.budget?.approved ?? 0)}</div>
          </div>
          <div className="rounded-xl border border-line p-3">
            <div className="text-xs text-muted">Remaining</div>
            <div className="mt-1 text-lg font-medium tabular-nums">{formatMoney(data.budget?.remaining ?? 0)}</div>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted">
          {data.budget?.unitCount ?? 0} units · {formatMoney(data.budget?.committed ?? 0)} committed
        </p>
      </section>
    </div>
  );
}
