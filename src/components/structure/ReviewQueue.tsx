"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Reveal } from "@/components/fx/Reveal";
import {
  fetchQueue,
  fetchRoster,
  reviewStructure,
  structureError,
  type QueuePayload,
  type RosterMember,
  type RosterPayload,
  type StructureDocument,
  type StructureSummary,
} from "@/lib/structure";

/**
 * The reviewer's side: what is waiting, what has been decided, and the two
 * people who can send each back and forth.
 *
 * The queue is one `list_structure_queue` call. Every entry in it has already
 * been filtered by `reviewable`, which the database computes from the caller's
 * own seats -- a reviewer does not see, and cannot act on, a structure they are
 * not entitled to decide, and this component never re-derives that.
 */

type Busy = { kind: "idle" } | { kind: "working"; id: string } | { kind: "error"; message: string };

function DocumentPreview({ document }: { document: StructureDocument }) {
  return (
    <ul className="mt-3 flex flex-col gap-2">
      {document.committees.map((c) => (
        <li key={c.key} className="rounded-xl border border-line bg-canvas/40 p-3">
          <p className="text-[0.875rem] font-medium text-ink-deep">{c.name}</p>
          <p className="mt-1 text-[0.75rem] tracking-[0.08em] text-muted uppercase">
            {c.positions.length} positions
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {c.positions.map((p) => (
              <li
                key={p.key}
                className="rounded-full border border-line bg-paper/70 px-2.5 py-1 text-[0.75rem] text-ink-soft"
              >
                {p.title}
                {p.holder ? "" : " (vacant)"}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function DecisionForm({
  structure,
  busy,
  onDecide,
}: {
  structure: StructureSummary;
  busy: Busy;
  onDecide: (decision: "approved" | "returned" | "rejected", remark?: string) => void;
}) {
  const [remark, setRemark] = useState("");
  const working = busy.kind === "working" && busy.id === structure.id;

  // A rejection with no reason and a return with no note are both hard to
  // interpret later, so they are nudged rather than blocked.
  const needRemark = (decision: string) =>
    (decision === "rejected" || decision === "returned") && !remark.trim();

  return (
    <div className="mt-4 rounded-xl border border-line bg-paper/60 p-4">
      <label className="block">
        <span className="mb-1.5 flex items-baseline justify-between gap-3">
          <span className="text-[0.75rem] font-semibold tracking-[0.08em] text-ink-soft uppercase">
            Remark
          </span>
          <span className="text-[0.6875rem] text-muted">required to return or reject</span>
        </span>
        <input
          className="h-11 w-full rounded-xl border border-line bg-paper px-3.5 text-[0.9375rem] text-ink-deep outline-none transition-colors placeholder:text-muted focus:border-line-strong"
          value={remark}
          placeholder="What should the author change?"
          onChange={(e) => setRemark(e.target.value)}
        />
      </label>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={working}
          onClick={() => onDecide("approved", remark.trim() || undefined)}
        >
          Approve
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={working || needRemark("returned")}
          title={needRemark("returned") ? "A return needs a remark" : undefined}
          onClick={() => onDecide("returned", remark.trim())}
        >
          Return to author
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={working || needRemark("rejected")}
          title={needRemark("rejected") ? "A rejection needs a remark" : undefined}
          onClick={() => onDecide("rejected", remark.trim())}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}

function Entry({
  structure,
  busy,
  onDecide,
  onRenew,
}: {
  structure: StructureSummary;
  busy: Busy;
  onDecide: (structureId: string, decision: "approved" | "returned" | "rejected", remark?: string) => void;
  onRenew?: (structure: StructureSummary) => void;
}) {
  const [showRoster, setShowRoster] = useState(false);
  const [roster, setRoster] = useState<RosterPayload | null>(null);
  const canReview = structure.reviewable === true;

  const holders = useMemo(
    () =>
      structure.document.committees.flatMap((c) =>
        c.positions.filter((p) => p.holder).map((p) => ({ title: p.title, email: p.holder!.email })),
      ),
    [structure.document],
  );

  async function toggleRoster() {
    if (showRoster) {
      setShowRoster(false);
      return;
    }
    setShowRoster(true);
    if (!roster) setRoster(await fetchRoster(structure.unitId));
  }

  return (
    <article className="rounded-2xl border border-line bg-paper/70 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[1.0625rem] leading-snug text-ink-deep">
            {structure.unitName ?? "Structure"}
          </h3>
          <p className="mt-1 text-[0.8125rem] text-muted">
            {structure.termLabel} &middot; revision {structure.revision}
            {structure.authorKind === "usg" ? " \u00b7 filed by the USG" : ""}
          </p>
        </div>
        <StatusBadge status={structure.status} />
      </div>

      {structure.note ? (
        <p className="mt-3 rounded-xl border border-line bg-canvas/40 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-body">
          {structure.note}
        </p>
      ) : null}

      {structure.decisionRemark ? (
        <p className="mt-3 rounded-xl border border-[#a3702a]/35 bg-[#a3702a]/[0.07] px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-[#8a5f22]">
          Reviewer: {structure.decisionRemark}
        </p>
      ) : null}

      <DocumentPreview document={structure.document} />

      {structure.renewsTermLabel ? (
        <p className="mt-3 text-[0.8125rem] text-muted">Renews {structure.renewsTermLabel}.</p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => void toggleRoster()}>
          {showRoster ? "Hide roster" : "Roster for this council"}
        </Button>
        {onRenew && structure.status === "approved" ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onRenew(structure)}>
            Renew
          </Button>
        ) : null}
      </div>

      {showRoster ? (
        <RosterPanel payload={roster} members={holders.map((h) => h.email)} />
      ) : null}

      {canReview && structure.status === "under_review" ? (
        <DecisionForm
          structure={structure}
          busy={busy}
          onDecide={(decision, remark) => onDecide(structure.id, decision, remark)}
        />
      ) : null}
    </article>
  );
}

/**
 * Who can be named in this document, from the roll the builder itself is
 * scoped to.
 *
 * A reviewer gets the organization roll; an officer gets their own subtree. The
 * scope is the database's, which is why this does not filter it further.
 */
function RosterPanel({ payload, members }: { payload: RosterPayload | null; members: string[] }) {
  const named = new Set(members);

  if (!payload) return <p className="mt-3 text-[0.875rem] text-muted">Loading the roll&hellip;</p>;
  if (!payload.ok) return <p className="mt-3 text-[0.8125rem] text-[#8c3126]">{structureError(payload)}</p>;

  const roster: RosterMember[] = payload.roster ?? [];
  if (!roster.length) return <p className="mt-3 text-[0.875rem] text-muted">Nobody is on the roll yet.</p>;

  return (
    <div className="mt-3">
      <p className="text-[0.6875rem] tracking-[0.08em] text-muted uppercase">
        Roll &middot; {payload.scope} &middot; {roster.length} people
      </p>
      <ul className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-line">
        {roster.map((m) => (
          <li
            key={m.rosterId}
            className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line/60 px-3.5 py-2 last:border-b-0"
          >
            <span className="min-w-0 text-[0.8125rem] text-ink-deep">
              <span className="block truncate">{m.fullName}</span>
              <span className="block truncate text-[0.75rem] text-muted">{m.email}</span>
            </span>
            {named.has(m.email.toLowerCase()) ? (
              <span className="rounded-full border border-[#2f6d4f]/35 bg-[#2f6d4f]/[0.08] px-2 py-0.5 text-[0.625rem] font-semibold tracking-[0.1em] text-[#255639] uppercase">
                Named here
              </span>
            ) : (
              <span className="text-[0.6875rem] text-muted">
                {m.seats.length ? m.seats.map((s) => s.unitName).join(", ") : "no seat"}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ReviewQueue({ onRenewed }: { onRenewed?: () => void }) {
  const [queue, setQueue] = useState<QueuePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>({ kind: "idle" });
  const [flash, setFlash] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "mine" | "decided">("pending");

  const [reload, setReload] = useState(0);

  // The fetch is the effect's job and `setState` happens in its own `.then`, not
  // synchronously in the effect body: `reload` is the dependency, and bumping it
  // after a decision is what re-reads the queue.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetchQueue();
      if (cancelled) return;
      if (!res.ok) {
        setError(structureError(res));
        setQueue(null);
        return;
      }
      setError(null);
      setQueue(res);
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  async function onDecide(
    structureId: string,
    decision: "approved" | "returned" | "rejected",
    remark?: string,
  ) {
    setBusy({ kind: "working", id: structureId });
    try {
      const res = await reviewStructure(structureId, decision, remark);
      setBusy({ kind: "idle" });
      if (!res.ok) {
        setBusy({ kind: "error", message: structureError(res) });
        return;
      }
      setFlash(
        decision === "approved"
          ? "Approved. The structure is now published."
          : decision === "returned"
            ? "Returned to the author."
            : "Rejected.",
      );
      setReload((n) => n + 1);
      onRenewed?.();
    } catch (e) {
      setBusy({
        kind: "error",
        message: e instanceof Error ? e.message : "We could not reach the server.",
      });
    }
  }

  const pending = queue?.pending ?? [];
  const drafts = queue?.drafts ?? [];
  const decided = queue?.decided ?? [];

  const shown =
    filter === "pending" ? pending : filter === "mine" ? drafts : decided;

  const tabs = [
    { key: "pending" as const, label: `Waiting on you`, count: pending.length },
    { key: "mine" as const, label: "In progress", count: drafts.length },
    { key: "decided" as const, label: "Decided", count: decided.length },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setFilter(t.key)}
            className={`h-9 cursor-pointer rounded-full border px-3.5 text-[0.8125rem] font-medium transition-colors ${
              filter === t.key
                ? "border-ink bg-ink text-white"
                : "border-line bg-paper text-ink-soft hover:border-line-strong hover:text-ink"
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-[0.6875rem] opacity-70">{t.count}</span>
          </button>
        ))}
      </div>

      {flash ? (
        <p className="rounded-xl border border-[#2f6d4f]/35 bg-[#2f6d4f]/[0.07] px-4 py-3 text-[0.875rem] text-[#255639]">
          {flash}
        </p>
      ) : null}
      {busy.kind === "error" ? (
        <p className="rounded-xl border border-[#a33a2e]/35 bg-[#a33a2e]/[0.07] px-4 py-3 text-[0.875rem] text-[#8c3126]">
          {busy.message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-xl border border-[#a33a2e]/35 bg-[#a33a2e]/[0.07] px-4 py-3 text-[0.875rem] text-[#8c3126]">
          {error}
        </p>
      ) : null}

      {!queue && !error ? (
        <p className="text-[0.875rem] text-muted">Loading the queue&hellip;</p>
      ) : null}

      {queue && !queue.isReviewer && filter === "pending" ? (
        <p className="rounded-xl border border-line bg-paper/60 px-4 py-3 text-[0.875rem] leading-relaxed text-body">
          You are not a reviewer, so nothing is waiting on you here.
        </p>
      ) : null}

      <div className="flex flex-col gap-4">
        {shown.map((entry, i) => (
          <Reveal key={entry.id} delay={Math.min(i * 0.02, 0.1)}>
            <Entry structure={entry} busy={busy} onDecide={onDecide} />
          </Reveal>
        ))}
      </div>

      {queue && shown.length === 0 ? (
        <p className="text-[0.875rem] text-muted">
          {filter === "pending"
            ? "Nothing is waiting on you."
            : filter === "mine"
              ? "You have no structure in progress."
              : "Nothing has been decided yet."}
        </p>
      ) : null}
    </div>
  );
}
