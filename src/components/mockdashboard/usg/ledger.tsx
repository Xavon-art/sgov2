"use client";

import { useMemo } from "react";
import type { Item, MockState } from "@/lib/mockdashboard/db";
import { peso } from "@/lib/mockdashboard/format";
import { Card } from "@/components/mockdashboard/card";
import { StatusBadge } from "@/components/mockdashboard/status-badge";

export function Ledger({ state }: { state: MockState }) {
  const approved = state.budgets.filter((b) => b.status === "approved");
  const pendingAllocations = state.budgets.filter((b) => b.status === "pending" || b.status === "in_review");

  const rows = useMemo(() => {
    const map = new Map<string, { unit: string; allotted: number; spent: number; purpose: string }>();
    for (const b of approved) {
      const d = b.detail as { unitName?: string; amount?: number; spent?: number; purpose?: string };
      const unit = String(d.unitName ?? "General");
      const cur = map.get(unit) ?? { unit, allotted: 0, spent: 0, purpose: String(d.purpose ?? "") };
      cur.allotted += Number(d.amount ?? 0);
      cur.spent += Number(d.spent ?? 0);
      map.set(unit, cur);
    }
    return [...map.values()];
  }, [approved]);

  const tAllotted = rows.reduce((a, r) => a + r.allotted, 0);
  const tSpent = rows.reduce((a, r) => a + r.spent, 0);
  const pct = tAllotted ? Math.round((tSpent / tAllotted) * 100) : 0;

  return (
    <Card
      title="Budget ledger"
      subtitle="Approved allocations across USG units"
      actions={
        <div className="text-right text-xs text-slate-500">
          <p>
            Allotted <span className="font-semibold text-slate-900">{peso(tAllotted)}</span>
          </p>
          <p className="mt-0.5">
            Used <span className="font-semibold text-slate-900">{pct}%</span>
          </p>
        </div>
      }
    >
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">No approved budgets yet.</p>
      ) : (
        <ul className="space-y-5">
          {rows.map((r) => {
            const used = r.allotted ? Math.round((r.spent / r.allotted) * 100) : 0;
            return (
              <li key={r.unit}>
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-slate-900">{r.unit}</p>
                  <p className="text-xs text-slate-500">
                    {peso(r.spent)} <span className="text-slate-300">/</span> {peso(r.allotted)}
                  </p>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-emerald-500"
                    style={{ width: `${Math.min(100, used)}%` }}
                  />
                </div>
                {r.purpose && <p className="mt-1 text-xs text-slate-400">{r.purpose}</p>}
              </li>
            );
          })}
        </ul>
      )}

      {pendingAllocations.length > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <h4 className="mb-2 text-xs font-semibold text-slate-500">Awaiting approval</h4>
          <ul className="space-y-2">
            {pendingAllocations.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-slate-700">{b.title}</span>
                <span className="flex items-center gap-2">
                  <StatusBadge status={b.status as Item<"budget">["status"]} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}