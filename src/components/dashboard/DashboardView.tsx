"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { DashboardPayload } from "@/app/api/dashboard/route";
import { Reveal } from "@/components/fx/Reveal";
import { ButtonLink } from "@/components/ui/Button";
import { useDashboard } from "@/components/dashboard/dashboard-context";
import { IconArrowRight, IconCheck, IconClock, IconLayers, IconUpload } from "@/components/ui/Icons";

/**
 * The one screen both workspaces open on.
 *
 * It used to be two different things: `/usg` counted invitations, and `/lsg` listed
 * the proposals one unit had outstanding. Neither could answer "what is waiting for
 * me", because each only knew about its own module. This renders one read that spans
 * proposals, documents, budgets and tasks, and the first rule it follows is that the
 * two sides stay separate: the links arrive as a prop, so this file contains no
 * `/lsg` or `/usg` string and the officer's bundle cannot grow one.
 *
 * Which counters are shown is the second rule, and it is the whole reason the
 * database sends `canReview`. A reviewer's four numbers are queues waiting to be
 * worked. An officer's four are the same modules seen from the other end: what came
 * back, what is unanswered, what USG asked for. Rendering the reviewer's version to
 * an officer would show them four zeros and the distinct impression that nothing is
 * happening, when in fact two of those zeros are things waiting on *them*.
 */

export type DashboardLinks = {
  proposals: string;
  budgets: string;
  tasks: string;
  /**
   * The structure feature is not symmetric, so the link is not either: an
   * officer goes to their own council's builder and a reviewer goes to the queue.
   * Each side passes the one it means, and the footer renders whichever arrived.
   */
  structure?: string;
};

type Stat = {
  label: string;
  value: number;
  hint: string;
  href: string;
  Icon: typeof IconClock;
  hot?: boolean;
};

