"use client";

import { useEffect, useState } from "react";
import {
  activityClass,
  activityLabel,
  currentMonthIso,
  dayCellLabel,
  eventLabel,
  monthGrid,
  monthLabel,
  shiftMonth,
  todayIso,
  type CalendarDays,
  type FeedPost,
} from "@/lib/feed";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; posts: FeedPost[] };

type CalendarState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; days: CalendarDays };

const loadFeed = async () => {
  const res = await fetch("/api/feed");
  return { res, data: await res.json() };
};

const loadCalendar = async (month: string) => {
  const res = await fetch("/api/feed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ month, days: 42 }),
  });
  return { res, data: await res.json() };
};

/**
 * Announcements and the university calendar, for a caller who only ever receives
 * published work.
 *
 * The two live on one screen because an officer asks one question -- what is
 * happening and when -- and answering it meant two pages. The calendar is month to
 * month, and only days with something on them carry a marker, so an empty month is
 * visibly empty rather than a grid of dots.
 */
export default function FeedPage() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [month, setMonth] = useState(currentMonthIso());
  const [calendar, setCalendar] = useState<CalendarState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { res, data } = await loadFeed();
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setState({ kind: "error", message: data.message ?? "We could not load the feed." });
          return;
        }
        setState({ kind: "ready", posts: data.posts ?? [] });
      } catch {
        if (cancelled) return;
        setState({
          kind: "error",
          message: "We could not reach the server. Check your connection.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setCalendar({ kind: "loading" });
      try {
        const { res, data } = await loadCalendar(month);
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setCalendar({ kind: "error", message: data.message ?? "We could not load the calendar." });
          return;
        }
        setCalendar({ kind: "ready", days: data.days ?? {} });
      } catch {
        if (cancelled) return;
        setCalendar({
          kind: "error",
          message: "We could not reach the server. Check your connection.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [month]);

  const upcoming =
    state.kind === "ready"
      ? state.posts.filter((p) => p.isUpcoming).length
      : 0;
  const grid = monthGrid(month);
  const today = todayIso();

  return (
    <section className="mx-auto w-full max-w-4xl">
      <header className="border-b border-line/80 pb-4">
        <p className="eyebrow">Feed and calendar</p>
        <h1 className="mt-1 text-[1.5rem] leading-tight sm:text-[1.75rem]">
          What is happening
        </h1>
        <p className="mt-1 max-w-prose text-[0.9375rem] leading-relaxed text-body">
          {upcoming > 0
            ? `${upcoming} upcoming ${upcoming === 1 ? "event" : "events"} announced by USG.`
            : "Announcements from USG and the dates they are on."}
        </p>
      </header>

      <h2 className="mt-6 text-[1.125rem] leading-tight">Announcements</h2>

      {state.kind === "loading" ? (
        <p className="mt-2 text-[0.9375rem] text-muted">Loading announcements...</p>
      ) : state.kind === "error" ? (
        <div className="mt-2 rounded-card border border-line bg-paper px-4 py-5">
          <p className="text-[0.9375rem] leading-relaxed text-body">{state.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-[0.9375rem] transition-colors hover:bg-canvas"
          >
            Try again
          </button>
        </div>
      ) : state.posts.length === 0 ? (
        <div className="mt-2 rounded-card border border-line bg-paper px-4 py-5">
          <p className="text-[0.9375rem] leading-relaxed text-body">
            Nothing has been announced yet. What USG publishes will show up here.
          </p>
        </div>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {state.posts.map((post) => {
            const when = post.eventDate ? eventLabel(post.eventDate) : null;
            return (
              <li key={post.id} className="rounded-card border border-line bg-paper px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="text-[0.9375rem]">{post.title}</p>
                  <span
                    className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[0.75rem] font-medium ${activityClass(post.activityType)}`}
                  >
                    {activityLabel(post.activityType)}
                  </span>
                </div>

                {post.description ? (
                  <p className="mt-1.5 text-[0.875rem] leading-relaxed text-body">
                    {post.description}
                  </p>
                ) : null}

                <p className="mt-1.5 text-[0.8125rem] text-muted">
                  {when ? (
                    <span className={when.past ? "" : "text-ink"}>
                      {when.text} · {post.eventDate}
                    </span>
                  ) : (
                    "No date set"
                  )}
                  {post.venue ? ` · ${post.venue}` : ""}
                  {post.unitName ? ` · ${post.unitName}` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-10 flex items-center justify-between gap-3 border-b border-line/80 pb-3">
        <h2 className="text-[1.125rem] leading-tight">Calendar</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMonth(shiftMonth(month, -1))}
            aria-label="Previous month"
            className="min-h-11 rounded-lg border border-line px-3 text-[0.875rem] transition-colors hover:bg-canvas"
          >
            Back
          </button>
          <span className="min-w-[9.5rem] text-center text-[0.9375rem]">{monthLabel(month)}</span>
          <button
            type="button"
            onClick={() => setMonth(shiftMonth(month, 1))}
            aria-label="Next month"
            className="min-h-11 rounded-lg border border-line px-3 text-[0.875rem] transition-colors hover:bg-canvas"
          >
            Next
          </button>
        </div>
      </div>

      {calendar.kind === "loading" ? (
        <p className="mt-3 text-[0.9375rem] text-muted">Loading the calendar...</p>
      ) : calendar.kind === "error" ? (
        <div className="mt-3 rounded-card border border-line bg-paper px-4 py-5">
          <p className="text-[0.9375rem] leading-relaxed text-body">{calendar.message}</p>
        </div>
      ) : (
        <>
          <div className="mt-3 hidden grid-cols-7 gap-1 sm:grid">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <span key={d} className="px-1 text-[0.75rem] font-medium uppercase tracking-[0.1em] text-faint">
                {d}
              </span>
            ))}
          </div>

          <ul className="mt-1 grid grid-cols-2 gap-1.5 sm:grid-cols-7">
            {grid.map((date) => {
              const events = calendar.days[date] ?? [];
              const cell = dayCellLabel(date);
              const isToday = date === today;

              return (
                <li
                  key={date}
                  className={`min-h-24 rounded-lg border p-2 ${
                    events.length > 0
                      ? "border-ink/20 bg-paper"
                      : "border-line/60 bg-canvas/40"
                  }`}
                >
                  <p className="text-[0.75rem] text-muted tabular-nums">
                    <span className={isToday ? "font-medium text-ink" : ""}>{cell.day}</span>{" "}
                    <span className="hidden sm:inline">{cell.weekday}</span>
                  </p>

                  {events.length > 0 ? (
                    <ul className="mt-1 flex flex-col gap-1">
                      {events.map((e) => (
                        <li key={e.id} className="text-[0.75rem] leading-snug">
                          <span className="block truncate">{e.title}</span>
                          {e.venue ? (
                            <span className="block truncate text-muted">{e.venue}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}