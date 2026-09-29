"use client";

import { useMemo } from "react";
import type { Item, MockState } from "@/lib/mockdashboard/db";
import { peso, stamp } from "@/lib/mockdashboard/format";
import { KpiCard } from "@/components/mockdashboard/kpi-card";
import { Card } from "@/components/mockdashboard/card";
import { StatusBadge } from "@/components/mockdashboard/status-badge";

export function Overview({ state }: { state: MockState }) {
  const all = useMemo(
    () => [...state.proposals, ...state.events, ...state.budgets] as Item<ItemKind>[],
    [state],
  );

  const awaiting = all.filter((i) => i.status === "in_review" || i.status === "pending").length;

  const approvedThisWeek = useMemo(() => {
    const nowT = Math.max(
      0,
      ...all.map((i) => new Date(i.timeline[i.timeline.length - 1]?.at ?? i.createdAt).getTime()),
    );
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    return all.filter(
      (i) => i.status === "approved" && i.review && nowT - new Date(i.review.at).getTime() < weekMs,
    ).length;
  }, [all]);

  const approvedBudgets = state.budgets.filter((b) => b.status === "approved");
  const tAllotted = approvedBudgets.reduce((a, b) => a + Number((b.detail as { amount?: number }).amount ?? 0), 0);
  const tSpent = approvedBudgets.reduce((a, b) => a + Number((b.detail as { spent?: number }).spent ?? 0), 0);
  const utilization = tAllotted ? Math.round((tSpent / tAllotted) * 100) : 0;

  const recent = all
    .flatMap((i) => i.timeline.map((t) => ({ ...t, item: i.title, kind: i.kind })))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 6);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Needs attention" value={String(awaiting)} hint="pending or in review" tone="amber" icon="✉️" />
        <KpiCard label="Approved this week" value={String(approvedThisWeek)} hint="across all submissions" tone="emerald" icon="✅" />
        <KpiCard label="Funds allotted" value={peso(tAllotted)} hint="approved budgets" tone="indigo" icon="₱" />
        <KpiCard label="Budget used" value={`${utilization}%`} hint="of allotted across units" tone="rose" icon="📊" />
      </div>

      <Card title="Latest activity" subtitle="Most recent status changes across the organization">
        {recent.length === 0 ? (
          <p className="text-sm text-slate-400">No activity yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recent.map((t, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-800">
                    <span className="font-medium">{t.item}</span>
                    <span className="text-slate-400"> · {t.by}</span>
                  </p>
                  {t.note && <p className="text-xs text-slate-500">{t.note}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge status={t.to} />
                  <span className="text-[11px] text-slate-400">{stamp(t.at)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

type ItemKind = "proposal" | "event" | "budget";