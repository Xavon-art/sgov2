"use client";

import { useSyncExternalStore } from "react";
import type { BudgetDashboard, BudgetRow, BudgetSummary } from "@/lib/budgets";

export type BudgetStoreState = {
  budgets: BudgetRow[];
  summary: BudgetSummary | null;
  dashboard: BudgetDashboard | null;
  loading: boolean;
  error: string | null;
};

type BudgetResponse = {
  ok?: boolean;
  message?: string;
  budgets?: BudgetRow[];
  summary?: BudgetSummary | null;
  dashboard?: BudgetDashboard | null;
};

const EMPTY_STATE: BudgetStoreState = {
  budgets: [],
  summary: null,
  dashboard: null,
  loading: true,
  error: null,
};

const POLL_MS = 15_000;

let state: BudgetStoreState = EMPTY_STATE;
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let visibilityBound = false;

function publish(patch: Partial<BudgetStoreState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function refreshBudgetStore(): Promise<void> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const res = await fetch("/api/budgets", { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as BudgetResponse;
      if (!res.ok || !json.ok) {
        throw new Error(json.message ?? "We could not load the budget requests.");
      }

      publish({
        budgets: Array.isArray(json.budgets) ? json.budgets : [],
        summary: json.summary ?? null,
        dashboard: json.dashboard ?? null,
        loading: false,
        error: null,
      });
    } catch (error) {
      publish({
        loading: false,
        error: error instanceof Error ? error.message : "We could not load the budget requests.",
      });
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

function startTimer() {
  if (typeof window === "undefined" || pollTimer !== null) return;
  pollTimer = setInterval(() => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      void refreshBudgetStore();
    }
  }, POLL_MS);
}

function stopTimer() {
  if (pollTimer === null) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

function onVisibilityChange() {
  if (typeof document === "undefined") return;
  if (document.visibilityState === "visible") {
    startTimer();
    void refreshBudgetStore();
  } else {
    stopTimer();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  if (typeof window !== "undefined") {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      startTimer();
    }
    if (!visibilityBound && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
      visibilityBound = true;
    }
    void refreshBudgetStore();
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size > 0 || typeof window === "undefined") return;
    stopTimer();
    if (visibilityBound && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      visibilityBound = false;
    }
  };
}

function getSnapshot() {
  return state;
}

function getServerSnapshot() {
  return EMPTY_STATE;
}

export function useBudgetStore() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { ...snapshot, refresh: refreshBudgetStore };
}
