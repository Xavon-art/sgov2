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

type PromptState = { tour: PageTour; pathname: string };

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

export function TourProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const [activeTour, setActiveTour] = useState<PageTour | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
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
      setPrompt(null);
    };
    window.addEventListener("smartgov:tour-progress-reset", reset);
    return () => window.removeEventListener("smartgov:tour-progress-reset", reset);
  }, []);

  useEffect(() => {
    if (loadedPath !== pathname || activeRef.current) return;
    const tour = matchTour(pathname);
    if (!tour || alreadySeen(progressRef.current, tour)) return;
    const timer = window.setTimeout(() => setPrompt({ tour, pathname }), tour.autoStart ? 450 : 850);
    return () => window.clearTimeout(timer);
  }, [pathname, loadedPath]);

  const isPromptOpen = prompt?.pathname === pathname;
  const promptTour = isPromptOpen && prompt ? prompt.tour : null;

  const persist = useCallback((next: TourProgress) => {
    progressRef.current = next;
    void saveTourProgress(next);
  }, []);

  const start = useCallback(
    (tour?: PageTour | null) => {
      const selected = tour ?? promptTour ?? matchTour(pathname);
      if (!selected || selected.steps.length === 0 || alreadySeen(progressRef.current, selected)) return;
      activeRef.current = selected;
      stepRef.current = 0;
      setActiveTour(selected);
      setStepIndex(0);
      setPrompt(null);
    },
    [pathname, promptTour],
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
      const tour = activeRef.current ?? promptTour;
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
      setPrompt(null);
    },
    [persist, promptTour],
  );

  const acceptPrompt = useCallback(() => {
    start(promptTour ?? undefined);
  }, [start, promptTour]);

  const dismissPrompt = useCallback(
    (remember: boolean) => {
      if (remember) {
        stop(true);
        return;
      }
      setPrompt(null);
    },
    [stop],
  );

  const value = useMemo<TourApi>(
    () => ({
      activeTour,
      stepIndex,
      start,
      next,
      back,
      stop,
      isPromptOpen,
      promptTour,
      acceptPrompt,
      dismissPrompt,
    }),
    [activeTour, stepIndex, start, next, back, stop, isPromptOpen, promptTour, acceptPrompt, dismissPrompt],
  );

  return (
    <TourContext.Provider value={value}>
      {children}
      <div className="tour-floating-help fixed bottom-4 right-4 z-[70] md:bottom-6 md:right-6">
        <TourHelpButton compact />
      </div>
      {isPromptOpen && promptTour ? (
        <div
          className="tour-prompt fixed bottom-20 right-4 z-[80] w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl border border-line-strong bg-paper p-4 shadow-float md:bottom-24 md:right-6"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-brass-soft text-[0.8125rem] font-semibold text-brass-deep">
              ?
            </span>
            <div className="min-w-0">
              <p className="text-[0.9375rem] font-medium leading-snug text-ink">
                New: a 1-minute guide to this page is available.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={acceptPrompt}
                  className="pressable rounded-full bg-ink px-3.5 py-2 text-[0.8125rem] font-semibold text-paper transition-colors hover:bg-ink-deep"
                >
                  Start tour
                </button>
                <button
                  type="button"
                  onClick={() => dismissPrompt(false)}
                  className="pressable rounded-full px-3 py-2 text-[0.8125rem] font-medium text-muted transition-colors hover:text-ink"
                >
                  Not now
                </button>
                <button
                  type="button"
                  onClick={() => dismissPrompt(true)}
                  className="pressable rounded-full px-3 py-2 text-[0.8125rem] font-medium text-muted transition-colors hover:text-ink"
                >
                  Don&apos;t ask again
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
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
