"use client";

import { useCallback, useEffect, useState } from "react";
import { ActionError } from "@/components/dashboard/workspace-shared";
import { Button } from "@/components/ui/Button";
import {
  MONITORING_STATUSES,
  monitoringCsv,
  parseMonitoringPayload,
  type MonitoringPayload,
  type MonitoringStatus,
} from "@/lib/monitoring";

const STATUS_LABELS: Record<MonitoringStatus, string> = {
  pending: "Pending",
  under_review: "Under review",
  approved: "Approved",
  returned: "Returned",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

const STATUS_BARS: Record<MonitoringStatus, string> = {
  pending: "bg-[#b9863c]",
  under_review: "bg-[#3d6f9b]",
  approved: "bg-[#3f7d5b]",
  returned: "bg-[#8a6bb2]",
  rejected: "bg-[#a64b4b]",
  cancelled: "bg-[#7c8791]",
};

function share(value: number, total: number): string {
  return total > 0 ? `${Math.round((value / total) * 100)}%` : "0%";
}

function barWidth(value: number, total: number): string {
  return total > 0 && value > 0 ? `${Math.max(4, Math.round((value / total) * 100))}%` : "0%";
}

export function MonitoringPanel() {
  const [payload, setPayload] = useState<MonitoringPayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const res = await fetch("/api/monitoring");
      const json = await res.json();
      const parsed = parseMonitoringPayload(json);
      if (!parsed) throw new Error(json?.message ?? "We could not load the monitoring data.");
      setPayload(parsed);
      setState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We could not load the monitoring data.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const exportCsv = useCallback(() => {
    if (!payload) return;
    const blob = new Blob([monitoringCsv(payload)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "monitoring-by-campus.csv";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [payload]);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Monitoring by campus</p>
          <h2 className="mt-1 text-[1.25rem] leading-tight">Status counts across the federation</h2>
          <p className="mt-2 max-w-2xl text-[0.9375rem] leading-relaxed text-body">
            Every USG unit, with the nine federated modules summarized in the same status vocabulary.
            Organization-wide records appear under All campuses.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={state === "loading"}>
            Refresh
          </Button>
          <Button size="sm" variant="brass" onClick={exportCsv} disabled={!payload}>
            Export CSV
          </Button>
        </div>
      </div>

      <ActionError message={error} />

      {state === "loading" && <p className="text-muted">Loading monitoring data...</p>}

      {state === "ready" && payload && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {MONITORING_STATUSES.map((status) => (
              <div key={status} className="rounded-2xl border border-line bg-paper p-4">
                <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.16em] text-muted uppercase">
                  <span className={`h-2 w-2 rounded-full ${STATUS_BARS[status]}`} aria-hidden="true" />
                  {STATUS_LABELS[status]}
                </div>
                <div className="mt-1 text-[1.35rem] font-medium tabular-nums text-ink" aria-live="polite">
                  {payload.totals[status]}
                </div>
              </div>
            ))}
          </div>

          {payload.campuses.length === 0 && (
            <div className="rounded-2xl border border-line bg-paper p-6 text-sm text-muted">
              No campuses are available for this account yet.
            </div>
          )}

          {payload.campuses.map((campus) => (
            <section key={campus.unitId} className="rounded-2xl border border-line bg-paper/70">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-4 sm:px-5">
                <h3 className="text-[1.0625rem] font-medium text-ink">{campus.unitName}</h3>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                  {MONITORING_STATUSES.map((status) => (
                    <span key={status}>
                      {STATUS_LABELS[status]} {campus.totals[status]}
                    </span>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs tracking-[0.08em] text-muted uppercase">
                      <th scope="col" className="px-4 py-3 font-semibold sm:px-5">Module</th>
                      {MONITORING_STATUSES.map((status) => (
                        <th key={status} scope="col" className="px-3 py-3 font-semibold">
                          {STATUS_LABELS[status]}
                        </th>
                      ))}
                      <th scope="col" className="px-4 py-3 text-right font-semibold sm:px-5">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campus.modules.map((module) => (
                      <tr key={module.key} className="border-b border-line/70 last:border-b-0">
                        <th scope="row" className="px-4 py-3 font-medium text-ink sm:px-5">
                          {module.label}
                        </th>
                        {MONITORING_STATUSES.map((status) => {
                          const value = module.statuses[status];
                          return (
                            <td key={status} className="px-3 py-3 align-middle">
                              <div className="tabular-nums text-ink">{value}</div>
                              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-line/70">
                                <div
                                  className={`h-full rounded-full ${STATUS_BARS[status]}`}
                                  style={{ width: barWidth(value, module.total) }}
                                  aria-hidden="true"
                                />
                              </div>
                              <div className="mt-0.5 text-[0.6875rem] text-muted">{share(value, module.total)}</div>
                            </td>
                          );
                        })}
                        <td className="px-4 py-3 text-right font-medium tabular-nums text-ink sm:px-5">
                          {module.total}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
