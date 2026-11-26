"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { IconPencil } from "@/components/ui/Icons";
import type { CalendarEvent } from "@/lib/feed";
import { normalizeStatus, statusLabel } from "@/lib/status";

function honorLabel(value: string | null | undefined): string {
  if (value === "honored") return "Honoured";
  if (value === "not_honored") return "Not honoured";
  return "Pending";
}

type CalendarDays = Record<string, CalendarEvent[]>;

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
}

function eventTitle(e: CalendarEvent): string {
  return e.title || "Untitled";
}

export function CalendarPanel({
  variant = "calendar",
  refreshKey = 0,
  onCreate,
}: {
  variant?: "calendar" | "future";
  refreshKey?: number;
  onCreate?: () => void;
}) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [days, setDays] = useState<CalendarDays>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/feed", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ month: `${month}-01`, days: 42 }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.message || "Could not load calendar.");
        if (!cancelled) setDays((json.days ?? {}) as CalendarDays);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load calendar.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [month, refreshKey]);

  const today = new Date().toISOString().slice(0, 10);
  const allEvents = useMemo(() => {
    const out: Array<CalendarEvent & { day: string }> = [];
    for (const [day, items] of Object.entries(days)) {
      for (const item of items) {
        out.push({ ...item, day: item.date || day });
      }
    }
    out.sort((a, b) => `${a.day} ${a.time ?? ""}`.localeCompare(`${b.day} ${b.time ?? ""}`));
    return out;
  }, [days]);

  const upcoming = allEvents.filter((e) => e.day >= today);
  const past = [...allEvents.filter((e) => e.day < today)].reverse();

  const daysInMonth = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    return new Date(y, m, 0).getDate();
  }, [month]);
  const firstWeekday = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    return new Date(y, m - 1, 1).getDay();
  }, [month]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-xl border border-line px-3 py-1.5 text-sm"
          aria-label="Calendar month"
        />
        <span className="text-sm text-muted">{monthLabel(month)}</span>
        {variant === "future" && onCreate && (
          <Button size="sm" className="ml-auto" onClick={onCreate}>
            <IconPencil className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            Add future event
          </Button>
        )}
      </div>

      {loading && <p className="text-muted">Loading…</p>}
      {error && <p className="text-sm text-[#a5442c]">{error}</p>}

      {!loading && variant === "calendar" && (
        <div className="rounded-2xl border border-line bg-paper p-4">
          <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-7 gap-1">
            {Array.from({ length: firstWeekday }).map((_, i) => (
              <div key={`pad-${i}`} />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dateStr = `${month}-${String(day).padStart(2, "0")}`;
              const dayEvents = days[dateStr] ?? [];
              return (
                <div key={day} className="min-h-[4rem] rounded-lg border border-line p-1 text-xs">
                  <div className="font-medium text-muted">{day}</div>
                  {dayEvents.map((e, idx) => (
                    <div
                      key={`${e.itemId ?? e.id}-${idx}`}
                      className="mt-0.5 truncate rounded bg-brass-soft/40 px-1 text-[0.65rem] text-ink"
                      title={`${eventTitle(e)}${e.source ? ` (${e.source})` : ""}`}
                    >
                      {eventTitle(e)}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-line bg-paper p-4">
            <h2 className="mb-2 text-sm font-medium uppercase tracking-[0.18em] text-muted">Upcoming</h2>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted">No upcoming items.</p>
            ) : (
              <ul className="grid gap-2">
                {upcoming.map((e, idx) => (
                  <li key={`up-${e.itemId ?? e.id}-${idx}`} className="rounded-xl border border-line p-3 text-sm">
                    <div className="font-medium text-ink">{eventTitle(e)}</div>
                    <div className="text-xs text-muted">
                      {e.day}
                      {e.time ? ` ${e.time}` : ""}
                      {e.timezone ? ` (${e.timezone})` : ""}
                      {e.venue ? ` • ${e.venue}` : ""}
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      Source: {e.source ?? "event"}
                      {e.status ? ` • Status: ${statusLabel(normalizeStatus(e.status))}` : ""}
                      {e.honorStatus ? ` • Honour: ${honorLabel(e.honorStatus)}` : ""}
                      {e.unitName ? ` • ${e.unitName}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-line bg-paper p-4">
            <h2 className="mb-2 text-sm font-medium uppercase tracking-[0.18em] text-muted">Past</h2>
            {past.length === 0 ? (
              <p className="text-sm text-muted">No past items.</p>
            ) : (
              <ul className="grid gap-2">
                {past.map((e, idx) => (
                  <li key={`past-${e.itemId ?? e.id}-${idx}`} className="rounded-xl border border-line p-3 text-sm">
                    <div className="font-medium text-ink">{eventTitle(e)}</div>
                    <div className="text-xs text-muted">
                      {e.day}
                      {e.time ? ` ${e.time}` : ""}
                      {e.venue ? ` • ${e.venue}` : ""}
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      Source: {e.source ?? "event"}
                      {e.status ? ` • Status: ${statusLabel(normalizeStatus(e.status))}` : ""}
                      {e.honorStatus ? ` • Honour: ${honorLabel(e.honorStatus)}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
