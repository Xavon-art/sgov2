"use client";

import type { MockState } from "@/lib/mockdashboard/db";
import { peso } from "@/lib/mockdashboard/format";
import { Card } from "@/components/mockdashboard/card";
import { StatusBadge } from "@/components/mockdashboard/status-badge";
import { KindChip } from "@/components/mockdashboard/kind-chip";

export function Funds({ state, council }: { state: MockState; council: string }) {
  const approved = state.budgets.filter((b) => b.status === "approved");
  const rows = [...new Map(approved.map((b) => {
    const d = b.detail as { unitName?: string; amount?: number; spent?: number };
    const unit = String(d.unitName ?? "General");
    return [unit, unit];
  })).keys()].map((unit) => {
    const items = approved.filter((b) => String((b.detail as { unitName?: string }).unitName ?? "General") === unit);
    const allotted = items.reduce((a, b) => a + Number((b.detail as { amount?: number }).amount ?? 0), 0);
    const spent = items.reduce((a, b) => a + Number((b.detail as { spent?: number }).spent ?? 0), 0);
    return { unit, allotted, spent };
  });

  const mine = state.budgets.filter((b) => b.filedBy === council);

  return (
    <div className="space-y-5">
      <Card title="My budget requests" subtitle={`Requests filed by ${council}`}>
        {mine.length === 0 ? (
          <p className="text-sm text-muted">No budget requests filed yet. Use “File new” → Budget request.</p>
        ) : (
          <ul className="space-y-2">
            {mine.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <KindChip kind="budget" />
                    <p className="truncate text-sm font-medium text-ink-deep">{b.title}</p>
                  </div>
                  <p className="text-xs text-muted">{String((b.detail as { purpose?: string }).purpose ?? "")}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm font-semibold text-ink-deep">{peso(Number((b.detail as { amount?: number }).amount ?? 0))}</span>
                  <StatusBadge status={b.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="USG allocations" subtitle="Approved unit budgets, for reference">
        {rows.length === 0 ? (
          <p className="text-sm text-muted">No approved allocations yet.</p>
        ) : (
          <ul className="space-y-4">
            {rows.map((r) => {
              const used = r.allotted ? Math.round((r.spent / r.allotted) * 100) : 0;
              return (
                <li key={r.unit}>
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-ink-deep">{r.unit}</p>
                    <p className="text-xs text-muted">{peso(r.spent)} / {peso(r.allotted)}</p>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-ink/[0.05]">
                    <div className="h-full rounded-full bg-brass" style={{ width: `${Math.min(100, used)}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}