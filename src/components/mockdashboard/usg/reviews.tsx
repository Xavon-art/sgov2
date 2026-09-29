"use client";

import { useMemo, useState } from "react";
import type { Item, MockState } from "@/lib/mockdashboard/db";
import type { Action, ItemKind } from "@/lib/mockdashboard/types";
import { day, peso } from "@/lib/mockdashboard/format";
import { Card } from "@/components/mockdashboard/card";
import { Button } from "@/components/mockdashboard/button";
import { Modal } from "@/components/mockdashboard/modal";
import { StatusBadge } from "@/components/mockdashboard/status-badge";
import { Timeline } from "@/components/mockdashboard/timeline";
import { Field, inputCls } from "@/components/mockdashboard/field";

type Actions = {
  review: (kind: ItemKind, id: string, action: Action, comment: string, byLabel: string, byName: string) => void;
};

const kindInfo: Record<ItemKind, { label: string; chip: string }> = {
  proposal: { label: "Proposal", chip: "bg-brass-soft/50 text-brass-deep" },
  event: { label: "Event", chip: "bg-ink/[0.07] text-ink" },
  budget: { label: "Budget", chip: "border border-line bg-paper text-ink-soft" },
};

const kindPlural: Record<ItemKind, keyof MockState> = {
  proposal: "proposals",
  event: "events",
  budget: "budgets",
};

export function Reviews({ state, actions }: { state: MockState; actions: Actions }) {
  const [kind, setKind] = useState<ItemKind>("proposal");
  const [selected, setSelected] = useState<{ kind: ItemKind; id: string } | null>(null);
  const [comment, setComment] = useState("");

  const list = (state[kindPlural[kind]] as Item<ItemKind>[]).slice().sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );

  const open = useMemo(
    () =>
      selected
        ? (state[kindPlural[selected.kind]] as Item<ItemKind>[]).find((i) => i.id === selected.id) ?? null
        : null,
    [selected, state],
  );

  const counts = useMemo(
    () =>
      (["proposal", "event", "budget"] as ItemKind[]).map((k) => ({
        kind: k,
        n: (state[kindPlural[k]] as Item<ItemKind>[]).filter((i) => i.status === "in_review" || i.status === "pending").length,
      })),
    [state],
  );

  const detailFields = (i: Item<ItemKind>) => {
    const d = i.detail as Record<string, unknown>;
    if (i.kind === "event") {
      return [
        ["Date", String(d.date ?? "TBA")],
        ["Venue", String(d.venue ?? "—")],
        ["Expected attendees", String(d.plannedAttendees ?? "—")],
      ];
    }
    if (i.kind === "budget") {
      return [
        ["Amount", peso(Number(d.amount ?? 0))],
        ["Spent so far", peso(Number(d.spent ?? 0))],
        ["Purpose", String(d.purpose ?? "—")],
      ];
    }
    return [
      ["Description", String(d.description ?? "—")],
      ["Attachments", String((d.docs as string[])?.join(", ") || "—")],
    ];
  };

  return (
    <Card
      title="Review inbox"
      subtitle="Open a submission to start its review, then approve or return it."
    >
      <div className="mb-4 flex items-center gap-1">
        {(Object.keys(kindInfo) as ItemKind[]).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              kind === k ? "bg-ink text-canvas" : "bg-ink/[0.05] text-ink-soft hover:bg-line"
            }`}
          >
            {kindInfo[k].label}
            <span className="ml-1 opacity-70">{counts.find((c) => c.kind === k)?.n ?? 0}</span>
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">Nothing filed yet in this category.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {list.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${kindInfo[i.kind].chip}`}>
                    {kindInfo[i.kind].label}
                  </span>
                  <p className="truncate text-sm font-medium text-ink-deep">{i.title}</p>
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  {i.filedBy} · filed {day(i.createdAt)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusBadge status={i.status} />
                <Button variant="secondary" onClick={() => { setSelected({ kind: i.kind, id: i.id }); setComment(""); }}>
                  Review
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={!!open}
        onClose={() => setSelected(null)}
        title={open ? open.title : ""}
        width="max-w-xl"
      >
        {open && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className={`rounded px-1.5 py-0.5 font-semibold ${kindInfo[open.kind].chip}`}>
                {kindInfo[open.kind].label}
              </span>
              <StatusBadge status={open.status} />
              <span>Filed by {open.filedBy}</span>
              <span>· {open.filedByEmail}</span>
            </div>

            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {detailFields(open).map(([k, v]) => (
                <div key={k} className="rounded-lg bg-canvas-sunk px-3 py-2">
                  <dt className="text-[11px] font-medium text-muted">{k}</dt>
                  <dd className="text-sm text-ink">{v}</dd>
                </div>
              ))}
            </dl>

            {open.review && (
              <div className="rounded-lg border border-line bg-canvas-sunk px-3 py-2">
                <p className="text-[11px] font-medium text-muted">
                  Last decision · {open.review.decidedBy}
                </p>
                <p className="mt-0.5 text-sm text-ink">{open.review.comment || "No comment."}</p>
              </div>
            )}

            <div>
              <h4 className="mb-2 text-xs font-semibold text-muted">Status history</h4>
              <Timeline entries={open.timeline} />
            </div>

            <div className="border-t border-line/70 pt-4">
              {open.status === "pending" && (
                <Button
                  onClick={() => {
                    actions.review(open.kind, open.id, "start_review", "", "USG Office", "USG");
                    setSelected(null);
                  }}
                >
                  Start review
                </Button>
              )}
              {open.status === "in_review" && (
                <div className="space-y-3">
                  <Field label="Comment for the filing council (required for a return)">
                    <textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      rows={3}
                      placeholder="Notes or reason…"
                      className={inputCls}
                    />
                  </Field>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="danger"
                      onClick={() => {
                        actions.review(open.kind, open.id, "return", comment || "Returned with a comment", "USG Office", "USG");
                        setSelected(null);
                      }}
                    >
                      Return
                    </Button>
                    <Button
                      variant="emerald"
                      onClick={() => {
                        actions.review(open.kind, open.id, "approve", comment || "Approved", "USG Office", "USG");
                        setSelected(null);
                      }}
                    >
                      Approve
                    </Button>
                  </div>
                </div>
              )}
              {open.status === "returned" && (
                <p className="text-sm text-muted">
                  Waiting for the council to address the comment and resubmit.
                </p>
              )}
              {open.status === "approved" && (
                <p className="text-sm text-brass-deep">Approved and on record.</p>
              )}
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}