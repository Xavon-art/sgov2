"use client";

import { useCallback, useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { ActionError, formatDate } from "@/components/dashboard/workspace-shared";
import { messageFor } from "@/lib/auth/messages";
import { uploadFile } from "@/lib/upload-client";
import {
  BUDGET_CLASS,
  BUDGET_LABEL,
  formatMoney,
  type BudgetItem,
  type Status,
} from "@/lib/budgets";
import { cn } from "@/lib/utils";

export type BudgetPeriod = {
  id: string;
  label: string;
  startsOn: string;
  endsOn: string;
  status: "draft" | "open" | "closed";
  isDefault?: boolean;
};

export type BudgetUnitRow = {
  unitId: string;
  unitName: string;
  unitType?: string;
  campusName?: string | null;
  allocated?: number;
  requested?: number;
  approved?: number;
  committed?: number;
  spent?: number;
  remainingAllocation?: number;
  remainingApproved?: number;
};

export type BudgetRequestRow = {
  id: string;
  unitId?: string | null;
  unitName?: string | null;
  unitType?: string | null;
  campusName?: string | null;
  periodLabel?: string | null;
  title: string;
  status: Status;
  requestedTotal: number;
  approvedTotal?: number | null;
  spent?: number | null;
  actualSpent?: number | null;
  decisionRemark?: string | null;
  itemCount?: number;
  createdAt: string;
};

export type BudgetDetailData = {
  id: string;
  title: string;
  justification: string | null;
  status: Status;
  unitName: string | null;
  periodLabel: string | null;
  requestedTotal: number;
  approvedTotal: number | null;
  actualSpent: number | null;
  spent: number | null;
  decisionRemark: string | null;
  decidedAt: string | null;
  createdAt: string;
  items: BudgetItem[];
};

export type BudgetFile = {
  storagePath: string;
  kind: "justification" | "receipt" | "usg_expense";
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
};

export type BudgetTimelineEvent = {
  id: string;
  stage: string;
  status: string | null;
  note: string;
  actorName: string;
  createdAt: string;
};

export type BudgetOverview = {
  unitId: string;
  periodId: string;
  allocated: number;
  requested: number;
  approved: number;
  spent: number;
  committed: number;
  remainingAllocation: number;
  remainingApproved: number;
  requestCount: number;
};

export type BudgetExpense = {
  id: string;
  requestId?: string | null;
  amount: number;
  description: string;
  receiptFile: string | null;
  recordedBy?: string | null;
  recordedAt: string;
};

export const money = (value: number | string | null | undefined) => `PHP ${formatMoney(value)}`;

export function asNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function groupLabel(row: { campusName?: string | null; unitType?: string | null }): string {
  if (row.campusName) return row.campusName;
  if (row.unitType) return row.unitType.charAt(0).toUpperCase() + row.unitType.slice(1);
  return "Other units";
}

export async function budgetFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
  if (!res.ok || json.ok === false) {
    throw new Error(json.message ?? "We could not complete that request.");
  }
  return json as T;
}

export async function uploadBudgetFiles(
  files: File[],
  kind: "justification" | "receipt" | "usg_expense",
  unitId?: string,
): Promise<string[]> {
  const paths: string[] = [];
  for (const file of files) {
    const result = await uploadFile(file, {
      target: "budget",
      budgetKind: kind,
      unitId,
      nonce: window.crypto.randomUUID(),
      version: 1,
    });
    if (!result.ok || !result.storagePath) {
      throw new Error(messageFor(result.reason ?? "retry"));
    }
    paths.push(result.storagePath);
  }
  return paths;
}

export function BudgetModal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "max-h-[90vh] w-full overflow-auto rounded-2xl border border-line bg-paper p-5 shadow-lift sm:p-6",
          wide ? "max-w-4xl" : "max-w-2xl",
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-medium text-ink">{title}</h2>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">
            Close
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function BudgetTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (tab: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            "rounded-full border px-4 py-2 text-[0.8125rem] font-medium transition-colors",
            value === tab.id
              ? "border-ink bg-ink text-white"
              : "border-line bg-paper text-ink-soft hover:border-line-strong hover:text-ink",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function BudgetMetric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-line/70 bg-canvas/40 p-3">
      <p className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">{label}</p>
      <p className="mt-1 text-lg font-medium tabular-nums text-ink">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function BudgetStatus({ status }: { status: Status }) {
  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-xs", BUDGET_CLASS[status])}>
      {BUDGET_LABEL[status]}
    </span>
  );
}

