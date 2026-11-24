"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  emptyTourProgress,
  loadTourProgress,
  matchTour,
  saveTourProgress,
  type PageTour,
  type TourProgress,
} from "@/lib/tours";
import { TourHelpButton } from "./HelpButton";
import { TourContext, type TourApi } from "./tour-context";
import { TourOverlay } from "./TourOverlay";

function freshProgress(): TourProgress {
  return {
    ...emptyTourProgress,
    completed: { ...emptyTourProgress.completed },
    dismissed: { ...emptyTourProgress.dismissed },
  };
}

function alreadySeen(progress: TourProgress, tour: PageTour): boolean {
  return progress.completed[tour.id] === tour.version || progress.dismissed[tour.id] === tour.version;
}

/**
 * Tours are strictly opt-in: the floating help button starts the guide for the
 * current page. There is deliberately no unsolicited prompt/banner — that popup
 * kept reappearing and interrupting people, so it was removed entirely while
 * the guided tours themselves stay fully available.
 */
export function TourProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const [activeTour, setActiveTour] = useState<PageTour | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const progressRef = useRef(freshProgress());
  const activeRef = useRef<PageTour | null>(null);
  const stepRef = useRef(0);

  useEffect(() => {
    let alive = true;
    void loadTourProgress().then((next) => {
      if (!alive) return;
      progressRef.current = next;
      setLoadedPath(pathname);
    });
    return () => {
      alive = false;
    };
  }, [pathname]);

  useEffect(() => {
    const reset = () => {
      progressRef.current = { ...freshProgress(), sidebarCollapsed: progressRef.current.sidebarCollapsed };
      activeRef.current = null;
      stepRef.current = 0;
      setActiveTour(null);
      setStepIndex(0);
    };
    window.addEventListener("smartgov:tour-progress-reset", reset);
    return () => window.removeEventListener("smartgov:tour-progress-reset", reset);
  }, []);

  // `loadedPath` gates progress loading per route; the tour is never auto-shown.
  void loadedPath;

  const persist = useCallback((next: TourProgress) => {
    progressRef.current = next;
    void saveTourProgress(next);
  }, []);

  const start = useCallback(
    (tour?: PageTour | null) => {
      const selected = tour ?? matchTour(pathname);
      // Manual starts keep working even after a tour was completed or dismissed
      // before — the tutorial is opt-in, never forced and never locked away.
      if (!selected || selected.steps.length === 0) return;
      activeRef.current = selected;
      stepRef.current = 0;
      setActiveTour(selected);
      setStepIndex(0);
    },
    [pathname],
  );

  const next = useCallback(() => {
    const tour = activeRef.current;
    if (!tour) return;
    if (stepRef.current + 1 < tour.steps.length) {
      stepRef.current += 1;
      setStepIndex(stepRef.current);
      return;
    }
    const current = progressRef.current;
    persist({
      ...current,
      completed: { ...current.completed, [tour.id]: tour.version },
    });
    activeRef.current = null;
    stepRef.current = 0;
    setActiveTour(null);
    setStepIndex(0);
  }, [persist]);

  const back = useCallback(() => {
    stepRef.current = Math.max(0, stepRef.current - 1);
    setStepIndex(stepRef.current);
  }, []);

  const stop = useCallback(
    (saveDismissal = true) => {
      const tour = activeRef.current;
      if (tour && saveDismissal && !alreadySeen(progressRef.current, tour)) {
        const current = progressRef.current;
        persist({
          ...current,
          dismissed: { ...current.dismissed, [tour.id]: tour.version },
        });
      }
      activeRef.current = null;
      stepRef.current = 0;
      setActiveTour(null);
      setStepIndex(0);
    },
    [persist],
  );

  const value = useMemo<TourApi>(
    () => ({ activeTour, stepIndex, start, next, back, stop }),
    [activeTour, stepIndex, start, next, back, stop],
  );

  return (
    <TourContext.Provider value={value}>
      {children}
      <div className="tour-floating-help fixed bottom-4 right-4 z-[70] md:bottom-6 md:right-6">
        <TourHelpButton compact />
      </div>
      {activeTour ? (
        <TourOverlay
          key={`${activeTour.id}:${stepIndex}`}
          tour={activeTour}
          stepIndex={stepIndex}
          onNext={next}
          onBack={back}
          onStop={() => stop(true)}
        />
      ) : null}
    </TourContext.Provider>
  );
}

export default TourProvider;
