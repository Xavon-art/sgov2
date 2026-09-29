"use client";

import type { MockState } from "@/lib/mockdashboard/db";
import { Card } from "@/components/mockdashboard/card";

export function OrgChart({ state }: { state: MockState }) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card title="USG" subtitle="University Student Government">
        <div className="space-y-3">
          {state.units.map((u, i) => (
            <div key={u.id} className={`rounded-lg border border-line p-3 ${i === 0 ? "bg-brass-soft/25" : ""}`}>
              <p className="text-sm font-medium text-ink-deep">{u.name}</p>
              <p className="text-xs text-muted">Lead · {u.lead}</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {u.officers.map((o) => (
                  <span key={o} className="rounded-full bg-paper px-2 py-0.5 text-[11px] text-ink-soft ring-1 ring-inset ring-line">
                    {o}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="LSG councils" subtitle="Local councils reporting to the USG">
        <div className="space-y-3">
          {state.councils.map((c) => (
            <div key={c.id} className="rounded-lg border border-line bg-paper/80 p-3">
              <p className="text-sm font-semibold text-ink-deep">{c.name}</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {c.officers.map((o) => (
                  <span key={o} className="rounded-full bg-paper px-2 py-0.5 text-[11px] text-ink-soft ring-1 ring-inset ring-line">
                    {o}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}