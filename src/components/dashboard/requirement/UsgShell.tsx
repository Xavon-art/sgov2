"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProgramRow, ProposalsListRow } from "./types";
import { ReviewInbox } from "./ReviewInbox";
import { ProgramForm } from "./ProgramForm";
import { TemplateEditor } from "./TemplateEditor";
import { ActivityIcon } from "./ActivityIcon";
import { CountUp } from "./CountUp";
import { Reveal } from "@/components/fx/Reveal";

export function UsgShell() {
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [proposals, setProposals] = useState<ProposalsListRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [p, q] = await Promise.all([
      (await fetch("/api/programs")).json(),
      (await fetch("/api/proposals")).json(),
    ]);
    return {
      programs: p.ok ? (p.programs as ProgramRow[]) : [],
      proposals: q.ok ? (q.proposals as ProposalsListRow[]) : [],
    };
  }, []);

  const reload = useCallback(async () => {
    const d = await load();
    setPrograms(d.programs);
    setProposals(d.proposals);
  }, [load]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const d = await load();
      if (!alive) return;
      setPrograms(d.programs);
      setProposals(d.proposals);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  const awaiting = proposals.filter(
    (x) => x.status === "submitted" || x.status === "under_review" || x.status === "returned",
  ).length;
  const publishedCount = proposals.filter((x) => x.status === "published").length;
  const ownPublished = proposals.filter((x) => x.authorKind === "usg");

  if (loading)
    return <p role="status" className="text-[0.875rem] text-body">Loading the workspace…</p>;

  return (
    <div className="space-y-6">
      <Reveal className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Awaiting review", value: awaiting, icon: "academic" },
          { label: "Published programs", value: programs.length, icon: "community" },
          { label: "Approved this term", value: publishedCount, icon: "wellness" },
        ].map((c) => (
          <div key={c.label} className="rounded-2xl border border-line bg-paper/70 p-5">
            <div className="flex items-center justify-between">
              <p className="eyebrow">{c.label}</p>
              <ActivityIcon type={c.icon as never} className="h-4 w-4 text-brass" />
            </div>
            <p className="mt-3 text-[2rem] font-semibold leading-none text-ink-deep">
              <CountUp value={c.value} />
            </p>
          </div>
        ))}
      </Reveal>

      <ReviewInbox proposals={proposals} onChanged={reload} />

      <div className="grid gap-6 xl:grid-cols-2">
        <ProgramForm programs={programs} onCreated={reload} />
        <TemplateEditor onSaved={reload} />
      </div>

      <section className="rounded-2xl border border-line bg-paper/70 p-6">
        <p className="eyebrow">Run by your office</p>
        {ownPublished.length === 0 ? (
          <p className="mt-3 text-[0.875rem] text-body">Nothing published yet.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {ownPublished.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-4 rounded-xl border border-line/70 px-4 py-3"
              >
                <span className="truncate text-[0.9375rem] font-medium text-ink">{p.title}</span>
                <span className="text-[0.75rem] font-semibold tracking-[0.08em] text-brass-deep uppercase">
                  Published
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}