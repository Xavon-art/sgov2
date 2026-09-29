"use client";

import { useMemo, useState } from "react";
import type { Item, MockState } from "@/lib/mockdashboard/db";
import type { ItemKind } from "@/lib/mockdashboard/types";
import { peso, day } from "@/lib/mockdashboard/format";
import { Card } from "@/components/mockdashboard/card";
import { Button } from "@/components/mockdashboard/button";
import { Modal } from "@/components/mockdashboard/modal";
import { KindChip } from "@/components/mockdashboard/kind-chip";
import { StatusBadge } from "@/components/mockdashboard/status-badge";
import { Timeline } from "@/components/mockdashboard/timeline";

const plural: Record<ItemKind, keyof MockState> = { proposal: "proposals", event: "events", budget: "budgets" };

export function MySubmissions({
  state,
  council,
  actions,
}: {
  state: MockState;
  council: string;
  actions: { review: (kind: ItemKind, id: string, action: "resubmit", comment: string, byLabel: string, byName: string) => void };
}) {
  const [kind, setKind] = useState<ItemKind>("proposal");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const list = useMemo(() => {
    const arr = state[plural[kind]] as Item<ItemKind>[];
    return arr
      .filter((i) => i.filedBy === council)
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [state, kind, council]);

  const selected = selectedId ? (state[plural[kind]] as Item<ItemKind>[]).find((i) => i.id === selectedId) ?? null : null;

  const counts = (["proposal", "event", "budget"] as ItemKind[]).map((k) => ({
    kind: k,
    n: (state[plural[k]] as Item<ItemKind>[]).filter((i) => i.filedBy === council).length,
  }));

  return (
    <Card title="My submissions" subtitle={`Everything ${council} has filed`}>
      <div className="mb-4 flex items-center gap-1">
        {(["proposal", "event", "budget"] as ItemKind[]).map((k) => (
          <button
            key={k}
            onClick={() => { setKind(k); setSelectedId(null); }}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              kind === k ? "bg-brass text-ink-deep" : "bg-ink/[0.05] text-ink-soft hover:bg-line"
            }`}
          >
            {k === "proposal" ? "Proposals" : k === "event" ? "Events" : "Budgets"}
            <span className="ml-1 opacity-70">{counts.find((c) => c.kind === k)?.n ?? 0}</span>
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">Nothing filed here yet. Use “File new” to submit.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {list.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <KindChip kind={i.kind} />
                  <p className="truncate text-sm font-medium text-ink-deep">{i.title}</p>
                </div>
                <p className="mt-0.5 text-xs text-muted">Filed {day(i.createdAt)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusBadge status={i.status} />
                <Button variant="secondary" onClick={() => setSelectedId(i.id)}>View</Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={!!selected} onClose={() => setSelectedId(null)} title={selected?.title ?? ""} width="max-w-xl">
        {selected && (
          <div className="space-y-5">
            <div className="flex items-center gap-2 text-xs text-muted">
              <KindChip kind={selected.kind} />
              <StatusBadge status={selected.status} />
              <span>Filed by {selected.filedBy}</span>
            </div>

            {selected.kind === "budget" && (
              <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-lg bg-canvas-sunk px-3 py-2">
                  <dt className="text-[11px] font-medium text-muted">Amount requested</dt>
                  <dd className="text-sm text-ink">{peso(Number((selected.detail as { amount?: number }).amount ?? 0))}</dd>
                </div>
                <div className="rounded-lg bg-canvas-sunk px-3 py-2">
                  <dt className="text-[11px] font-medium text-muted">Purpose</dt>
                  <dd className="text-sm text-ink">{String((selected.detail as { purpose?: string }).purpose ?? "—")}</dd>
                </div>
              </dl>
            )}
            {selected.kind === "event" && (
              <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(["date", "venue", "plannedAttendees"] as const).map((k) => (
                  <div key={k} className="rounded-lg bg-canvas-sunk px-3 py-2">
                    <dt className="text-[11px] font-medium text-muted">{k}</dt>
                    <dd className="text-sm text-ink">{String((selected.detail as Record<string, unknown>)[k] ?? "—")}</dd>
                  </div>
                ))}
              </dl>
            )}
            {selected.kind === "proposal" && (
              <div className="rounded-lg bg-canvas-sunk px-3 py-2">
                <p className="text-[11px] font-medium text-muted">Description</p>
                <p className="text-sm text-ink">{String((selected.detail as { description?: string }).description ?? "—")}</p>
              </div>
            )}

            {selected.review && (
              <div className="rounded-lg border border-line bg-canvas-sunk px-3 py-2">
                <p className="text-[11px] font-medium text-muted">Last decision · {selected.review.decidedBy}</p>
                <p className="mt-0.5 text-sm text-ink">{selected.review.comment || "No comment."}</p>
              </div>
            )}

            <div>
              <h4 className="mb-2 text-xs font-semibold text-muted">Status history</h4>
              <Timeline entries={selected.timeline} />
            </div>

            {selected.status === "returned" && (
              <div className="flex justify-end border-t border-line/70 pt-4">
                <ResubmitButton
                  onClick={() => {
                    actions.review(selected.kind, selected.id, "resubmit", "", council, "CCIS");
                    setSelectedId(null);
                  }}
                />
              </div>
            )}
          </div>
        )}
      </Modal>
    </Card>
  );
}

function ResubmitButton({ onClick }: { onClick: () => void }) {
  return (
    <Button onClick={onClick}>Resubmit with changes</Button>
  );
}