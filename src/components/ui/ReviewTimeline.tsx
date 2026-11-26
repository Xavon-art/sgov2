"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type TimelineEvent = {
  id: string;
  stage: string;
  status: string | null;
  note: string;
  actorName: string;
  createdAt: string;
};

const stageLabel: Record<string, string> = {
  assigned: "Assigned",
  draft: "Draft saved",
  submitted: "Submitted for review",
  under_review: "Under review",
  decision: "Decision",
};

function fmt(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function ReviewTimeline({
  taskId,
  unitId,
  refreshKey = 0,
  className,
}: {
  taskId: string;
  unitId: string;
  refreshKey?: number;
  className?: string;
}) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!taskId || !unitId) {
      setEvents([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/tasks/timeline?taskId=${encodeURIComponent(taskId)}&unitId=${encodeURIComponent(unitId)}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as { ok?: boolean; events?: TimelineEvent[]; message?: string };
      if (!res.ok || !data.ok) {
        setError(data.message || "We could not load the timeline.");
        return;
      }
      setEvents(data.events ?? []);
    } catch {
      setError("We could not load the timeline.");
    } finally {
      setLoading(false);
    }
  }, [taskId, unitId]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    return () => {
      active = false;
    };
  }, [load, refreshKey]);

  return (
    <section className={cn("rounded-2xl border border-line bg-paper/70 p-5", className)}>
      <h3 className="text-sm font-semibold tracking-[0.12em] text-ink-soft uppercase">Timeline</h3>
      {error ? <p className="mt-3 text-sm text-[#a5442c]">{error}</p> : null}
      {loading ? <p className="mt-3 text-sm text-muted">Loading timeline…</p> : null}
      {!loading && !error && events.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No activity yet.</p>
      ) : null}
      {!loading && events.length > 0 ? (
        <ol className="mt-4 space-y-3">
          {events.map((event, index) => (
            <li key={event.id} className="relative flex gap-3 pl-1">
              <div className="flex flex-col items-center pt-1">
                <span
                  className={cn(
                    "size-2.5 rounded-full border",
                    index === events.length - 1 ? "border-brass bg-brass" : "border-line-strong bg-canvas",
                  )}
                />
                {index < events.length - 1 ? <span className="mt-1 h-full w-px bg-line" /> : null}
              </div>
              <div className="min-w-0 flex-1 pb-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-sm font-medium text-ink">
                    {stageLabel[event.stage] || event.stage}
                    {event.status && event.stage === "decision" ? ` · ${event.status}` : ""}
                  </p>
                  <span className="text-xs text-muted">{fmt(event.createdAt)}</span>
                </div>
                <p className="text-xs text-muted">{event.actorName || "System"}</p>
                {event.note ? <p className="mt-1 text-sm text-ink-soft">{event.note}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
