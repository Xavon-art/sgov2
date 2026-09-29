"use client";

import type { MockState } from "@/lib/mockdashboard/db";
import { Card } from "@/components/mockdashboard/card";

export function OrgChart({ state }: { state: MockState }) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card title="USG" subtitle="University Student Government">
        <div className="space-y-3">
          {state.units.map((u, i) => (
            <div key={u.id} className={`rounded-lg border border-slate-200 p-3 ${i === 0 ? "bg-indigo-50/40" : ""}`}>
              <p className="text-sm font-medium text-slate-900">{u.name}</p>
              <p className="text-xs text-slate-500">Lead · {u.lead}</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {u.officers.map((o) => (
                  <span key={o} className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600 ring-1 ring-inset ring-slate-200">
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
            <div key={c.id} className="rounded-lg border border-emerald-200 bg-emerald-50/30 p-3">
              <p className="text-sm font-semibold text-slate-900">{c.name}</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {c.officers.map((o) => (
                  <span key={o} className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600 ring-1 ring-inset ring-slate-200">
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