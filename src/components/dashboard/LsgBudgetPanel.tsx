"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ActionError, formatDate, selectClass } from "@/components/dashboard/workspace-shared";
import {
  BudgetDetailModal,
  BudgetMetric,
  BudgetStatus,
  BudgetTabs,
  asNumber,
  budgetFetch,
  money,
  uploadBudgetFiles,
  type BudgetExpense,
  type BudgetOverview,
  type BudgetPeriod,
  type BudgetRequestRow,
} from "@/components/dashboard/budget-ui";
import { parseAmount, toDraftPayload, type DraftItem } from "@/lib/budgets";

type Tab = "request" | "overview" | "expenses" | "receipts";
type Step = 1 | 2 | 3 | 4;
type RollupChild = {
  unitId: string;
  unitName: string;
  unitType?: string;
  allocated?: number;
  approved?: number;
  spent?: number;
  remainingAllocation?: number;
};

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: "request", label: "Request budget" },
  { id: "overview", label: "Overview" },
  { id: "expenses", label: "Spending" },
  { id: "receipts", label: "Receipts" },
];

const emptyItem = (): DraftItem => ({ label: "", quantity: "1", unitCost: "" });
const BUDGET_TABS = new Set<string>(TABS.map((item) => item.id));

function tabFromQuery(raw: string | null, fallback: Tab): Tab {
  return raw && BUDGET_TABS.has(raw) ? (raw as Tab) : fallback;
}

