"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProgramRow, ProposalsListRow, RequirementItem, ItemKind } from "./types";
import { formatDate, statusLabel } from "./helpers";
import { ActivityIcon } from "./ActivityIcon";
import { ProposalForm } from "./ProposalForm";
import { ProposalDetailFlow } from "./ProposalDetailFlow";
import { Button } from "@/components/ui/Button";

type TemplateItem = { itemId: string; label: string; itemKind: ItemKind };
type Draft = {
  programId: string | null;
  programName: string;
  template: TemplateItem[];
  unitId: string | null;
};

/**
 * The invited-officer view: browse the programs the USG publishes, draft against
 * a program's template (or the standalone default), and track their unit's
 * submissions through review.
 */
export function LsgShell() {
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [defaults, setDefaults] = useState<RequirementItem[]>([]);
  const [proposals, setProposals] = useState<ProposalsListRow[]>([]);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [openRow, setOpenRow] = useState<ProposalsListRow | null>(null);

  const load = useCallback(async () => {
    const [a, b, c, d] = await Promise.all([
      fetch("/api/programs"),
      fetch("/api/proposals"),
      fetch("/api/requirements/default"),
      fetch("/api/my-unit"),
    ]);
    const pd = (await a.json()) as { ok: boolean; programs?: ProgramRow[] };
    const pl = (await b.json()) as { ok: boolean; proposals?: ProposalsListRow[] };
    const df = (await c.json()) as { ok: boolean; items?: RequirementItem[] };
    const mu = (await d.json()) as { ok: boolean; unitId?: string | null };
    return {
      programs: pd.ok && pd.programs ? pd.programs : [],
      proposals: pl.ok && pl.proposals ? pl.proposals : [],
      defaults: df.ok && Array.isArray(df.items) ? df.items : [],
      unitId: mu.ok ? (mu.unitId ?? null) : null,
    };
  }, []);

  const reload = useCallback(async () => {
    const d = await load();
    setPrograms(d.programs);
    setProposals(d.proposals);
    setDefaults(d.defaults);
    setUnitId(d.unitId);
  }, [load]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const d = await load();
      if (!alive) return;
      setPrograms(d.programs);
      setProposals(d.proposals);
      setDefaults(d.defaults);
      setUnitId(d.unitId);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  if (loading)
    return <p role="status" className="text-[0.875rem] text-body">Loading your workspace…</p>;

  if (draft) {
    return (
      <ProposalForm
        heading={`New activity — ${draft.programName}`}
        template={draft.template}
        programId={draft.programId}
        unitId={draft.unitId}
        onDone={() => {
          setDraft(null);
          void reload();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-line bg-paper/70 p-6">
        <p className="eyebrow">Programs you can submit to</p>
        {programs.length === 0 ? (
          <p className="mt-3 text-[0.875rem] text-body">
            No programs are open yet. Standalone activities below still work if the
            USG saved a default template.
          </p>
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {programs.map((p) => (
              <li key={p.id} className="rounded-xl border border-line/70 bg-canvas/40 p-4">
                <div className="flex items-center gap-2.5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brass-soft/40">
                    <ActivityIcon type={p.icon} className="h-3.5 w-3.5 text-brass-deep" />
                  </span>
                  <p className="truncate text-[0.9375rem] font-medium text-ink">{p.name}</p>
                </div>
                <p className="mt-2 min-h-10 text-[0.8125rem] leading-relaxed text-body">
                  {p.description}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {p.items.map((it) => (
                    <span
                      key={it.id}
                      className="rounded-full border border-line bg-paper/70 px-2.5 py-0.5 text-[0.6875rem] text-ink-soft"
                    >
                      {it.label}
                    </span>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="paper"
                  className="mt-4"
                  onClick={() =>
                    setDraft({
                      programId: p.id,
                      programName: p.name,
                      unitId,
                      template: p.items.map((it) => ({
                        itemId: it.id,
                        label: it.label,
                        itemKind: it.itemKind,
                      })),
                    })
                  }
                >
                  Submit to this program
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-paper/70 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="eyebrow">Standalone activity</p>
          {defaults.length > 0 ? (
            <Button
              size="sm"
              variant="paper"
              onClick={() =>
                setDraft({
                  programId: null,
                  programName: "Standalone activity",
                  unitId,
                  template: defaults.map((it) => ({
                    itemId: it.id,
                    label: it.label,
                    itemKind: it.itemKind,
                  })),
                })
              }
            >
              Draft standalone
            </Button>
          ) : (
            <span className="text-[0.75rem] text-muted">
              No default template saved by the USG yet
            </span>
          )}
        </div>
        {defaults.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {defaults.map((it) => (
              <span
                key={it.id}
                className="rounded-full border border-line bg-canvas/40 px-2.5 py-0.5 text-[0.6875rem] text-ink-soft"
              >
                {it.label}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[0.8125rem] text-body">
            Activities not tied to a program use this template. Nothing is set yet.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-paper/70 p-6">
        <p className="eyebrow">My submissions</p>
        {openRow ? (
          <div className="mt-4">
            <ProposalDetailFlow
              row={openRow}
              onChanged={reload}
              onClose={() => setOpenRow(null)}
            />
          </div>
        ) : proposals.length === 0 ? (
          <p className="mt-3 text-[0.875rem] text-body">
            Nothing submitted yet. Draft a proposal above.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {proposals.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-line/70 bg-canvas/40 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.9375rem] font-medium text-ink">{p.title}</p>
                  <p className="mt-0.5 truncate text-[0.75rem] text-muted">
                    {p.programName ?? "Standalone"}
                    {p.latestRemark ? ` — ${p.latestRemark}` : ""}
                  </p>
                </div>
                <span className="text-[0.75rem] text-muted">v{p.version}</span>
                <span className="hidden text-[0.75rem] text-muted sm:inline">
                  {formatDate(p.createdAt)}
                </span>
                <span className="rounded-full bg-brass-soft/45 px-2.5 py-1 text-[0.6875rem] font-semibold tracking-[0.06em] text-brass-deep uppercase">
                  {statusLabel(p.status)}
                </span>
                <Button size="sm" variant="paper" onClick={() => setOpenRow(p)}>
                  Track
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}