function money(value: string | number | null): string {
  if (value === null) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `₱${n.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
}

function when(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

const VERDICT_WORD: Record<string, string> = {
  verified: "verified",
  queried: "queried",
  rejected: "rejected",
};

export function DashboardView({ links }: { links: DashboardLinks }) {
  const { account, meta } = useDashboard();
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/dashboard");
    const body = (await res.json().catch(() => ({}))) as DashboardPayload;
    if (res.ok && body.ok) {
      setData(body);
      setError("");
    } else {
      setError((body as { message?: string }).message ?? "");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch("/api/dashboard");
      const body = (await res.json().catch(() => ({}))) as DashboardPayload;
      if (!alive) return;
      if (res.ok && body.ok) {
        setData(body);
        setError("");
      } else {
        setError((body as { message?: string }).message ?? "");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (error && !data) {
    return (
      <section className="rounded-2xl border border-line bg-paper/70 p-6">
        <p role="alert" className="text-[0.9375rem] font-medium text-[#a5442c]">
          {error || "We could not load your dashboard."}
        </p>
        <div className="mt-4">
          <ButtonLink href={links.proposals} variant="outline" size="sm">
            Go to proposals
          </ButtonLink>
        </div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="rounded-2xl border border-line bg-paper/70 p-6">
        <p role="status" className="text-[0.9375rem] text-body">
          Loading what is waiting for you…
        </p>
      </section>
    );
  }

  const canReview = data.canReview === true;
  const organizationName = meta.organizationName || "";
  const unitName = account.campusName || null;
  const counts = data.counts;
  const proposals = data.proposals ?? [];
  const documents = data.documents ?? [];
  const budgets = data.budgets ?? [];
  const tasks = data.tasks ?? [];
  const timeline = data.timeline ?? [];

  // Four numbers either way. Which four is the whole difference between the two
  // sides, so it is written out rather than derived from a lookup table that could
  // quietly produce an empty array.
  const stats: Stat[] = canReview
    ? [
        {
          label: "To review",
          value: counts?.proposals.awaitingReview ?? 0,
          hint: "Proposals waiting on a decision",
          href: links.proposals,
          Icon: IconClock,
          hot: (counts?.proposals.awaitingReview ?? 0) > 0,
        },
        {
          label: "Files unchecked",
          value: counts?.documents.mineUnchecked ?? 0,
          hint: "Documents you have not ruled on",
          href: links.proposals,
          Icon: IconUpload,
          hot: (counts?.documents.mineUnchecked ?? 0) > 0,
        },
        {
          label: "Budgets to decide",
          value: counts?.budgets.awaitingDecision ?? 0,
          hint: "Requests from your units",
          href: links.budgets,
          Icon: IconLayers,
          hot: (counts?.budgets.awaitingDecision ?? 0) > 0,
        },
        {
          label: "Overdue",
          value: counts?.tasks.overdue ?? 0,
          hint: "Past a deadline and unfinished",
          href: links.tasks,
          Icon: IconClock,
          hot: (counts?.tasks.overdue ?? 0) > 0,
        },
      ]
    : [
        {
          label: "Sent back",
          value: counts?.proposals.returnedToMe ?? 0,
          hint: "Proposals USG returned to you",
          href: links.proposals,
          Icon: IconClock,
          hot: (counts?.proposals.returnedToMe ?? 0) > 0,
        },
        {
          label: "Questions",
          value: counts?.documents.queried ?? 0,
          hint: "Documents USG asked about",
          href: links.proposals,
          Icon: IconUpload,
          hot: (counts?.documents.queried ?? 0) > 0,
        },
        {
          label: "Budgets open",
          value: counts?.budgets.mineOpen ?? 0,
          hint: "Requests awaiting a decision",
          href: links.budgets,
          Icon: IconLayers,
          hot: (counts?.budgets.mineOpen ?? 0) > 0,
        },
        {
          label: "Tasks to report",
          value: counts?.tasks.awaitingMe ?? 0,
          hint: "Assigned to your unit, not done",
          href: links.tasks,
          Icon: IconClock,
          hot: (counts?.tasks.awaitingMe ?? 0) > 0,
        },
      ];

  const waitingProposals = proposals.filter((p) => p.awaitingMe);
  const waitingBudgets = budgets.filter((b) => b.awaitingMe);
  const waitingTasks = tasks.filter((t) => t.awaitingMe);
  const waitingDocuments = canReview ? documents.filter((d) => d.myVerdict === null) : [];
  const waiting = waitingProposals.length + waitingBudgets.length + waitingTasks.length + waitingDocuments.length;

  return (
    <section className="flex flex-col gap-8">
      <Reveal className="flex flex-col items-center text-center">
        <p className="eyebrow">{canReview ? "Office desk" : unitName ? `${unitName} LSG` : "Your LSG"}</p>
        <h1 className="mt-2 text-[1.875rem] leading-tight sm:text-[2.25rem]">
          {canReview ? organizationName || "Student government office" : "Today"}
        </h1>
        <p className="mt-3 max-w-xl text-[0.9375rem] leading-relaxed text-body">
          {canReview
            ? "Every proposal, file, budget and task across the office, cut to what is actually waiting on you."
            : "What your unit owes USG, what came back, and by when."}
        </p>
      </Reveal>

      <Reveal delay={0.06}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => {
            const Icon = s.Icon;
            return (
              <Link
                key={s.label}
                href={s.href}
                className="group flex items-start gap-4 rounded-2xl border border-line bg-paper/70 px-5 py-4 transition-[border-color,box-shadow] duration-300 hover:border-line-strong hover:shadow-lift"
              >
                <span
                  className={`grid size-10 shrink-0 place-items-center rounded-full border ${
                    s.hot
                      ? "border-brass/50 bg-brass-soft/40 text-brass-deep"
                      : "border-line-strong bg-canvas text-muted"
                  }`}
                >
                  <Icon className="h-[1.15rem] w-[1.15rem]" strokeWidth={1.8} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.6875rem] font-semibold tracking-[0.1em] text-muted uppercase">
                    {s.label}
                  </span>
                  <span className="mt-1.5 block text-[1.875rem] leading-none font-semibold text-ink">
                    {s.value}
                  </span>
                  <span className="mt-1 block truncate text-[0.75rem] text-muted">{s.hint}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </Reveal>

      <div>
        <h2 className="text-[1.125rem] leading-tight">Waiting on you</h2>

        {waiting === 0 ? (
          <Reveal delay={0.08}>
            <div className="mt-3 rounded-2xl border border-line bg-paper/70 px-5 py-6">
              <p className="text-[0.9375rem] leading-relaxed text-body">
                Nothing is waiting on you right now. When USG assigns a task, sends a proposal back, asks
                a question about a document, or approves a budget, it will appear here.
              </p>
              <div className="mt-4">
                <ButtonLink href={links.proposals} variant="outline" size="sm">
                  {canReview ? "Open the review inbox" : "Start a proposal"}
                </ButtonLink>
              </div>
            </div>
          </Reveal>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {waitingProposals.map((p) => (
              <li key={p.id} className="rounded-2xl border border-line bg-paper/70 p-4">
                <p className="text-[0.75rem] font-semibold tracking-[0.08em] text-brass-deep uppercase">
                  {canReview ? "Needs a decision" : "Sent back to you"}
                </p>
                <p className="mt-1 text-[1.0625rem] leading-snug font-medium text-ink">{p.title}</p>
                <p className="mt-1 text-[0.8125rem] text-muted">
                  {[p.unitName, p.version ? `version ${p.version}` : null, when(p.createdAt)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </li>
            ))}

            {waitingDocuments.map((d) => (
              <li key={d.submissionId} className="rounded-2xl border border-line bg-paper/70 p-4">
                <p className="text-[0.75rem] font-semibold tracking-[0.08em] text-brass-deep uppercase">
                  {d.attached ? "File unchecked" : "File missing"}
                </p>
                <p className="mt-1 text-[1.0625rem] leading-snug font-medium text-ink">{d.label}</p>
                <p className="mt-1 text-[0.8125rem] text-muted">
                  {d.proposalTitle}
                  {d.originalName ? ` · ${d.originalName}` : ""}
                </p>
              </li>
            ))}

            {waitingBudgets.map((b) => (
              <li key={b.id} className="rounded-2xl border border-line bg-paper/70 p-4">
                <p className="text-[0.75rem] font-semibold tracking-[0.08em] text-brass-deep uppercase">
                  Needs a decision
                </p>
                <p className="mt-1 text-[1.0625rem] leading-snug font-medium text-ink">{b.title}</p>
                <p className="mt-1 text-[0.8125rem] text-muted">
                  {[b.unitName, money(b.requestedTotal), when(b.createdAt)].filter(Boolean).join(" · ")}
                </p>
              </li>
            ))}

            {waitingTasks.map((t) => (
              <li key={t.id} className="rounded-2xl border border-line bg-paper/70 p-4">
                <p className="text-[0.75rem] font-semibold tracking-[0.08em] text-brass-deep uppercase">
                  {t.overdue ? "Overdue" : "Open task"}
                </p>
                <p className="mt-1 text-[1.0625rem] leading-snug font-medium text-ink">{t.title}</p>
                <p className="mt-1 text-[0.8125rem] text-muted">
                  {[
                    t.dueDate ? `due ${when(t.dueDate)}` : null,
                    `${t.doneUnits}/${t.totalUnits} units done`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {timeline.length > 0 ? (
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[1.125rem] leading-tight">What happened</h2>
            {/* A reviewer often rules in one tab and comes back to this one, so the
                page has to be willing to re-read rather than only re-mount. */}
            <button
              type="button"
              onClick={() => void load()}
              className="text-[0.8125rem] text-muted transition-colors hover:text-ink"
            >
              Refresh
            </button>
          </div>
          <ol className="mt-3 flex flex-col gap-2">
            {timeline.map((e, i) => (
              <li
                key={`${e.kind}-${e.at}-${i}`}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-l-2 border-line py-1 pl-3"
              >
                <span className="text-[0.75rem] text-muted">{when(e.at)}</span>
                <span className="text-[0.875rem] text-ink">{e.title}</span>
                <span className="text-[0.8125rem] text-muted">{e.detail}</span>
                {e.actor ? <span className="text-[0.8125rem] text-muted">· {e.actor}</span> : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {documents.length > 0 ? (
        <div>
          <h2 className="text-[1.125rem] leading-tight">Documents</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {documents.map((d) => (
              <li
                key={d.submissionId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line/70 bg-paper/60 px-4 py-3"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[0.9375rem] text-ink">{d.label}</span>
                  <span className="mt-0.5 block truncate text-[0.75rem] text-muted">
                    {d.proposalTitle}
                    {d.verifiedBy ? ` · ${d.verifiedBy}` : ""}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold ${
                    d.verdict === "verified"
                      ? "bg-[#e6f0e6] text-[#2f5d38]"
                      : d.verdict === "queried"
                        ? "bg-brass-soft/50 text-brass-deep"
                        : d.verdict === "rejected"
                          ? "bg-[#f7e3dd] text-[#a5442c]"
                          : "bg-canvas text-muted"
                  }`}
                >
                  {d.verdict ? VERDICT_WORD[d.verdict] : d.attached ? "Unchecked" : "No file"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Reveal delay={0.1}>
        <div className="flex flex-wrap gap-3 border-t border-line/70 pt-5">
          <ButtonLink href={links.proposals} variant="primary" size="sm">
            {canReview ? "Review inbox" : "Your proposals"}
          </ButtonLink>
          <ButtonLink href={links.tasks} variant="paper" size="sm">
            Tasks
          </ButtonLink>
          {links.structure ? (
            <ButtonLink href={links.structure} variant="paper" size="sm">
              {canReview ? "Structures" : "Council structure"}
            </ButtonLink>
          ) : null}
          <span className="ml-auto inline-flex items-center gap-1.5 text-[0.8125rem] text-muted">
            <IconCheck className="h-3.5 w-3.5" strokeWidth={2.2} />
            {counts?.proposals.visible ?? 0} proposals · {counts?.budgets.visible ?? 0} budgets ·{" "}
            {counts?.tasks.visible ?? 0} tasks
            <IconArrowRight className="h-3.5 w-3.5" strokeWidth={1.8} />
          </span>
        </div>
      </Reveal>
    </section>
  );
}