export function LsgBudgetPanel({
  eventId,
  eventTitle,
  initialTab = "request",
  compact = false,
  onDone,
}: {
  eventId?: string;
  eventTitle?: string;
  initialTab?: Tab;
  compact?: boolean;
  onDone?: () => void;
}) {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => tabFromQuery(searchParams.get("budgetTab"), initialTab));
  const [step, setStep] = useState<Step>(1);
  const [periods, setPeriods] = useState<BudgetPeriod[]>([]);
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [overview, setOverview] = useState<BudgetOverview | null>(null);
  const [requests, setRequests] = useState<BudgetRequestRow[]>([]);
  const [expenses, setExpenses] = useState<BudgetExpense[]>([]);
  const [rollup, setRollup] = useState<RollupChild[]>([]);
  const [title, setTitle] = useState(eventTitle ? `${eventTitle} budget`.slice(0, 140) : "");
  const [justification, setJustification] = useState("");
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);
  const [supportFiles, setSupportFiles] = useState<File[]>([]);
  const [spendDrafts, setSpendDrafts] = useState<Record<string, string>>({});
  const [spendDescriptions, setSpendDescriptions] = useState<Record<string, string>>({});
  const [spendReceipts, setSpendReceipts] = useState<Record<string, File | null>>({});
  const [detailId, setDetailId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadPeriods = useCallback(async () => {
    try {
      const json = await budgetFetch<{ periods?: BudgetPeriod[] }>("/api/budgets/periods");
      const list = json.periods ?? [];
      queueMicrotask(() => setPeriods(list));
      queueMicrotask(() => setPeriodId((current) => current ?? list.find((period) => period.isDefault)?.id ?? list[0]?.id ?? null));
    } catch (e) {
      queueMicrotask(() => setError(e instanceof Error ? e.message : "We could not load budget periods."));
    }
  }, []);

  const loadData = useCallback(async () => {
    if (!periodId) return;
    setLoading(true);
    setError(null);
    try {
      const [overviewResult, budgetResult, expenseResult] = await Promise.all([
        budgetFetch<{ overview?: BudgetOverview }>(`/api/budgets/unit-overview?periodId=${encodeURIComponent(periodId)}`),
        budgetFetch<{ budgets?: BudgetRequestRow[] }>("/api/budgets"),
        budgetFetch<{ expenses?: BudgetExpense[] }>(`/api/budgets/unit-expenses?periodId=${encodeURIComponent(periodId)}`),
      ]);
      const ownOverview = overviewResult.overview ?? null;
      setOverview(ownOverview);
      setRequests(budgetResult.budgets ?? []);
      setExpenses(expenseResult.expenses ?? []);
      if (ownOverview?.unitId) {
        const rollupResult = await budgetFetch<{ rollup?: { children?: RollupChild[] } }>(
          `/api/budgets/rollup?unitId=${encodeURIComponent(ownOverview.unitId)}&periodId=${encodeURIComponent(periodId)}`,
        );
        setRollup(rollupResult.rollup?.children ?? []);
      } else {
        setRollup([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not load your budget workspace.");
    } finally {
      setLoading(false);
    }
  }, [periodId]);

  const loadPeriodsEvent = useEffectEvent(loadPeriods);
  const loadDataEvent = useEffectEvent(loadData);

  useEffect(() => {
    void loadPeriodsEvent();
  }, []);

  useEffect(() => {
    void loadDataEvent();
  }, [periodId]);

  useEffect(() => {
    setTab(tabFromQuery(searchParams.get("budgetTab"), initialTab));
  }, [searchParams, initialTab]);

  useEffect(() => {
    const budgetId = searchParams.get("budget");
    if (!budgetId || loading) return;
    if (requests.some((row) => row.id === budgetId)) {
      queueMicrotask(() => setDetailId(budgetId));
    }
  }, [searchParams, loading, requests]);

  const approved = useMemo(
    () => requests.filter((row) => row.status === "approved"),
    [requests],
  );
  const requestTotal = useMemo(() => {
    const payload = toDraftPayload(items);
    return payload.ok ? payload.items.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0) : 0;
  }, [items]);
  const currentPeriod = periods.find((period) => period.id === periodId) ?? null;

  function addItem() {
    setItems((current) => [...current, emptyItem()]);
  }

  function updateItem(index: number, patch: Partial<DraftItem>) {
    setItems((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function removeItem(index: number) {
    setItems((current) => (current.length === 1 ? current : current.filter((_, rowIndex) => rowIndex !== index)));
  }

  function nextStep() {
    setError(null);
    if (step === 1) {
      if (title.trim().length < 4) {
        setError("Give the request a name of at least 4 characters.");
        return;
      }
      if (justification.trim().length < 4) {
        setError("Write a short justification before continuing.");
        return;
      }
    }
    if (step === 2) {
      const payload = toDraftPayload(items);
      if (!payload.ok) {
        setError(payload.message);
        return;
      }
    }
    setStep((current) => Math.min(4, current + 1) as Step);
  }

  async function submitRequest() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload = toDraftPayload(items);
      if (!payload.ok) throw new Error(payload.message);

      const created = await budgetFetch<{ budgetId?: string }>("/api/budgets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          justification: justification.trim(),
          periodId,
          eventId: eventId ?? null,
          items: payload.items,
        }),
      });

      const budgetId = created.budgetId;
      if (!budgetId) throw new Error("The request was submitted but no reference came back.");

      if (supportFiles.length > 0) {
        const paths = await uploadBudgetFiles(supportFiles, "justification", overview?.unitId);
        await budgetFetch(`/api/budgets/${encodeURIComponent(budgetId)}/files`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: "justification", paths }),
        });
      }

      setTitle(eventTitle ? `${eventTitle} budget`.slice(0, 140) : "");
      setJustification("");
      setItems([emptyItem()]);
      setSupportFiles([]);
      setStep(1);
      setNotice("Budget request submitted for review.");
      setTab("overview");
      await loadData();
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not submit that request.");
    } finally {
      setBusy(false);
    }
  }

  async function recordSpending(request: BudgetRequestRow) {
    const amount = parseAmount(spendDrafts[request.id] ?? "");
    if (amount === null || amount <= 0) {
      setError("Enter a spending amount above zero.");
      return;
    }
    const description = (spendDescriptions[request.id] ?? "").trim();
    if (!description) {
      setError("Write a short description for that spending.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      let receiptFile = "";
      const receipt = spendReceipts[request.id] ?? null;
      if (receipt) {
        const [path] = await uploadBudgetFiles([receipt], "receipt", overview?.unitId);
        receiptFile = path;
      }
      await budgetFetch("/api/budgets/unit-expenses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: request.id,
          amount,
          description,
          receiptFile,
        }),
      });
      setSpendDrafts((current) => ({ ...current, [request.id]: "" }));
      setSpendDescriptions((current) => ({ ...current, [request.id]: "" }));
      setSpendReceipts((current) => ({ ...current, [request.id]: null }));
      setNotice("Spending recorded.");
      await loadData();
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not record that spending.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={compact ? "grid gap-4" : "grid gap-5"}>
      {!compact ? (
        <header className="flex flex-wrap items-start gap-3 rounded-2xl border border-line bg-paper/70 p-4 sm:p-5">
          <div>
            <p className="eyebrow">Unit budget workspace</p>
            <h1 className="mt-1 text-[1.25rem] font-medium text-ink">Request, spend, and account</h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
              File a request against your allocation, then keep a receipt for every peso you spend.
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select
              aria-label="Budget period"
              value={periodId ?? ""}
              onChange={(event) => setPeriodId(event.target.value || null)}
              className={selectClass}
            >
              {periods.map((period) => (
                <option key={period.id} value={period.id}>{period.label}</option>
              ))}
            </select>
            <span className="text-xs text-muted">{currentPeriod ? `${formatDate(currentPeriod.startsOn)} - ${formatDate(currentPeriod.endsOn)}` : ""}</span>
          </div>
        </header>
      ) : null}

      {compact ? (
        <p className="text-sm text-muted">
          {eventTitle ? `Budget for ${eventTitle}. ` : ""}Choose a period, add your lines, attach a justification, and send it for review.
        </p>
      ) : null}

      <ActionError message={error} />
      {notice ? <p className="rounded-xl border border-line bg-paper/70 px-3.5 py-2.5 text-sm text-ink">{notice}</p> : null}

      <BudgetTabs tabs={TABS} value={tab} onChange={setTab} />

      {loading ? <p className="text-sm text-muted">Loading your budget…</p> : null}

      {tab === "request" ? (
        <div className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setStep(value as Step)}
                aria-current={step === value ? "step" : undefined}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                  step === value
                    ? "border-ink bg-ink text-white"
                    : "border-line bg-paper text-ink-soft"
                }`}
              >
                {value}. {["Details", "Lines", "Files", "Review"][value - 1]}
              </button>
            ))}
          </div>

          <div className="rounded-2xl border border-line bg-paper p-4 sm:p-5">
            {step === 1 ? (
              <div className="grid gap-3">
                <p className="eyebrow">Step 1 of 4</p>
                <h2 className="text-lg font-medium text-ink">What are you requesting?</h2>
                {!eventId ? (
                  <div>
                    <label className="text-xs text-muted" htmlFor="lsg-budget-period">Budget period</label>
                    <select
                      id="lsg-budget-period"
                      value={periodId ?? ""}
                      onChange={(event) => setPeriodId(event.target.value || null)}
                      className={selectClass}
                    >
                      {periods.map((period) => (
                        <option key={period.id} value={period.id}>{period.label}</option>
                      ))}
                    </select>
                  </div>
                ) : null}
                <div>
                  <label className="text-xs text-muted" htmlFor="lsg-budget-title">Request name</label>
                  <input
                    id="lsg-budget-title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className={selectClass}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted" htmlFor="lsg-budget-justification">Justification</label>
                  <textarea
                    id="lsg-budget-justification"
                    rows={4}
                    value={justification}
                    onChange={(event) => setJustification(event.target.value)}
                    className="w-full rounded-xl border border-line bg-paper/70 px-3.5 py-3 text-sm text-ink-deep outline-none focus:border-ink/25"
                  />
                </div>
                <div className="flex justify-end">
                  <Button variant="brass" onClick={nextStep}>Continue to lines</Button>
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="grid gap-3">
                <p className="eyebrow">Step 2 of 4</p>
                <h2 className="text-lg font-medium text-ink">Break down the amount</h2>
                {items.map((item, index) => (
                  <div key={index} className="grid gap-2 rounded-xl border border-line/70 bg-canvas/40 p-3 sm:grid-cols-[1fr_6rem_8rem_auto]">
                    <input
                      aria-label={`Line ${index + 1} name`}
                      value={item.label}
                      onChange={(event) => updateItem(index, { label: event.target.value })}
                      placeholder="Line name"
                      className={selectClass}
                    />
                    <input
                      aria-label={`Line ${index + 1} quantity`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.quantity}
                      onChange={(event) => updateItem(index, { quantity: event.target.value })}
                      className={selectClass}
                    />
                    <input
                      aria-label={`Line ${index + 1} unit cost`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.unitCost}
                      onChange={(event) => updateItem(index, { unitCost: event.target.value })}
                      placeholder="Unit cost"
                      className={selectClass}
                    />
                    <Button variant="ghost" onClick={() => removeItem(index)}>Remove</Button>
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" onClick={addItem}>Add line</Button>
                  <span className="ml-auto text-sm tabular-nums text-ink">Total {money(requestTotal)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
                  <Button variant="brass" onClick={nextStep}>Continue to files</Button>
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="grid gap-3">
                <p className="eyebrow">Step 3 of 4</p>
                <h2 className="text-lg font-medium text-ink">Attach the justification</h2>
                <p className="text-sm text-muted">PDFs, sheets, images, and archives up to 10 MB each are accepted.</p>
                <label className="text-xs text-muted" htmlFor="lsg-budget-files">Supporting files</label>
                <input
                  id="lsg-budget-files"
                  type="file"
                  multiple
                  onChange={(event) => setSupportFiles(Array.from(event.target.files ?? []))}
                  className="text-sm text-ink-soft"
                />
                {supportFiles.length > 0 ? (
                  <ul className="grid gap-1 text-sm text-ink-soft">
                    {supportFiles.map((file) => <li key={`${file.name}-${file.size}`}>{file.name}</li>)}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">No files selected.</p>
                )}
                <div className="flex justify-between gap-2">
                  <Button variant="ghost" onClick={() => setStep(2)}>Back</Button>
                  <Button variant="brass" onClick={nextStep}>Review request</Button>
                </div>
              </div>
            ) : null}

            {step === 4 ? (
              <div className="grid gap-3">
                <p className="eyebrow">Step 4 of 4</p>
                <h2 className="text-lg font-medium text-ink">Send for review</h2>
                <div className="grid gap-2 sm:grid-cols-3">
                  <BudgetMetric label="Requested" value={money(requestTotal)} />
                  <BudgetMetric label="Remaining allocation" value={money(overview?.remainingAllocation ?? 0)} />
                  <BudgetMetric label="Lines" value={String(items.length)} />
                </div>
                <div className="rounded-xl border border-line/70 bg-canvas/40 p-3">
                  <p className="text-sm font-medium text-ink">{title}</p>
                  <p className="mt-1 text-sm whitespace-pre-wrap text-ink-soft">{justification}</p>
                </div>
                <p className="text-sm text-muted">
                  {supportFiles.length} file{supportFiles.length === 1 ? "" : "s"} will be attached after submission.
                </p>
                <div className="flex justify-between gap-2">
                  <Button variant="ghost" onClick={() => setStep(3)}>Back</Button>
                  <Button variant="brass" disabled={busy} onClick={() => void submitRequest()}>
                    {busy ? "Submitting…" : "Submit request"}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === "overview" ? (
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <BudgetMetric label="Allocated" value={money(overview?.allocated ?? 0)} />
            <BudgetMetric label="Requested" value={money(overview?.requested ?? 0)} />
            <BudgetMetric label="Approved" value={money(overview?.approved ?? 0)} />
            <BudgetMetric label="Spent" value={money(overview?.spent ?? 0)} />
            <BudgetMetric label="Remaining" value={money(overview?.remainingApproved ?? 0)} />
          </div>

          {rollup.length > 0 ? (
            <div className="overflow-hidden rounded-2xl border border-line bg-paper">
              <div className="border-b border-line bg-canvas/40 px-4 py-3">
                <p className="eyebrow">Nested units</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs uppercase tracking-[0.12em] text-muted">
                      <th className="px-4 py-3 font-semibold">Unit</th>
                      <th className="px-4 py-3 font-semibold">Type</th>
                      <th className="px-4 py-3 text-right font-semibold">Allocated</th>
                      <th className="px-4 py-3 text-right font-semibold">Approved</th>
                      <th className="px-4 py-3 text-right font-semibold">Spent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rollup.map((child) => (
                      <tr key={child.unitId} className="border-b border-line/70 last:border-0">
                        <td className="px-4 py-3 font-medium text-ink">{child.unitName}</td>
                        <td className="px-4 py-3 capitalize text-muted">{child.unitType ?? "unit"}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-ink">{money(child.allocated ?? 0)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-ink">{money(child.approved ?? 0)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-ink">{money(child.spent ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="overflow-hidden rounded-2xl border border-line bg-paper">
            <div className="border-b border-line bg-canvas/40 px-4 py-3">
              <p className="eyebrow">Your requests</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-[0.12em] text-muted">
                    <th className="px-4 py-3 font-semibold">Request</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 text-right font-semibold">Requested</th>
                    <th className="px-4 py-3 text-right font-semibold">Approved</th>
                    <th className="px-4 py-3 text-right font-semibold">Spent</th>
                    <th className="px-4 py-3 font-semibold">Filed</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((row) => (
                    <tr key={row.id} className="border-b border-line/70 last:border-0">
                      <td className="px-4 py-3">
                        <button type="button" onClick={() => setDetailId(row.id)} className="text-left font-medium text-ink underline decoration-brass/50 underline-offset-2">
                          {row.title}
                        </button>
                      </td>
                      <td className="px-4 py-3"><BudgetStatus status={row.status} /></td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink">{money(row.requestedTotal)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink">{row.approvedTotal === null || row.approvedTotal === undefined ? "—" : money(row.approvedTotal)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink">{money(row.spent ?? row.actualSpent ?? 0)}</td>
                      <td className="px-4 py-3 text-muted">{formatDate(row.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {requests.length === 0 ? <p className="p-6 text-sm text-muted">No budget requests yet.</p> : null}
            </div>
          </div>
        </div>
      ) : null}

      {tab === "expenses" ? (
        <div className="grid gap-3">
          {approved.length === 0 ? (
            <div className="rounded-2xl border border-line bg-paper p-6 text-sm text-muted">
              No approved budget is ready for spending yet.
            </div>
          ) : null}
          {approved.map((request) => {
            const approvedAmount = asNumber(request.approvedTotal);
            const spent = asNumber(request.spent ?? request.actualSpent);
            return (
              <div key={request.id} className="rounded-2xl border border-line bg-paper p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-[12rem] flex-1">
                    <button type="button" onClick={() => setDetailId(request.id)} className="text-left font-medium text-ink underline decoration-brass/50 underline-offset-2">
                      {request.title}
                    </button>
                    <p className="text-xs text-muted">
                      Approved {money(approvedAmount)} · Spent {money(spent)} · Remaining {money(Math.max(0, approvedAmount - spent))}
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-[8rem_1fr_auto_auto]">
                  <input
                    aria-label={`New spending for ${request.title}`}
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Amount"
                    value={spendDrafts[request.id] ?? ""}
                    onChange={(event) => setSpendDrafts((current) => ({ ...current, [request.id]: event.target.value }))}
                    className={selectClass}
                  />
                  <input
                    aria-label={`Description for ${request.title}`}
                    placeholder="What was this for?"
                    value={spendDescriptions[request.id] ?? ""}
                    onChange={(event) => setSpendDescriptions((current) => ({ ...current, [request.id]: event.target.value }))}
                    className={selectClass}
                  />
                  <input
                    aria-label={`Receipt for ${request.title}`}
                    type="file"
                    onChange={(event) => setSpendReceipts((current) => ({ ...current, [request.id]: event.target.files?.[0] ?? null }))}
                    className="text-xs text-ink-soft"
                  />
                  <Button variant="brass" disabled={busy} onClick={() => void recordSpending(request)}>Record</Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {tab === "receipts" ? (
        <div className="overflow-hidden rounded-2xl border border-line bg-paper">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-[0.12em] text-muted">
                  <th className="px-4 py-3 font-semibold">Description</th>
                  <th className="px-4 py-3 font-semibold">Request</th>
                  <th className="px-4 py-3 font-semibold">Recorded</th>
                  <th className="px-4 py-3 text-right font-semibold">Amount</th>
                  <th className="px-4 py-3 font-semibold">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((expense) => (
                  <tr key={expense.id} className="border-b border-line/70 last:border-0">
                    <td className="px-4 py-3 text-ink">{expense.description}</td>
                    <td className="px-4 py-3 text-muted">
                      {requests.find((row) => row.id === expense.requestId)?.title ?? "Budget request"}
                    </td>
                    <td className="px-4 py-3 text-muted">{formatDate(expense.recordedAt)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink">{money(expense.amount)}</td>
                    <td className="px-4 py-3">
                      {expense.receiptFile ? (
                        <a
                          href={`/api/budget-files?path=${encodeURIComponent(expense.receiptFile)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm text-ink underline decoration-brass/50 underline-offset-2"
                        >
                          Open
                        </a>
                      ) : (
                        <span className="text-xs text-muted">No file</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {expenses.length === 0 ? <p className="p-6 text-sm text-muted">No receipts filed yet.</p> : null}
          </div>
        </div>
      ) : null}

      {detailId ? (
        <BudgetDetailModal budgetId={detailId} onClose={() => setDetailId(null)} />
      ) : null}
    </section>
  );
}
