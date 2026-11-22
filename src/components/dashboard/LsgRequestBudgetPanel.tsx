"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ActionError } from "@/components/dashboard/workspace-shared";
import { refreshBudgetStore, useBudgetStore } from "@/components/dashboard/budget-store";
import { formatMoney, type BudgetRow } from "@/lib/budgets";

const money = (value: number) => `PHP ${formatMoney(value)}`;

function remainingFor(row: BudgetRow): number {
  return Math.max(0, Number(row.approvedTotal ?? 0) - Number(row.actualSpent ?? 0));
}

export function LsgRequestBudgetPanel() {
  const { budgets, loading, error } = useBudgetStore();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const approved = budgets.filter((row) => row.status === "approved");
  const approvedTotal = approved.reduce((sum, row) => sum + Number(row.approvedTotal ?? 0), 0);
  const expenses = approved.reduce((sum, row) => sum + Number(row.actualSpent ?? 0), 0);
  const remaining = approved.reduce((sum, row) => sum + remainingFor(row), 0);

  async function recordSpending(row: BudgetRow) {
    const amount = drafts[row.id] ?? String(row.actualSpent ?? 0);
    setBusyId(row.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/budgets/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actualSpent: amount }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.message ?? "We could not record that spending.");
      }
      setDrafts((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      await refreshBudgetStore();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "We could not record that spending.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section data-tour="request-budget" className="rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <p className="eyebrow">Budget at a glance</p>
          <h2 className="mt-1 text-[1.125rem] font-medium text-ink">Approved budgets</h2>
        </div>
        <Button size="sm" variant="paper" className="ml-auto" onClick={() => void refreshBudgetStore()}>
          Refresh
        </Button>
      </div>

      <ActionError message={error ?? actionError} />

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-line/70 bg-canvas/40 p-3">
          <p className="text-xs text-muted">Approved total</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-ink">{money(approvedTotal)}</p>
        </div>
        <div className="rounded-xl border border-line/70 bg-canvas/40 p-3">
          <p className="text-xs text-muted">Total expenses</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-ink">{money(expenses)}</p>
        </div>
        <div className="rounded-xl border border-line/70 bg-canvas/40 p-3">
          <p className="text-xs text-muted">Remaining budget</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-ink">{money(remaining)}</p>
        </div>
      </div>

      {loading && <p className="mt-4 text-sm text-muted">Loading approved budgets...</p>}

      {!loading && approved.length === 0 && (
        <p className="mt-4 text-sm text-muted">No approved budgets yet.</p>
      )}

      {approved.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          {approved.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-line/70 bg-canvas/30 p-3"
            >
              <div className="min-w-[10rem] flex-1">
                <div className="truncate text-sm font-medium text-ink">{row.title}</div>
                <div className="text-xs text-muted">{row.unitName ?? "Unassigned"}</div>
              </div>
              <div className="text-right text-xs text-muted">
                <div>Approved {money(Number(row.approvedTotal ?? 0))}</div>
                <div>Spent {money(Number(row.actualSpent ?? 0))}</div>
                <div>Remaining {money(remainingFor(row))}</div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  aria-label={`Spending for ${row.title}`}
                  type="number"
                  min="0"
                  step="0.01"
                  value={drafts[row.id] ?? String(row.actualSpent ?? 0)}
                  onChange={(event) =>
                    setDrafts((current) => ({ ...current, [row.id]: event.target.value }))
                  }
                  className="h-9 w-28 rounded-lg border border-line bg-paper px-2 text-sm tabular-nums text-ink outline-none transition-colors focus:border-line-strong"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === row.id}
                  onClick={() => void recordSpending(row)}
                >
                  Save
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
