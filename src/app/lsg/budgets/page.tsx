"use client";

import { useCallback, useEffect, useState } from "react";
import {
  STATUS_CLASS,
  STATUS_LABEL,
  formatDate,
  formatMoney,
  parseAmount,
  toDraftPayload,
  type BudgetDetail,
  type BudgetRow,
  type DraftItem,
} from "@/lib/budgets";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; budgets: BudgetRow[] };

type OpenProposal = { id: string; title: string };

const emptyRow = (): DraftItem => ({ label: "", quantity: "", unitCost: "" });

function StatusPill({ status }: { status: BudgetRow["status"] }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[0.75rem] font-medium ${STATUS_CLASS[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function LineEditor({
  rows,
  onChange,
  disabled,
}: {
  rows: DraftItem[];
  onChange: (next: DraftItem[]) => void;
  disabled: boolean;
}) {
  const set = (index: number, key: keyof DraftItem, value: string) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  };

  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row, i) => (
        <li
          key={i}
          className="rounded-card border border-line bg-canvas/50 p-3"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-[0.75rem] font-medium uppercase tracking-[0.14em] text-faint">
              Line {i + 1}
            </span>
            {rows.length > 1 ? (
              <button
                type="button"
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
                disabled={disabled}
                className="min-h-11 px-2 text-[0.8125rem] text-muted underline underline-offset-4 transition-colors hover:text-ink disabled:opacity-60"
              >
                Remove
              </button>
            ) : null}
          </div>

          <div className="mt-2 flex flex-col gap-3">
            <div>
              <label htmlFor={`line-${i}-label`} className="block text-[0.8125rem] font-medium">
                What is it for
              </label>
              <input
                id={`line-${i}-label`}
                value={row.label}
                onChange={(e) => set(i, "label", e.target.value)}
                disabled={disabled}
                maxLength={120}
                placeholder="Venue rental"
                className="mt-1.5 min-h-11 w-full rounded-lg border border-line bg-paper px-3 text-[0.9375rem] outline-none focus-visible:border-brass focus-visible:ring-2 focus-visible:ring-brass/40"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor={`line-${i}-qty`}
                  className="block text-[0.8125rem] font-medium"
                >
                  Quantity
                </label>
                <input
                  id={`line-${i}-qty`}
                  value={row.quantity}
                  onChange={(e) => set(i, "quantity", e.target.value)}
                  disabled={disabled}
                  inputMode="decimal"
                  placeholder="3"
                  className="mt-1.5 min-h-11 w-full rounded-lg border border-line bg-paper px-3 text-[0.9375rem] tabular-nums outline-none focus-visible:border-brass focus-visible:ring-2 focus-visible:ring-brass/40"
                />
              </div>
              <div>
                <label
                  htmlFor={`line-${i}-cost`}
                  className="block text-[0.8125rem] font-medium"
                >
                  Cost each
                </label>
                <input
                  id={`line-${i}-cost`}
                  value={row.unitCost}
                  onChange={(e) => set(i, "unitCost", e.target.value)}
                  disabled={disabled}
                  inputMode="decimal"
                  placeholder="250.50"
                  className="mt-1.5 min-h-11 w-full rounded-lg border border-line bg-paper px-3 text-[0.9375rem] tabular-nums outline-none focus-visible:border-brass focus-visible:ring-2 focus-visible:ring-brass/40"
                />
              </div>
            </div>

            <p className="text-[0.8125rem] text-muted">
              This line is{" "}
              <span className="tabular-nums text-ink">
                {formatMoney(
                  (parseAmount(row.quantity) ?? 0) * (parseAmount(row.unitCost) ?? 0),
                )}
              </span>
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * The LSG budget desk.
 *
 * A request is one form: a name, optionally the proposal it belongs to, and the
 * lines. There is no draft that saves halfway and no edit after sending -- a
 * request either goes to USG whole or it does not go at all. That is why there is
 * no `draft` status and no "save and finish later" button.
 *
 * The total shown under the form is a preview only. The number that counts is the
 * one the database computes from the stored lines, and it is what appears in the
 * list once the request is saved. Computing it twice is deliberate: an officer
 * should never see a subtotal the server has not agreed to.
 */
export default function LsgBudgetsPage() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [openProposals, setOpenProposals] = useState<OpenProposal[]>([]);
  const [rows, setRows] = useState<DraftItem[]>([emptyRow(), emptyRow()]);
  const [title, setTitle] = useState("");
  const [proposalId, setProposalId] = useState("");
  const [justification, setJustification] = useState("");
  const [composing, setComposing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [openDetail, setOpenDetail] = useState<Record<string, BudgetDetail>>({});
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/budgets");
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setState({ kind: "error", message: data.message ?? "We could not load your requests." });
        return;
      }
      setState({ kind: "ready", budgets: data.budgets ?? [] });

      const pres = await fetch("/api/proposals");
      const pdata = await pres.json();
      if (pres.ok && pdata.ok) {
        setOpenProposals(
          (pdata.proposals ?? [])
            .filter((p: { status?: string }) => p.status === "submitted")
            .map((p: { id: string; title: string }) => ({ id: p.id, title: p.title })),
        );
      }
    } catch {
      setState({ kind: "error", message: "We could not reach the server. Check your connection." });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [res, pres] = await Promise.all([
          fetch("/api/budgets"),
          fetch("/api/proposals"),
        ]);
        const data = await res.json();
        const pdata = await pres.json();
        if (cancelled) return;

        if (!res.ok || !data.ok) {
          setState({
            kind: "error",
            message: data.message ?? "We could not load your requests.",
          });
          return;
        }
        setState({ kind: "ready", budgets: data.budgets ?? [] });

        if (pres.ok && pdata.ok) {
          setOpenProposals(
            (pdata.proposals ?? [])
              .filter((p: { status?: string }) => p.status === "submitted")
              .map((p: { id: string; title: string }) => ({ id: p.id, title: p.title })),
          );
        }
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

  const preview = rows.reduce(
    (sum, row) => sum + (parseAmount(row.quantity) ?? 0) * (parseAmount(row.unitCost) ?? 0),
    0,
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setNotice(null);

    if (title.trim().length < 4) {
      setNotice({ tone: "bad", text: "Give the request a name of at least 4 characters." });
      return;
    }

    const payload = toDraftPayload(rows);
    if (!payload.ok) {
      setNotice({ tone: "bad", text: payload.message });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          justification: justification.trim(),
          proposalId: proposalId || null,
          items: payload.items,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setNotice({ tone: "bad", text: data.message ?? "We could not send that request." });
        return;
      }

      setRows([emptyRow(), emptyRow()]);
      setTitle("");
      setProposalId("");
      setJustification("");
      setComposing(false);
      setNotice({
        tone: "ok",
        text: `Sent to USG. The total recorded is ${formatMoney(data.requestedTotal)}.`,
      });
      await load();
    } catch {
      setNotice({ tone: "bad", text: "We could not reach the server. Check your connection." });
    } finally {
      setSaving(false);
    }
  }

  async function toggleDetail(row: BudgetRow) {
    setDetailError(null);

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
        setDetailError(data.message ?? "We could not open that request.");
        return;
      }
      setOpenDetail((prev) => ({ ...prev, [row.id]: data.budget }));
    } catch {
      setDetailError("We could not reach the server. Check your connection.");
    }
  }

  return (
    <section className="mx-auto w-full max-w-4xl">
      <header className="border-b border-line/80 pb-4">
        <p className="eyebrow">Your unit</p>
        <h1 className="mt-1 text-[1.5rem] leading-tight sm:text-[1.75rem]">
          Ask USG for funds
        </h1>
        <p className="mt-1 max-w-prose text-[0.9375rem] leading-relaxed text-body">
          List what you need and what each line costs. USG can approve the whole amount,
          approve less, or send it back with a note.
        </p>
      </header>

      <div aria-live="polite" className="mt-4 min-h-6">
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

      {!composing ? (
        <button
          type="button"
          onClick={() => setComposing(true)}
          className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-ink px-4 text-[0.9375rem] text-paper transition-colors hover:bg-ink-deep"
        >
          Start a request
        </button>
      ) : (
        <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
          <div className="rounded-card border border-line bg-paper p-4">
            <div className="flex flex-col gap-4">
              <div>
                <label htmlFor="budget-title" className="block text-[0.8125rem] font-medium">
                  What is this for
                </label>
                <input
                  id="budget-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={saving}
                  maxLength={140}
                  placeholder="Founding program budget"
                  className="mt-1.5 min-h-11 w-full rounded-lg border border-line bg-canvas px-3 text-[0.9375rem] outline-none focus-visible:border-brass focus-visible:ring-2 focus-visible:ring-brass/40"
                />
              </div>

              <div>
                <label
                  htmlFor="budget-proposal"
                  className="flex items-baseline justify-between gap-3 text-[0.8125rem] font-medium"
                >
                  <span>Attach to a proposal</span>
                  <span className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-faint">
                    Optional
                  </span>
                </label>
                <select
                  id="budget-proposal"
                  value={proposalId}
                  onChange={(e) => setProposalId(e.target.value)}
                  disabled={saving}
                  className="mt-1.5 min-h-11 w-full rounded-lg border border-line bg-canvas px-3 text-[0.9375rem] outline-none focus-visible:border-brass focus-visible:ring-2 focus-visible:ring-brass/40"
                >
                  <option value="">No proposal, this stands on its own</option>
                  {openProposals.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-[0.8125rem] text-muted">
                  Only proposals your unit submitted and that USG has not decided yet are
                  listed here.
                </p>
              </div>

              <div>
                <label
                  htmlFor="budget-justification"
                  className="flex items-baseline justify-between gap-3 text-[0.8125rem] font-medium"
                >
                  <span>Anything USG should know</span>
                  <span className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-faint">
                    Optional
                  </span>
                </label>
                <textarea
                  id="budget-justification"
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  disabled={saving}
                  maxLength={1000}
                  rows={3}
                  placeholder="The hall is booked for the whole day, so the rental cannot be split."
                  className="mt-1.5 w-full resize-y rounded-lg border border-line bg-canvas px-3 py-2.5 text-[0.9375rem] leading-relaxed outline-none focus-visible:border-brass focus-visible:ring-2 focus-visible:ring-brass/40"
                />
              </div>
            </div>
          </div>

          <LineEditor rows={rows} onChange={setRows} disabled={saving} />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setRows((prev) => (prev.length < 50 ? [...prev, emptyRow()] : prev))}
              disabled={saving || rows.length >= 50}
              className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-[0.9375rem] transition-colors hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-60"
            >
              Add a line
            </button>

            <p className="text-[0.9375rem]">
              <span className="text-muted">Running total </span>
              <span className="tabular-nums">{formatMoney(preview)}</span>
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex min-h-11 items-center rounded-lg bg-ink px-4 text-[0.9375rem] text-paper transition-colors hover:bg-ink-deep disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Sending..." : "Send to USG"}
            </button>
            <button
              type="button"
              onClick={() => {
                setComposing(false);
                setNotice(null);
              }}
              disabled={saving}
              className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-[0.9375rem] transition-colors hover:bg-canvas disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {detailError ? (
        <p className="mt-4 text-[0.9375rem] text-brass-deep">{detailError}</p>
      ) : null}

      <h2 className="mt-8 text-[1.125rem] leading-tight">Your requests</h2>

      {state.kind === "loading" ? (
        <p className="mt-3 text-[0.9375rem] text-muted">Loading your requests...</p>
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
      ) : state.budgets.length === 0 ? (
        <div className="mt-3 rounded-card border border-line bg-paper px-4 py-5">
          <p className="text-[0.9375rem] leading-relaxed text-body">
            You have not asked for funds yet. Start a request and USG will see it on their
            side.
          </p>
        </div>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {state.budgets.map((row) => {
            const detail = openDetail[row.id];
            const decided = row.status === "approved" || row.status === "rejected";
            return (
              <li key={row.id} className="rounded-card border border-line bg-paper">
                <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[0.9375rem]">{row.title}</p>
                      <StatusPill status={row.status} />
                    </div>
                    <p className="mt-0.5 text-[0.8125rem] text-muted">
                      {formatDate(row.createdAt)}
                      {row.proposalTitle ? ` · for ${row.proposalTitle}` : ""}
                    </p>
                    {row.decisionRemark ? (
                      <p className="mt-2 text-[0.875rem] leading-relaxed text-body">
                        <span className="font-medium">From USG: </span>
                        {row.decisionRemark}
                      </p>
                    ) : null}
                  </div>

                  <div className="text-right">
                    <p className="text-[0.9375rem] tabular-nums">
                      {formatMoney(row.requestedTotal)}
                    </p>
                    {decided ? (
                      <p className="text-[0.8125rem] text-muted tabular-nums">
                        {row.status === "approved"
                          ? `${formatMoney(row.approvedTotal)} approved`
                          : "nothing approved"}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void toggleDetail(row)}
                      aria-expanded={Boolean(detail)}
                      className="mt-1 min-h-11 px-2 text-[0.8125rem] text-muted underline underline-offset-4 transition-colors hover:text-ink"
                    >
                      {detail ? "Hide lines" : `Show ${row.itemCount} lines`}
                    </button>
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
                    <p className="mt-3 flex justify-between border-t border-line/70 pt-2 text-[0.9375rem]">
                      <span>Total asked</span>
                      <span className="tabular-nums">
                        {formatMoney(detail.requestedTotal)}
                      </span>
                    </p>
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