"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { CountdownChip } from "@/components/ui/CountdownChip";
import { ActionError, formatDate, selectClass } from "@/components/dashboard/workspace-shared";
import {
  BudgetDetailModal,
  BudgetMetric,
  BudgetStatus,
  BudgetTabs,
  asNumber,
  budgetFetch,
  groupLabel,
  money,
  uploadBudgetFiles,
  type BudgetExpense,
  type BudgetPeriod,
  type BudgetRequestRow,
  type BudgetUnitRow,
} from "@/components/dashboard/budget-ui";
import { parseAmount } from "@/lib/budgets";

type Tab = "overview" | "allocations" | "requests" | "review" | "expenses";
type GroupBy = "none" | "campus" | "type";

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "allocations", label: "Allocation manager" },
  { id: "requests", label: "Requests" },
  { id: "review", label: "Review queue" },
  { id: "expenses", label: "USG expenses" },
];

const REVIEWABLE = new Set(["pending", "under_review", "returned"]);
const BUDGET_TABS = new Set<string>(TABS.map((item) => item.id));

function tabFromQuery(raw: string | null, fallback: Tab): Tab {
  return raw && BUDGET_TABS.has(raw) ? (raw as Tab) : fallback;
}

export function UsgBudgetPanel() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => tabFromQuery(searchParams.get("budgetTab"), "overview"));
  const [groupBy, setGroupBy] = useState<GroupBy>("campus");
  const [periods, setPeriods] = useState<BudgetPeriod[]>([]);
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [units, setUnits] = useState<BudgetUnitRow[]>([]);
  const [requests, setRequests] = useState<BudgetRequestRow[]>([]);
  const [expenses, setExpenses] = useState<BudgetExpense[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [campusFilter, setCampusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [allocationDraft, setAllocationDraft] = useState<Record<string, string>>({});
  const [allocationNote, setAllocationNote] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseDescription, setExpenseDescription] = useState("");
  const [expenseFile, setExpenseFile] = useState<File | null>(null);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPeriods = useCallback(async () => {
    await Promise.resolve();
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
    await Promise.resolve();
    if (!periodId) return;
    setLoading(true);
    setError(null);
    try {
      const [unitResult, requestResult, expenseResult] = await Promise.all([
        budgetFetch<{ units?: BudgetUnitRow[] }>(`/api/budgets/units?periodId=${encodeURIComponent(periodId)}`),
        budgetFetch<{ budgets?: BudgetRequestRow[] }>(`/api/budgets/requests?periodId=${encodeURIComponent(periodId)}`),
        budgetFetch<{ expenses?: BudgetExpense[] }>(`/api/budgets/usg-expenses?periodId=${encodeURIComponent(periodId)}`),
      ]);
      setUnits(unitResult.units ?? []);
      setRequests(requestResult.budgets ?? []);
      setExpenses(expenseResult.expenses ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not load the budget workspace.");
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
    setTab(tabFromQuery(searchParams.get("budgetTab"), "overview"));
  }, [searchParams]);

  useEffect(() => {
    const budgetId = searchParams.get("budget");
    if (!budgetId || loading) return;
    if (requests.some((row) => row.id === budgetId)) {
      queueMicrotask(() => setDetailId(budgetId));
    }
  }, [searchParams, loading, requests]);

  const totals = useMemo(() => {
    return units.reduce(
      (sum, unit) => {
        sum.allocated += asNumber(unit.allocated);
        sum.requested += asNumber(unit.requested);
        sum.approved += asNumber(unit.approved);
        sum.committed += asNumber(unit.committed ?? unit.requested);
        sum.spent += asNumber(unit.spent);
        return sum;
      },
      { allocated: 0, requested: 0, approved: 0, committed: 0, spent: 0 },
    );
  }, [units]);

  const reviewRows = requests.filter((row) => REVIEWABLE.has(row.status));
  const filteredRequests = requests.filter((row) => {
    if (statusFilter !== "all" && row.status !== statusFilter) return false;
    if (campusFilter && groupLabel(row) !== campusFilter) return false;
    if (typeFilter && row.unitType !== typeFilter) return false;
    return true;
  });
  const campusOptions = useMemo(() => Array.from(new Set(requests.map(groupLabel))).sort(), [requests]);
  const typeOptions = useMemo(
    () => Array.from(new Set(requests.map((row) => row.unitType).filter((value): value is string => Boolean(value)))).sort(),
    [requests],
  );
  const changedAllocations = units.filter((unit) => {
    const value = allocationDraft[unit.unitId];
    if (value === undefined) return false;
    const amount = parseAmount(value);
    return amount !== null && amount >= 0 && amount !== asNumber(unit.allocated);
  });
  const currentPeriod = periods.find((period) => period.id === periodId) ?? null;

  function grouped<T extends { campusName?: string | null; unitType?: string | null }>(rows: T[]) {
    if (groupBy === "none") return [{ label: "All units", rows }];
    const groups = new Map<string, T[]>();
    for (const row of rows) {
      const label = groupBy === "campus" ? groupLabel(row) : (row.unitType ?? "Other units");
      const bucket = groups.get(label) ?? [];
      bucket.push(row);
      groups.set(label, bucket);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, group]) => ({ label, rows: group }));
  }

  async function refresh() {
    await loadData();
  }

  async function saveAllocations() {
    if (changedAllocations.length === 0) {
      setError("Change at least one allocation before saving.");
      return;
    }
    if (allocationNote.trim().length < 2) {
      setError("Write a short note explaining the allocation change.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await budgetFetch("/api/budgets/allocations", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          periodId,
          note: allocationNote.trim(),
          items: changedAllocations.map((unit) => ({
            unitId: unit.unitId,
            amount: parseAmount(allocationDraft[unit.unitId] ?? "0"),
          })),
        }),
      });
      setAllocationDraft({});
      setAllocationNote("");
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not save those allocations.");
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv() {
    if (!periodId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/budgets/export?periodId=${encodeURIComponent(periodId)}`, { cache: "no-store" });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(json.message ?? "We could not export that period.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `budget-${currentPeriod?.label ?? "period"}.csv`.replace(/[^a-z0-9-_.]+/gi, "-");
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not export that period.");
    } finally {
      setBusy(false);
    }
  }

  function startExpense(expense?: BudgetExpense) {
    setEditingExpenseId(expense?.id ?? null);
    setExpenseAmount(String(expense?.amount ?? ""));
    setExpenseDescription(expense?.description ?? "");
    setExpenseFile(null);
  }

  async function saveExpense() {
    if (!periodId) return;
    const amount = parseAmount(expenseAmount);
    if (amount === null || amount <= 0) {
      setError("Enter an expense amount above zero.");
      return;
    }
    if (expenseDescription.trim().length < 1) {
      setError("Write a short description.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let storagePath: string | null = null;
      if (expenseFile) {
        const [path] = await uploadBudgetFiles([expenseFile], "usg_expense");
        storagePath = path;
      }

      let expenseId = editingExpenseId;
      if (editingExpenseId) {
        await budgetFetch("/api/budgets/usg-expenses", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: editingExpenseId,
            amount,
            description: expenseDescription.trim(),
            receiptFile: storagePath ?? "",
          }),
        });
      } else {
        const created = await budgetFetch<{ id?: string }>("/api/budgets/usg-expenses", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            periodId,
            amount,
            description: expenseDescription.trim(),
            receiptFile: storagePath ?? "",
          }),
        });
        expenseId = created.id ?? null;
      }

      if (expenseId && storagePath) {
        await budgetFetch(`/api/budgets/usg-expenses/${encodeURIComponent(expenseId)}/files`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ paths: [storagePath] }),
        });
      }

      startExpense();
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not save that expense.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteExpense(expense: BudgetExpense) {
    if (!window.confirm("Delete this USG expense?")) return;
    setBusy(true);
    setError(null);
    try {
      await budgetFetch(`/api/budgets/usg-expenses?id=${encodeURIComponent(expense.id)}`, { method: "DELETE" });
      if (editingExpenseId === expense.id) startExpense();
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not delete that expense.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-5">
      <header className="flex flex-wrap items-start gap-3 rounded-2xl border border-line bg-paper/70 p-4 sm:p-5">
        <div>
          <p className="eyebrow">USG budget office</p>
          <h1 className="mt-1 text-[1.25rem] font-medium text-ink">Allocation, review, and spending</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
            Set what each unit may spend, review what they request, and keep the office ledger current.
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
              <option key={period.id} value={period.id}>
                {period.label}
              </option>
            ))}
          </select>
          {currentPeriod ? (
            <CountdownChip dueAt={`${currentPeriod.endsOn}T23:59:59`} closed={currentPeriod.status === "closed"} />
          ) : null}
          <Button size="sm" variant="paper" onClick={() => void refresh()}>Refresh</Button>
          <Button size="sm" variant="outline" disabled={busy || !periodId} onClick={() => void exportCsv()}>Export CSV</Button>
        </div>
      </header>

      <ActionError message={error} />

      <BudgetTabs tabs={TABS} value={tab} onChange={setTab} />

      {loading ? <p className="text-sm text-muted">Loading budget workspace…</p> : null}

      {tab === "overview" ? (
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <BudgetMetric label="Allocated" value={money(totals.allocated)} hint="Set by the office" />
            <BudgetMetric label="Requested" value={money(totals.requested)} hint="From all live requests" />
            <BudgetMetric label="Approved" value={money(totals.approved)} hint="Granted by USG" />
            <BudgetMetric label="Committed" value={money(totals.committed)} hint="Requested plus approved" />
            <BudgetMetric label="Spent" value={money(totals.spent)} hint="Against approved budgets" />
          </div>
          <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
            <table className="w-full min-w-[48rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-[0.12em] text-muted">
                  <th className="px-4 py-3 font-semibold">Unit</th>
                  <th className="px-4 py-3 font-semibold">Campus</th>
                  <th className="px-4 py-3 text-right font-semibold">Allocated</th>
                  <th className="px-4 py-3 text-right font-semibold">Requested</th>
                  <th className="px-4 py-3 text-right font-semibold">Approved</th>
                  <th className="px-4 py-3 text-right font-semibold">Remaining</th>
                </tr>
              </thead>
              <tbody>
                {units.map((unit) => (
                  <tr key={unit.unitId} className="border-b border-line/70 last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink">{unit.unitName}</div>
                      <div className="text-xs text-muted capitalize">{unit.unitType ?? "unit"}</div>
                    </td>
                    <td className="px-4 py-3 text-muted">{unit.campusName ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink">{money(unit.allocated ?? 0)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink">{money(unit.requested ?? 0)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink">{money(unit.approved ?? 0)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink">{money(unit.remainingAllocation ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "allocations" ? (
        <div className="grid gap-4">
          <div className="rounded-2xl border border-line bg-paper p-4 sm:p-5">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[14rem] flex-1">
                <label className="text-xs text-muted" htmlFor="allocation-note">Reason for change</label>
                <input
                  id="allocation-note"
                  value={allocationNote}
                  onChange={(event) => setAllocationNote(event.target.value)}
                  placeholder="Explain the adjustment"
                  className={selectClass}
                />
              </div>
              <Button variant="brass" disabled={busy} onClick={() => void saveAllocations()}>
                Save {changedAllocations.length} change{changedAllocations.length === 1 ? "" : "s"}
              </Button>
            </div>
          </div>
          {grouped(units).map((group) => (
            <div key={group.label} className="overflow-hidden rounded-2xl border border-line bg-paper">
              <div className="border-b border-line bg-canvas/40 px-4 py-3">
                <p className="eyebrow">{group.label}</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs uppercase tracking-[0.12em] text-muted">
                      <th className="px-4 py-3 font-semibold">Unit</th>
                      <th className="px-4 py-3 text-right font-semibold">Current</th>
                      <th className="px-4 py-3 text-right font-semibold">Committed</th>
                      <th className="px-4 py-3 font-semibold">New allocation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((unit) => (
                      <tr key={unit.unitId} className="border-b border-line/70 last:border-0">
                        <td className="px-4 py-3 font-medium text-ink">{unit.unitName}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-ink">{money(unit.allocated ?? 0)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-ink">{money(unit.committed ?? 0)}</td>
                        <td className="px-4 py-3">
                          <input
                            aria-label={`Allocation for ${unit.unitName}`}
                            type="number"
                            min="0"
                            step="0.01"
                            value={allocationDraft[unit.unitId] ?? String(unit.allocated ?? 0)}
                            onChange={(event) =>
                              setAllocationDraft((current) => ({ ...current, [unit.unitId]: event.target.value }))
                            }
                            className="h-10 w-full rounded-lg border border-line bg-canvas px-2 text-sm tabular-nums text-ink outline-none focus:border-line-strong"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {tab === "requests" ? (
        <div className="grid gap-4">
          <div className="flex flex-wrap gap-2 rounded-2xl border border-line bg-paper/70 p-4">
            <select aria-label="Group requests" value={groupBy} onChange={(event) => setGroupBy(event.target.value as GroupBy)} className={selectClass}>
              <option value="campus">Group by campus</option>
              <option value="type">Group by unit type</option>
              <option value="none">No grouping</option>
            </select>
            <select aria-label="Status filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={selectClass}>
              <option value="all">All statuses</option>
              <option value="under_review">Under review</option>
              <option value="returned">Returned</option>
              <option value="approved">Approved</option>
              <option value="rejected">Declined</option>
            </select>
            <select aria-label="Campus filter" value={campusFilter} onChange={(event) => setCampusFilter(event.target.value)} className={selectClass}>
              <option value="">All campuses</option>
              {campusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
            <select aria-label="Unit type filter" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className={selectClass}>
              <option value="">All unit types</option>
              {typeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>

          {grouped(filteredRequests).map((group) => (
            <div key={group.label} className="overflow-hidden rounded-2xl border border-line bg-paper">
              <div className="border-b border-line bg-canvas/40 px-4 py-3">
                <p className="eyebrow">{group.label}</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs uppercase tracking-[0.12em] text-muted">
                      <th className="px-4 py-3 font-semibold">Request</th>
                      <th className="px-4 py-3 font-semibold">Unit</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 text-right font-semibold">Requested</th>
                      <th className="px-4 py-3 text-right font-semibold">Approved</th>
                      <th className="px-4 py-3 text-right font-semibold">Spent</th>
                      <th className="px-4 py-3 font-semibold">Filed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((row) => (
                      <tr key={row.id} className="border-b border-line/70 last:border-0">
                        <td className="px-4 py-3">
                          <button type="button" onClick={() => setDetailId(row.id)} className="text-left font-medium text-ink underline decoration-brass/50 underline-offset-2">
                            {row.title}
                          </button>
                          <div className="text-xs text-muted">{row.itemCount ?? 0} line(s)</div>
                        </td>
                        <td className="px-4 py-3 text-muted">{row.unitName ?? "Unassigned"}</td>
                        <td className="px-4 py-3"><BudgetStatus status={row.status} /></td>
                        <td className="px-4 py-3 text-right tabular-nums text-ink">{money(row.requestedTotal)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-ink">{row.approvedTotal === null || row.approvedTotal === undefined ? "—" : money(row.approvedTotal)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-ink">{money(row.spent ?? row.actualSpent ?? 0)}</td>
                        <td className="px-4 py-3 text-muted">{formatDate(row.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {tab === "review" ? (
        <div className="rounded-2xl border border-line bg-paper">
          {reviewRows.length === 0 ? (
            <p className="p-6 text-sm text-muted">Nothing is waiting for review in this period.</p>
          ) : (
            <div className="divide-y divide-line/70">
              {reviewRows.map((row) => (
                <div key={row.id} className="flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-[12rem] flex-1">
                    <button type="button" onClick={() => setDetailId(row.id)} className="text-left font-medium text-ink underline decoration-brass/50 underline-offset-2">
                      {row.title}
                    </button>
                    <p className="text-xs text-muted">{row.unitName ?? "Unassigned"} · filed {formatDate(row.createdAt)}</p>
                  </div>
                  <BudgetStatus status={row.status} />
                  <span className="text-sm tabular-nums text-ink">{money(row.requestedTotal)}</span>
                  <Button size="sm" variant="brass" onClick={() => setDetailId(row.id)}>Review</Button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {tab === "expenses" ? (
        <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
          <div className="rounded-2xl border border-line bg-paper/70 p-4">
            <p className="eyebrow">{editingExpenseId ? "Edit expense" : "New expense"}</p>
            <h2 className="mt-1 text-base font-medium text-ink">Office spending</h2>
            <div className="mt-4 grid gap-3">
              <label className="text-xs text-muted" htmlFor="usg-expense-amount">Amount</label>
              <input
                id="usg-expense-amount"
                type="number"
                min="0"
                step="0.01"
                value={expenseAmount}
                onChange={(event) => setExpenseAmount(event.target.value)}
                className={selectClass}
              />
              <label className="text-xs text-muted" htmlFor="usg-expense-description">Description</label>
              <input
                id="usg-expense-description"
                value={expenseDescription}
                onChange={(event) => setExpenseDescription(event.target.value)}
                className={selectClass}
              />
              <label className="text-xs text-muted" htmlFor="usg-expense-receipt">Receipt</label>
              <input
                id="usg-expense-receipt"
                type="file"
                onChange={(event) => setExpenseFile(event.target.files?.[0] ?? null)}
                className="text-xs text-ink-soft"
              />
              <div className="flex gap-2">
                <Button variant="brass" disabled={busy} onClick={() => void saveExpense()}>
                  {editingExpenseId ? "Save changes" : "Record expense"}
                </Button>
                {editingExpenseId ? (
                  <Button variant="ghost" onClick={() => startExpense()}>Cancel</Button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-line bg-paper">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-[0.12em] text-muted">
                    <th className="px-4 py-3 font-semibold">Description</th>
                    <th className="px-4 py-3 font-semibold">Recorded</th>
                    <th className="px-4 py-3 text-right font-semibold">Amount</th>
                    <th className="px-4 py-3 font-semibold">Receipt</th>
                    <th className="px-4 py-3 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((expense) => (
                    <tr key={expense.id} className="border-b border-line/70 last:border-0">
                      <td className="px-4 py-3 text-ink">{expense.description}</td>
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
                          <span className="text-xs text-muted">No receipt</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => startExpense(expense)}>Edit</Button>
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void deleteExpense(expense)}>Delete</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {expenses.length === 0 ? <p className="p-6 text-sm text-muted">No office expenses in this period.</p> : null}
            </div>
          </div>
        </div>
      ) : null}

      {detailId ? (
        <BudgetDetailModal
          budgetId={detailId}
          allowReview
          onClose={() => setDetailId(null)}
          onChanged={() => void loadData()}
        />
      ) : null}
    </section>
  );
}
