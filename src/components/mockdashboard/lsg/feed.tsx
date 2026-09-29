"use client";

import type { MockState } from "@/lib/mockdashboard/db";
import { stamp } from "@/lib/mockdashboard/format";
import { Card } from "@/components/mockdashboard/card";

export function Feed({ state }: { state: MockState }) {
  const feed = [...state.announcements].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.at.localeCompare(a.at),
  );

  return (
    <Card title="From the USG" subtitle="Announcements and notices">
      {feed.length === 0 ? (
        <p className="text-sm text-slate-400">No announcements yet.</p>
      ) : (
        <ul className="space-y-4">
          {feed.map((a) => (
            <li key={a.id} className={`rounded-lg border p-4 ${a.pinned ? "border-amber-200 bg-amber-50/40" : "border-slate-200"}`}>
              {a.pinned && (
                <span className="mb-1.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                  Pinned
                </span>
              )}
              <p className="text-sm font-semibold text-slate-900">{a.title}</p>
              <p className="mt-1 text-sm text-slate-600">{a.body}</p>
              <p className="mt-2 text-[11px] text-slate-400">{a.by} · {stamp(a.at)}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}