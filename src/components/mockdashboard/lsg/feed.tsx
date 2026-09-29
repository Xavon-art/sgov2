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
        <p className="text-sm text-muted">No announcements yet.</p>
      ) : (
        <ul className="space-y-4">
          {feed.map((a) => (
            <li key={a.id} className={`rounded-lg border p-4 ${a.pinned ? "border-brass/45 bg-brass-soft/25" : "border-line"}`}>
              {a.pinned && (
                <span className="mb-1.5 inline-block rounded bg-brass-soft/60 px-1.5 py-0.5 text-[10px] font-semibold text-brass-deep">
                  Pinned
                </span>
              )}
              <p className="text-sm font-semibold text-ink-deep">{a.title}</p>
              <p className="mt-1 text-sm text-ink-soft">{a.body}</p>
              <p className="mt-2 text-[11px] text-muted">{a.by} · {stamp(a.at)}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}