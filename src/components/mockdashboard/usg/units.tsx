"use client";

import { useState } from "react";
import type { MockState } from "@/lib/mockdashboard/db";
import { Card } from "@/components/mockdashboard/card";
import { Button } from "@/components/mockdashboard/button";
import { inputCls } from "@/components/mockdashboard/field";

type Actions = {
  addOfficer: (unitId: string, name: string) => void;
  addCouncilOfficer: (councilId: string, name: string) => void;
};

export function Units({ state, actions }: { state: MockState; actions: Actions }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card title="USG units" subtitle="Standing committees of the university student government">
        <ul className="space-y-4">
          {state.units.map((u) => (
            <li key={u.id} className="rounded-lg border border-line p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-ink-deep">{u.name}</p>
                  <p className="text-xs text-muted">Unit lead · {u.lead}</p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {u.officers.map((o) => (
                  <span key={o} className="rounded-full bg-ink/[0.06] px-2 py-0.5 text-xs text-ink">
                    {o}
                  </span>
                ))}
              </div>
              <form
                className="mt-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = drafts[u.id]?.trim();
                  if (!v) return;
                  actions.addOfficer(u.id, v);
                  setDrafts((d) => ({ ...d, [u.id]: "" }));
                }}
              >
                <input
                  value={drafts[u.id] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [u.id]: e.target.value }))}
                  className={inputCls}
                  placeholder="Add an officer…"
                />
                <Button type="submit" variant="secondary" className="shrink-0">Add</Button>
              </form>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="LSG councils" subtitle="Local student councils under the USG">
        <ul className="space-y-4">
          {state.councils.map((c) => (
            <li key={c.id} className="rounded-lg border border-line p-4">
              <p className="text-sm font-semibold text-ink-deep">{c.name}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {c.officers.map((o) => (
                  <span key={o} className="rounded-full bg-brass-soft/45 px-2 py-0.5 text-xs text-brass-deep">
                    {o}
                  </span>
                ))}
              </div>
              <form
                className="mt-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = drafts[c.id]?.trim();
                  if (!v) return;
                  actions.addCouncilOfficer(c.id, v);
                  setDrafts((d) => ({ ...d, [c.id]: "" }));
                }}
              >
                <input
                  value={drafts[c.id] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                  className={inputCls}
                  placeholder="Add a council officer…"
                />
                <Button type="submit" variant="secondary" className="shrink-0">Add</Button>
              </form>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}