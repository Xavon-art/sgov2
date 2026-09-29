"use client";

import type { MockState } from "@/lib/mockdashboard/db";
import { dateKey, todayKey } from "@/lib/mockdashboard/format";
import { Card } from "@/components/mockdashboard/card";
import { StatusBadge } from "@/components/mockdashboard/status-badge";

export function Calendar({ state }: { state: MockState }) {
  const today = todayKey();
  const completed: NonNullable<typeof state.events[0]>[] = [];
  const upcoming: NonNullable<typeof state.events[0]>[] = [];
  const needsAction: NonNullable<typeof state.events[0]>[] = [];

  for (const e of [...state.events].sort((a, b) => String(a.detail.date).localeCompare(String(b.detail.date)))) {
    const d = dateKey(String(e.detail.date ?? ""));
    if (e.status === "approved" && d >= today) upcoming.push(e);
    else if (e.status === "approved" && d < today) completed.push(e);
    else needsAction.push(e);
  }

  return (
    <div className="space-y-5">
      <Card title="Upcoming events" subtitle="Approved and on the calendar">
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted">No approved upcoming events.</p>
        ) : (
          <EventGrid events={upcoming} />
        )}
      </Card>

      <Card title="Needs action" subtitle="Pending, in review, or returned events">
        {needsAction.length === 0 ? (
          <p className="text-sm text-muted">All filed events have been resolved.</p>
        ) : (
          <EventGrid events={needsAction} />
        )}
      </Card>

      <Card title="Completed" subtitle="Past events">
        {completed.length === 0 ? (
          <p className="text-sm text-muted">No completed events on record.</p>
        ) : (
          <EventGrid events={completed} />
        )}
      </Card>
    </div>
  );
}

function EventGrid({ events }: { events: Array<{ id: string; title: string; status: "pending" | "in_review" | "approved" | "returned"; filedBy: string; detail: Record<string, unknown> }> }) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {events.map((e) => {
        const d = e.detail as { date?: string; venue?: string; plannedAttendees?: number; budgetUse?: string };
        return (
          <li key={e.id} className="rounded-lg border border-line p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-ink-deep">{e.title}</p>
              <StatusBadge status={e.status} />
            </div>
            <dl className="mt-2 space-y-1 text-xs text-muted">
              <div className="flex justify-between"><dt>Date</dt><dd className="font-medium text-ink">{d.date ?? "TBA"}</dd></div>
              <div className="flex justify-between"><dt>Venue</dt><dd className="font-medium text-ink">{d.venue ?? "—"}</dd></div>
              <div className="flex justify-between"><dt>Attendees</dt><dd className="font-medium text-ink">{String(d.plannedAttendees ?? "—")}</dd></div>
            </dl>
            <p className="mt-2 text-[11px] text-muted">Filing council · {e.filedBy}</p>
          </li>
        );
      })}
    </ul>
  );
}