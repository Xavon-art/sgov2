"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Entry = {
  id: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  createdAt: string;
};

export default function DevOutboxPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Entry | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/dev/outbox");
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

  if (loading) return <p className="p-6 text-sm text-muted">Loading…</p>;

  return (
    <main className="mx-auto max-w-5xl px-5 py-10">
      <header data-tour="outbox-header" className="border-b border-line/80 pb-4">
        <p className="eyebrow">Dev only</p>
        <h1 className="mt-1 text-[1.5rem] leading-tight">Email outbox</h1>
        <p className="mt-1 text-[0.875rem] text-muted">
          Emails captured because SMTP is not configured. {entries.length} entr{entries.length === 1 ? "y" : "ies"}.
        </p>
        <Link href="/" className="mt-3 inline-block text-[0.8125rem] text-brass-deep underline">
          Back to home
        </Link>
      </header>

      <div className="mt-6 grid gap-6 md:grid-cols-[20rem_1fr]">
        <aside data-tour="outbox-list" className="flex flex-col gap-2">
          {entries.length === 0 ? (
            <p className="text-[0.875rem] text-muted">No emails yet.</p>
          ) : (
            entries.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => setSelected(e)}
                className={`flex flex-col gap-1 rounded-xl border px-3 py-2 text-left transition-colors ${
                  selected?.id === e.id ? "border-ink bg-ink/[0.04]" : "border-line bg-paper hover:bg-canvas"
                }`}
              >
                <span className="truncate text-[0.8125rem] font-medium text-ink-deep">{e.subject}</span>
                <span className="truncate text-[0.75rem] text-muted">{e.to}</span>
                <span className="text-[0.625rem] text-muted">{new Date(e.createdAt).toLocaleString()}</span>
              </button>
            ))
          )}
        </aside>
        <main data-tour="outbox-detail" className="min-h-[24rem] rounded-2xl border border-line bg-paper/70 p-4">
          {!selected ? (
            <p className="text-[0.875rem] text-muted">Select an email.</p>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-[0.9375rem] font-medium text-ink-deep">{selected.subject}</p>
              <p className="text-[0.75rem] text-muted">To: {selected.to}</p>
              <div className="prose max-w-none text-[0.875rem] text-body" dangerouslySetInnerHTML={{ __html: selected.html }} />
            </div>
          )}
        </main>
      </div>
    </main>
  );
}