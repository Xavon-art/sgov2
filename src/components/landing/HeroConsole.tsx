"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  IconArchive,
  IconBudget,
  IconCheck,
  IconDashboard,
  IconEvents,
  IconMonitoring,
  IconPyramid,
  IconSubmission,
  IconTracking,
  IconVerification,
} from "@/components/ui/Icons";

const NAV = [
  { icon: IconDashboard, label: "Dashboard" },
  { icon: IconSubmission, label: "Submissions" },
  { icon: IconVerification, label: "Verification" },
  { icon: IconTracking, label: "Tracking" },
  { icon: IconArchive, label: "Records" },
  { icon: IconMonitoring, label: "Reports" },
  { icon: IconBudget, label: "Budget" },
  { icon: IconEvents, label: "Events" },
];

type Row = {
  id: string;
  unit: string;
  title: string;
  status: "Approved" | "In review" | "Awaiting docs" | "Returned";
  tone: "brass" | "ink" | "muted" | "warn";
};

const ROWS: Row[] = [
  {
    id: "2026-014",
    unit: "LSG · Engineering",
    title: "Laboratory Equipment Renewal",
    status: "Approved",
    tone: "brass",
  },
  {
    id: "2026-015",
    unit: "LSG · Arts & Sciences",
    title: "Student Publication Charter",
    status: "In review",
    tone: "ink",
  },
  {
    id: "2026-016",
    unit: "LSG · North Campus",
    title: "Transportation Route Proposal",
    status: "Awaiting docs",
    tone: "muted",
  },
  {
    id: "2026-017",
    unit: "LSG · Business",
    title: "Budget Reconciliation FY26",
    status: "Returned",
    tone: "warn",
  },
];

const TONE: Record<Row["tone"], string> = {
  brass: "border-brass/45 bg-brass-soft/45 text-brass-deep",
  ink: "border-ink/25 bg-ink/[0.07] text-ink",
  muted: "border-line-strong bg-canvas-sunk/70 text-muted",
  warn: "border-[#d9a99c]/60 bg-[#f6e4de]/70 text-[#a5442c]",
};

export function HeroConsole({ className }: { className?: string }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setTick((t) => (t + 1) % ROWS.length), 3600);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-line-strong/80 bg-paper/80 shadow-[0_2px_4px_rgba(13,33,53,0.04),0_50px_100px_-40px_rgba(13,33,53,0.4)] backdrop-blur-xl",
        className,
      )}
    >
      <div className="flex items-center gap-3 border-b border-line/80 bg-canvas/50 px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2 rounded-full bg-line-strong" />
          <span className="size-2 rounded-full bg-line-strong" />
          <span className="size-2 rounded-full bg-line-strong" />
        </span>
        <span className="truncate text-[0.6875rem] font-semibold tracking-[0.1em] text-muted uppercase">
          SmartGov · University Student Government
        </span>
        <span className="ml-auto hidden items-center gap-1.5 rounded-full border border-line-strong bg-paper px-2 py-0.5 text-[0.5625rem] font-semibold tracking-[0.12em] text-ink-soft uppercase sm:flex">
          <IconPyramid className="h-3 w-3" />
          Federated
        </span>
      </div>

      <div className="grid grid-cols-[3.25rem_1fr] sm:grid-cols-[9.5rem_1fr]">
        <div className="border-r border-line/80 bg-canvas/40 py-3">
          <ul className="flex flex-col gap-0.5 px-2">
            {NAV.map((item, i) => {
              const Icon = item.icon;
              const active = i === 1;
              return (
                <li key={item.label}>
                  <span
                    className={cn(
                      "flex items-center gap-2 rounded-md px-1.5 py-1.5 text-[0.625rem] font-medium transition-colors",
                      active
                        ? "bg-ink/[0.07] text-ink"
                        : "text-muted/80",
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        active ? "text-brass" : "text-faint",
                      )}
                    />
                    <span className="hidden truncate sm:inline">
                      {item.label}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="min-w-0 p-3 sm:p-4">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <p className="text-[0.5625rem] font-semibold tracking-[0.16em] text-ink-muted uppercase">
                Requirements &amp; Resolutions
              </p>
              <h3 className="mt-1 font-display text-[0.9375rem] font-medium text-ink-deep sm:text-base">
                Council Submissions
              </h3>
            </div>
            <div className="hidden text-right sm:block">
              <p className="font-display text-[1.375rem] leading-none font-medium text-ink-deep">
                ₱1.24M
              </p>
              <p className="mt-1 text-[0.5625rem] font-semibold tracking-[0.12em] text-ink-muted uppercase">
                Tracked this term
              </p>
            </div>
          </div>

          <ul className="flex flex-col gap-1.5">
            {ROWS.map((row, i) => (
              <li
                key={row.id}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg border px-2.5 py-2 transition-[border-color,background-color,opacity] duration-700",
                  tick === i
                    ? "border-ink/25 bg-paper shadow-lift"
                    : "border-line/80 bg-canvas/35 opacity-70",
                )}
              >
                <span className="font-mono text-[0.625rem] font-medium tabular-nums text-faint">
                  {row.id}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.6875rem] font-semibold text-ink-deep">
                    {row.title}
                  </span>
                  <span className="block truncate text-[0.5625rem] font-medium tracking-wide text-muted">
                    {row.unit}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full border px-2 py-0.5 text-[0.5625rem] font-semibold tracking-wide whitespace-nowrap",
                    TONE[row.tone],
                  )}
                >
                  {row.status}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex items-center gap-2.5 rounded-lg border border-brass/35 bg-brass-soft/25 px-2.5 py-2">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-brass text-ink-deep">
              <IconCheck className="h-3 w-3" strokeWidth={2.25} />
            </span>
            <p className="text-[0.625rem] leading-snug font-medium text-ink">
              Resolution 2026-014 approved by USG — budget released to LSG
              Engineering.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