export function TimelineCard({ events }: { events: BudgetTimelineEvent[] }) {
  if (events.length === 0) {
    return <p className="mt-3 text-sm text-muted">No activity yet.</p>;
  }
  return (
    <ol className="mt-4 space-y-3">
      {events.map((event, index) => (
        <li key={event.id} className="relative flex gap-3 pl-1">
          <div className="flex flex-col items-center pt-1">
            <span
              className={cn(
                "size-2.5 rounded-full border",
                index === events.length - 1 ? "border-brass bg-brass" : "border-line-strong bg-canvas",
              )}
            />
            {index < events.length - 1 ? <span className="mt-1 h-full w-px bg-line" /> : null}
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-sm font-medium text-ink">
                {event.stage.charAt(0).toUpperCase() + event.stage.slice(1)}
                {event.status && event.stage === "decision" ? ` · ${BUDGET_LABEL[event.status as Status] ?? event.status}` : ""}
              </p>
              <span className="text-xs text-muted">{formatDate(event.createdAt)}</span>
            </div>
            <p className="text-xs text-muted">{event.actorName || "System"}</p>
            {event.note ? <p className="mt-1 text-sm text-ink-soft">{event.note}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function BudgetTimeline({ budgetId, refreshKey }: { budgetId: string; refreshKey?: number }) {
  const [events, setEvents] = useState<BudgetTimelineEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    queueMicrotask(() => setLoading(true));
    queueMicrotask(() => setError(null));
    try {
      const json = await budgetFetch<{ events?: BudgetTimelineEvent[] }>(
        `/api/budgets/${encodeURIComponent(budgetId)}/timeline`,
      );
      queueMicrotask(() => setEvents(json.events ?? []));
    } catch (e) {
      queueMicrotask(() => setError(e instanceof Error ? e.message : "We could not load the timeline."));
    } finally {
      queueMicrotask(() => setLoading(false));
    }
  }, [budgetId]);

  const loadEvent = useEffectEvent(load);

  useEffect(() => {
    void loadEvent();
  }, [budgetId, refreshKey]);

  return (
    <section className="rounded-2xl border border-line bg-paper/70 p-4">
      <p className="eyebrow">Lifecycle</p>
      <h3 className="mt-1 text-sm font-semibold tracking-[0.12em] text-ink-soft uppercase">Timeline</h3>
      <ActionError message={error} />
      {loading ? <p className="mt-3 text-sm text-muted">Loading timeline…</p> : null}
      {!loading ? <TimelineCard events={events} /> : null}
    </section>
  );
}

export function BudgetFileList({ files }: { files: BudgetFile[] }) {
  if (files.length === 0) {
    return <p className="text-sm text-muted">No files attached.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {files.map((file) => (
        <div
          key={file.storagePath}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line/70 bg-canvas/40 px-3 py-2"
        >
          <div className="min-w-0">
            <a
              href={`/api/budget-files?path=${encodeURIComponent(file.storagePath)}`}
              target="_blank"
              rel="noreferrer"
              className="truncate text-sm font-medium text-ink underline decoration-brass/50 underline-offset-2"
            >
              {file.originalName}
            </a>
            <p className="text-xs text-muted">
              {file.kind} · {(file.sizeBytes / 1024).toFixed(0)} KB · {formatDate(file.uploadedAt)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function BudgetDetailModal({
  budgetId,
  onClose,
  allowReview = false,
  onChanged,
}: {
  budgetId: string;
  onClose: () => void;
  allowReview?: boolean;
  onChanged?: () => void;
}) {
  const [detail, setDetail] = useState<BudgetDetailData | null>(null);
  const [files, setFiles] = useState<BudgetFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [remark, setRemark] = useState("");
  const [approvedTotal, setApprovedTotal] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => setError(null));
    queueMicrotask(() => setDetail(null));
    void (async () => {
      try {
        const [detailResult, fileResult] = await Promise.all([
          budgetFetch<{ budget: BudgetDetailData }>(`/api/budgets/${encodeURIComponent(budgetId)}`),
          budgetFetch<{ files?: BudgetFile[] }>(`/api/budgets/${encodeURIComponent(budgetId)}/files`),
        ]);
        if (!active) return;
        setDetail(detailResult.budget);
        setFiles(fileResult.files ?? []);
        setApprovedTotal(String(detailResult.budget.approvedTotal ?? detailResult.budget.requestedTotal ?? ""));
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "We could not load that request.");
      }
    })();
    return () => {
      active = false;
    };
  }, [budgetId, refreshKey]);

  async function review(decision: "approved" | "returned" | "rejected") {
    if ((decision === "returned" || decision === "rejected") && remark.trim().length < 2) {
      setError("Write a short remark before returning or rejecting a request.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await budgetFetch(`/api/budgets/${encodeURIComponent(budgetId)}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decision,
          remark: remark.trim(),
          approvedTotal: decision === "approved" ? approvedTotal : null,
        }),
      });
      setRemark("");
      setRefreshKey((key) => key + 1);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not record that decision.");
    } finally {
      setBusy(false);
    }
  }

  const canReview = allowReview && detail && ["under_review", "returned"].includes(detail.status);

  return (
    <BudgetModal title={detail?.title ?? "Budget request"} onClose={onClose} wide>
      <ActionError message={error} />
      {!detail ? (
        <p className="text-sm text-muted">Loading request…</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <BudgetStatus status={detail.status} />
              <span className="text-xs text-muted">{detail.unitName ?? "Unassigned"}</span>
              <span className="text-xs text-muted">{detail.periodLabel ?? "No period"}</span>
              <span className="text-xs text-muted">Filed {formatDate(detail.createdAt)}</span>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <BudgetMetric label="Requested" value={money(detail.requestedTotal)} />
              <BudgetMetric label="Approved" value={money(detail.approvedTotal ?? 0)} />
              <BudgetMetric label="Spent" value={money(detail.spent ?? detail.actualSpent ?? 0)} />
            </div>

            {detail.justification ? (
              <div className="rounded-xl border border-line/70 bg-canvas/40 p-3">
                <p className="eyebrow">Justification</p>
                <p className="mt-1 text-sm leading-relaxed text-ink-soft">{detail.justification}</p>
              </div>
            ) : null}

            {detail.decisionRemark ? (
              <div className="rounded-xl border border-line/70 bg-canvas/40 p-3">
                <p className="eyebrow">Decision note</p>
                <p className="mt-1 text-sm leading-relaxed text-ink-soft">{detail.decisionRemark}</p>
              </div>
            ) : null}

            <div className="overflow-x-auto rounded-xl border border-line/70">
              <table className="w-full min-w-[28rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-[0.12em] text-muted">
                    <th className="px-3 py-2 font-semibold">Line</th>
                    <th className="px-3 py-2 text-right font-semibold">Qty</th>
                    <th className="px-3 py-2 text-right font-semibold">Unit cost</th>
                    <th className="px-3 py-2 text-right font-semibold">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((item) => (
                    <tr key={item.id} className="border-b border-line/70 last:border-0">
                      <td className="px-3 py-2 text-ink">{item.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-soft">{item.quantity}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-soft">{money(item.unitCost)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink">{money(item.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-2xl border border-line bg-paper/70 p-4">
              <p className="eyebrow">Attachments</p>
              <h3 className="mt-1 text-sm font-medium text-ink">Files</h3>
              <div className="mt-3">
                <BudgetFileList files={files} />
              </div>
            </div>
          </div>

          <div className="grid content-start gap-4">
            <BudgetTimeline budgetId={budgetId} refreshKey={refreshKey} />
            {canReview ? (
              <div className="rounded-2xl border border-line bg-paper/70 p-4">
                <p className="eyebrow">Decision</p>
                <h3 className="mt-1 text-sm font-medium text-ink">Review this request</h3>
                <div className="mt-3 grid gap-2">
                  <label className="text-xs text-muted" htmlFor={`approve-${budgetId}`}>
                    Approved amount
                  </label>
                  <input
                    id={`approve-${budgetId}`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={approvedTotal}
                    onChange={(event) => setApprovedTotal(event.target.value)}
                    className="h-10 w-full rounded-lg border border-line bg-canvas px-2 text-sm tabular-nums text-ink outline-none focus:border-line-strong"
                  />
                  <textarea
                    aria-label="Review remark"
                    rows={3}
                    value={remark}
                    onChange={(event) => setRemark(event.target.value)}
                    placeholder="Remark (required to return or reject)"
                    className="rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-line-strong"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="brass" disabled={busy} onClick={() => void review("approved")}>Approve</Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void review("returned")}>Return</Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void review("rejected")}>Decline</Button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </BudgetModal>
  );
}
