"use client";

import { useEffect, useState, type ReactNode } from "react";
import { isBooted } from "@/lib/auth/boot";
import { Seal } from "@/components/ui/Seal";

/**
 * Ends the session when the page was reached by loading it rather than by
 * navigating to it from inside the app.
 *
 * Wraps a gated page's whole tree on `/dashboard`, `/org-chart` and
 * `/my-council`. See `@/lib/auth/boot` for why the signal is per-tab JS state
 * and not anything the server can see.
 *
 * The placeholder is the point, not a nicety. The server has already decided to
 * render this account's dashboard by the time any of this runs -- its HTML is in
 * the document and on its way to the screen. Checking in an effect and then
 * redirecting means every refresh paints private data for a frame first, which is
 * both ugly and briefly leakable over someone's shoulder. `isBooted()` is read
 * during the first render instead, so on a cold load the dashboard is never
 * painted and all the user ever sees is the line below for the length of one
 * round trip.
 *
 * The same read is what keeps this from firing during normal use. `useState`
 * takes its initial value once per mount, and `router.refresh()` re-renders
 * without remounting, so the ten-second `ChartRefresher` poll never re-evaluates
 * the guard.
 */
export function SessionGuard({ children }: { children: ReactNode }) {
  const [live] = useState(isBooted);

  useEffect(() => {
    if (live) return;

    let cancelled = false;

    // Awaited before navigating, and that ordering is load-bearing. Starting the
    // logout and redirecting in parallel lets the navigation cancel the
    // in-flight request, and a session row that outlives its cookie is a session
    // the user cannot actually get rid of.
    void (async () => {
      try {
        await fetch("/api/auth/logout", { method: "POST" });
      } catch {
        // Abandoning the session regardless. A failed teardown cannot leave the
        // user signed in on its own, because the cookie resolves against a row
        // in Postgres and that is what is being discarded here.
      }
      if (!cancelled) window.location.replace("/login");
    })();

    return () => {
      cancelled = true;
    };
  }, [live]);

  if (live) return <>{children}</>;

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <Seal size={48} />
      <p className="text-[0.9375rem] leading-relaxed text-body">
        This session is tied to the page that opened it, so a reload ends it.
      </p>
      <p className="text-[0.8125rem] leading-relaxed text-muted">
        Taking you back to sign in.
      </p>
    </div>
  );
}