"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ActionError } from "@/components/dashboard/workspace-shared";
import {
  STATUS_CLASS,
  STATUS_LABEL,
  formatDate,
  formatMoney,
  type BudgetRow,
  type BudgetSummary,
} from "@/lib/budgets";

type Totals = {
  requested: number;
  approved: number;
  expenses: number;
  remaining: number;
};

const money = (value: number) => `PHP ${formatMoney(value)}`;

/**
 * The budget ledger both sides share.
 *
 * A request can stand alone, hang off a proposal, or hang off an event; the
 * linked column names whichever it is so a row is never anonymous. The four
 * figures at the top are deliberately different cuts of the same rows:
 * requested is everything still on the table, approved is what USG granted,
 * expenses is the full cost of the requests that were approved, and remaining
 * is the gap between the ask and the grant. There is no spending ledger behind
 * this, so "expenses" is the committed cost, not money already disbursed.
 */
function totalsFor(rows: BudgetRow[], summary: BudgetSummary | null): Totals {
  const expenses = rows
    .filter((row) => row.status === "approved")
    .reduce((sum, row) => sum + Number(row.requestedTotal ?? 0), 0);

  if (summary?.totals) {
    return {
      requested: Number(summary.totals.requested ?? 0),
      approved: Number(summary.totals.approved ?? 0),
      expenses,
      remaining: Number(summary.totals.remaining ?? 0),
    };
  }

  const live = rows.filter((row) => row.status !== "rejected");
  const requested = live.reduce((sum, row) => sum + Number(row.requestedTotal ?? 0), 0);
  const approved = live.reduce((sum, row) => sum + Number(row.approvedTotal ?? 0), 0);

  return { requested, approved, expenses, remaining: requested - approved };
}

function LinkedTo({ row }: { row: BudgetRow }) {
  if (row.eventId) {
    return (
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-ink">
          {row.eventTitle ?? "Event"}
        </div>
        <div className="text-xs text-muted">Event{row.eventDate ? ` · ${formatDate(row.eventDate)}` : ""}</div>
      </div>
    );
  }
  if (row.proposalId) {
    return (
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-ink">
          {row.proposalTitle ?? "Proposal"}
        </div>
        <div className="text-xs text-muted">Proposal</div>
      </div>
    );
  }
  return <div className="text-sm text-muted">Standalone</div>;
}

export function BudgetPanel() {
  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [summary, setSummary] = useState<BudgetSummary | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const res = await fetch("/api/budgets");
      const json = await res.json();
      if (!json.ok) throw new Error(json.message);
      setRows((json.budgets as BudgetRow[]) ?? []);
      setSummary((json.summary as BudgetSummary | null) ?? null);
      setState("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not load the budget requests.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const totals = totalsFor(rows, summary);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start gap-3">
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          Money requested by units, what USG approved, and what is left. Event budgets appear
          here as soon as an officer files one from the event detail.
        </p>
        <Button size="sm" className="ml-auto" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      <ActionError message={error} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Requested", value: totals.requested, hint: "Everything still on the table" },
          { label: "Approved", value: totals.approved, hint: "Granted by the USG office" },
          { label: "Expenses", value: totals.expenses, hint: "Cost of approved requests" },
          { label: "Remaining", value: totals.remaining, hint: "Requested less approved" },
        ].map((card) => (
          <div key={card.label} className="rounded-2xl border border-line bg-paper p-4">
            <div className="text-xs font-semibold tracking-[0.16em] text-muted uppercase">
              {card.label}
            </div>
            <div className="mt-1 text-[1.35rem] font-medium tabular-nums text-ink">
              {money(card.value)}
            </div>
            <div className="mt-1 text-xs text-muted">{card.hint}</div>
          </div>
        ))}
      </div>

      {state === "loading" && <p className="text-muted">Loading...</p>}

      {state === "ready" && rows.length === 0 && (
        <div className="rounded-2xl border border-line bg-paper p-6 text-sm text-muted">
          No budget requests yet. File one from an event, or from a proposal that is still open.
        </div>
      )}

      {state === "ready" && rows.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
          <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-[0.12em] text-muted">
                <th className="px-4 py-3 font-semibold">Request</th>
                <th className="px-4 py-3 font-semibold">Linked to</th>
                <th className="px-4 py-3 font-semibold">Unit</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Requested</th>
                <th className="px-4 py-3 text-right font-semibold">Approved</th>
                <th className="px-4 py-3 font-semibold">Filed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-line/70 last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">{row.title}</div>
                    <div className="text-xs text-muted">
                      {row.itemCount} line{row.itemCount === 1 ? "" : "s"}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <LinkedTo row={row} />
                  </td>
                  <td className="px-4 py-3 text-muted">{row.unitName ?? "Unassigned"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_CLASS[row.status]}`}>
                      {STATUS_LABEL[row.status]}
                    </span>
                    {row.decisionRemark && (
                      <div className="mt-1 max-w-[16rem] text-xs text-muted">{row.decisionRemark}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink">
                    {formatMoney(row.requestedTotal)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink">
                    {row.approvedTotal === null ? "—" : formatMoney(row.approvedTotal)}
                  </td>
                  <td className="px-4 py-3 text-muted">{formatDate(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
