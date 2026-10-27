"use client";

import { useEffect, useState } from "react";

type Entry = {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: unknown;
  createdAt: string;
  actorId: string | null;
};

export function AuditLogSection() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/audit-log?limit=100");
        const data = await res.json();
        if (!cancelled && res.ok && data.ok) setEntries(data.entries ?? []);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p className="text-[0.875rem] text-muted">Loading audit log…</p>;

  return (
    <section className="rounded-2xl border border-line bg-paper/70 p-6">
      <p className="eyebrow">Activity & audit log</p>
      {entries.length === 0 ? (
        <p className="mt-3 text-[0.875rem] text-muted">No activity yet.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {entries.map((e) => (
            <li key={e.id} className="rounded-xl border border-line bg-paper px-4 py-2">
              <p className="text-[0.875rem] font-medium text-ink-deep">{e.action}</p>
              <p className="text-[0.75rem] text-muted">
                {e.targetType ? `${e.targetType} · ` : ""}
                {new Date(e.createdAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}