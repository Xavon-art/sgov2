"use client";

import { useCallback, useEffect, useState } from "react";
import {
  STATUS_CLASS,
  STATUS_LABEL,
  formatDate,
  formatMoney,
  parseAmount,
  type BudgetDecision,
  type BudgetDetail,
  type BudgetRow,
  type BudgetSummary,
} from "@/lib/budgets";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; budgets: BudgetRow[]; summary: BudgetSummary | null };

type Filter = "open" | "decided" | "all";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "open", label: "Needs a decision" },
  { id: "decided", label: "Decided" },
  { id: "all", label: "All" },
];

function StatusPill({ status }: { status: BudgetRow["status"] }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[0.75rem] font-medium ${STATUS_CLASS[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function Stat({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-card border p-4 ${emphasis ? "border-ink/20 bg-ink/[0.05]" : "border-line bg-paper"}`}
    >
      <p className="text-[0.75rem] font-medium uppercase tracking-[0.14em] text-faint">
        {label}
      </p>
      <p className="mt-1 text-[1.375rem] leading-tight tabular-nums">{formatMoney(value)}</p>
    </div>
  );
}

/**
 * The budget decision desk.
 *
 * Money is shown twice wherever the two figures can differ: what was asked, and
 * what was given. An approval that pays less than the request is normal, and it
 * should be impossible to mistake the smaller number for the original ask.
 *
 * The remaining figure excludes anything rejected, so it answers the question the
 * office actually has: how much is still uncommitted across the units.
 */
export default function UsgBudgetsPage() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [filter, setFilter] = useState<Filter>("open");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [openDetail, setOpenDetail] = useState<Record<string, BudgetDetail>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/budgets");
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setState({ kind: "error", message: data.message ?? "We could not load the requests." });
        return;
      }
      setState({ kind: "ready", budgets: data.budgets ?? [], summary: data.summary ?? null });
    } catch {
      setState({ kind: "error", message: "We could not reach the server. Check your connection." });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/budgets");
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setState({
            kind: "error",
            message: data.message ?? "We could not load the requests.",
          });
          return;
        }
        setState({ kind: "ready", budgets: data.budgets ?? [], summary: data.summary ?? null });
      } catch {
        if (cancelled) return;
        setState({
          kind: "error",
          message: "We could not reach the server. Check your connection.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function decide(row: BudgetRow, decision: BudgetDecision) {
    setNotice(null);

    const remark = (remarks[row.id] ?? "").trim();
    if (decision !== "approved" && !remark) {
      setNotice({
        tone: "bad",
        text: `Write a short note so ${row.unitName ?? "the unit"} knows what to change.`,
      });
      return;
    }

    let approvedTotal: number | null = null;
    if (decision === "approved") {
      const typed = (amounts[row.id] ?? "").trim();
      if (typed) {
        const parsed = parseAmount(typed);
        if (parsed === null) {
          setNotice({ tone: "bad", text: "The approved amount is not a number." });
          return;
        }
        approvedTotal = parsed;
      }
      if (approvedTotal !== null && approvedTotal > Number(row.requestedTotal)) {
        setNotice({
          tone: "bad",
          text: `That is more than the ${formatMoney(row.requestedTotal)} that was requested.`,
        });
        return;
      }
    }

    setSavingId(row.id);
    try {
      const res = await fetch(`/api/budgets/${row.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, approvedTotal, remark }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setNotice({ tone: "bad", text: data.message ?? "We could not record that decision." });
        return;
      }

      setNotice({
        tone: "ok",
        text:
          decision === "approved"
            ? `Approved ${formatMoney(data.approvedTotal ?? row.requestedTotal)} for ${row.unitName ?? "the unit"}.`
            : `${STATUS_LABEL[decision]} for ${row.unitName ?? "the unit"}.`,
      });
      setAmounts((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      setRemarks((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      await load();
    } catch {
      setNotice({ tone: "bad", text: "We could not reach the server. Check your connection." });
    } finally {
      setSavingId(null);
    }
  }

  async function toggleDetail(row: BudgetRow) {
    if (openDetail[row.id]) {
      setOpenDetail((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      return;
    }
    try {
      const res = await fetch(`/api/budgets/${row.id}`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setNotice({ tone: "bad", text: data.message ?? "We could not open that request." });
        return;
      }
      setOpenDetail((prev) => ({ ...prev, [row.id]: data.budget }));
    } catch {
      setNotice({ tone: "bad", text: "We could not reach the server. Check your connection." });
    }
  }

  const budgets = state.kind === "ready" ? state.budgets : [];
  const visible = budgets.filter((b) => {
    if (filter === "all") return true;
    const open = b.status === "submitted" || b.status === "returned";
    return filter === "open" ? open : !open;
  });

  return (
    <section className="mx-auto w-full max-w-5xl">
      <header className="border-b border-line/80 pb-4">
        <p className="eyebrow">Budget</p>
        <h1 className="mt-1 text-[1.5rem] leading-tight sm:text-[1.75rem]">
          Fund requests from your units
        </h1>
        <p className="mt-1 max-w-prose text-[0.9375rem] leading-relaxed text-body">
          Approve a request in full, approve part of it, or send it back with a note the
          officer can act on.
        </p>
      </header>

      {state.kind === "ready" && state.summary ? (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <Stat label="Requested" value={state.summary.totals.requested} />
            <Stat label="Approved" value={state.summary.totals.approved} />
            <Stat label="Still uncommitted" value={state.summary.totals.remaining} emphasis />
          </div>

          {state.summary.units.length > 0 ? (
            <div className="mt-4 overflow-x-auto rounded-card border border-line bg-paper">
              <table className="w-full border-collapse text-left text-[0.875rem]">
                <caption className="sr-only">
                  Requested, approved and uncommitted money for each unit
                </caption>
                <thead>
                  <tr className="border-b border-line/80">
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      Unit
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">
                      Requested
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">
                      Approved
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">
                      Uncommitted
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">
                      Open
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {state.summary.units.map((u) => (
                    <tr key={u.unitId ?? "none"} className="border-b border-line/50 last:border-0">
                      <td className="px-4 py-2.5">{u.unitName}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {formatMoney(u.requested)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {formatMoney(u.approved)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {formatMoney(u.remaining)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{u.openCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}

      <div aria-live="polite" className="mt-5 min-h-6">
        {notice ? (
          <p
            className={
              notice.tone === "ok"
                ? "text-[0.9375rem] text-ink"
                : "text-[0.9375rem] text-brass-deep"
            }
          >
            {notice.text}
          </p>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-b border-line/80 pb-3">
        <h2 className="text-[1.125rem] leading-tight">Requests</h2>
        <div role="group" aria-label="Filter requests" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={`min-h-11 rounded-lg border px-3 text-[0.875rem] transition-colors ${
                filter === f.id
                  ? "border-ink/30 bg-ink/[0.06] text-ink"
                  : "border-line text-muted hover:bg-canvas"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {state.kind === "loading" ? (
        <p className="mt-3 text-[0.9375rem] text-muted">Loading requests...</p>
      ) : state.kind === "error" ? (
        <div className="mt-3 rounded-card border border-line bg-paper px-4 py-5">
          <p className="text-[0.9375rem] leading-relaxed text-body">{state.message}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-[0.9375rem] transition-colors hover:bg-canvas"
          >
            Try again
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="mt-3 rounded-card border border-line bg-paper px-4 py-5">
          <p className="text-[0.9375rem] leading-relaxed text-body">
            {filter === "open"
              ? "Nothing is waiting on you right now."
              : "No requests here yet."}
          </p>
        </div>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {visible.map((row) => {
            const detail = openDetail[row.id];
            const actionable = row.status === "submitted" || row.status === "returned";
            const busy = savingId === row.id;

            return (
              <li key={row.id} className="rounded-card border border-line bg-paper">
                <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[0.9375rem]">{row.title}</p>
                      <StatusPill status={row.status} />
                    </div>
                    <p className="mt-0.5 text-[0.8125rem] text-muted">
                      {row.unitName ?? "Unassigned"} · {formatDate(row.createdAt)}
                      {row.proposalTitle ? ` · for ${row.proposalTitle}` : ""}
                    </p>
                    <button
                      type="button"
                      onClick={() => void toggleDetail(row)}
                      aria-expanded={Boolean(detail)}
                      className="mt-1 min-h-11 px-0 text-[0.8125rem] text-muted underline underline-offset-4 transition-colors hover:text-ink"
                    >
                      {detail ? "Hide lines" : `Show ${row.itemCount} lines`}
                    </button>
                  </div>

                  <div className="text-right">
                    <p className="text-[0.9375rem] tabular-nums">
                      {formatMoney(row.requestedTotal)}
                    </p>
                    <p className="text-[0.8125rem] text-muted">asked</p>
                    {row.status === "approved" ? (
                      <p className="mt-1 text-[0.9375rem] tabular-nums">
                        {formatMoney(row.approvedTotal)}
                      </p>
                    ) : null}
                    {row.status === "approved" ? (
                      <p className="text-[0.8125rem] text-muted">given</p>
                    ) : null}
                  </div>
                </div>

                {detail ? (
                  <div className="border-t border-line/70 px-4 py-3">
                    {detail.justification ? (
                      <p className="mb-3 text-[0.875rem] leading-relaxed text-body">
                        {detail.justification}
                      </p>
                    ) : null}
                    <ul className="flex flex-col gap-1.5">
                      {detail.items.map((item) => (
                        <li
                          key={item.id}
                          className="flex flex-wrap items-baseline justify-between gap-2 text-[0.875rem]"
                        >
                          <span>
                            {item.label}{" "}
                            <span className="text-muted tabular-nums">
                              {item.quantity} × {formatMoney(item.unitCost)}
                            </span>
                          </span>
                          <span className="tabular-nums">{formatMoney(item.subtotal)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {row.decisionRemark ? (
                  <p className="border-t border-line/70 px-4 py-2.5 text-[0.875rem] leading-relaxed text-body">
                    <span className="font-medium">Note: </span>
                    {row.decisionRemark}
                  </p>
                ) : null}

                {actionable ? (
                  <div className="border-t border-line/70 px-4 py-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label
                          htmlFor={`amount-${row.id}`}
                          className="block text-[0.8125rem] font-medium"
                        >
                          Amount to approve
                        </label>
                        <input
                          id={`amount-${row.id}`}
                          value={amounts[row.id] ?? ""}
                          onChange={(e) =>
                            setAmounts((prev) => ({ ...prev, [row.id]: e.target.value }))
                          }
                          disabled={busy}
                          inputMode="decimal"
                          placeholder={String(row.requestedTotal)}
                          aria-describedby={`amount-help-${row.id}`}
                          className="mt-1.5 min-h-11 w-full rounded-lg border border-line bg-canvas px-3 text-[0.9375rem] tabular-nums outline-none focus-visible:border-brass focus-visible:ring-2 focus-visible:ring-brass/40"
                        />
                        <p
                          id={`amount-help-${row.id}`}
                          className="mt-1.5 text-[0.8125rem] text-muted"
                        >
                          Left empty, the full {formatMoney(row.requestedTotal)} is approved. It
                          cannot be more.
                        </p>
                      </div>

                      <div>
                        <label
                          htmlFor={`remark-${row.id}`}
                          className="block text-[0.8125rem] font-medium"
                        >
                          Note to the unit
                        </label>
                        <textarea
                          id={`remark-${row.id}`}
                          value={remarks[row.id] ?? ""}
                          onChange={(e) =>
                            setRemarks((prev) => ({ ...prev, [row.id]: e.target.value }))
                          }
                          disabled={busy}
                          rows={2}
                          maxLength={600}
                          placeholder="Needed when you send it back or turn it down."
                          className="mt-1.5 w-full resize-y rounded-lg border border-line bg-canvas px-3 py-2.5 text-[0.9375rem] leading-relaxed outline-none focus-visible:border-brass focus-visible:ring-2 focus-visible:ring-brass/40"
                        />
                        <p className="mt-1.5 text-[0.8125rem] text-muted">
                          Required to return or reject.
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void decide(row, "approved")}
                        disabled={busy}
                        className="inline-flex min-h-11 items-center rounded-lg bg-ink px-4 text-[0.9375rem] text-paper transition-colors hover:bg-ink-deep disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => void decide(row, "returned")}
                        disabled={busy}
                        className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-[0.9375rem] transition-colors hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Send back
                      </button>
                      <button
                        type="button"
                        onClick={() => void decide(row, "rejected")}
                        disabled={busy}
                        className="inline-flex min-h-11 items-center rounded-lg border border-[#d9a99c] px-4 text-[0.9375rem] text-[#a5442c] transition-colors hover:bg-[#a5442c]/[0.06] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Turn down
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}