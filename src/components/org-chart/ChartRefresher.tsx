"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const REFRESH_INTERVAL_MS = 10_000;

/**
 * Renders nothing; keeps the chart current by calling `router.refresh()` on a
 * timer.
 *
 * `router.refresh()` re-runs the server component in place, and the chart
 * pages are `force-dynamic`, so the re-render re-reads `unit_chart` (and
 * `list_roster`) with the caller's session token scoping the rows in SQL. It
 * is the same call the org-chart mutation controls already make after every
 * write, so a write and a timer tick converge on one code path.
 *
 * Polling pauses while the tab is hidden and refreshes once on return, so a
 * backgrounded page does not hammer the database for a chart no one is
 * looking at, and an officer who tabs back sees the current chart without
 * waiting out a tick.
 */
export function ChartRefresher() {
  const router = useRouter();

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;

    const stop = () => {
      if (interval) {
        clearInterval(interval);
        interval = undefined;
      }
    };

    const start = () => {
      stop();
      interval = setInterval(() => {
        router.refresh();
      }, REFRESH_INTERVAL_MS);
    };

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        router.refresh();
        start();
      } else {
        stop();
      }
    }

    start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router]);

  return null;
}