"use client";

import { useSyncExternalStore } from "react";
import { useOrgDraft } from "@/lib/store";

const subscribe = (onChange: () => void) =>
  useOrgDraft.persist.onFinishHydration(onChange);

const getSnapshot = () => useOrgDraft.persist.hasHydrated();

const getServerSnapshot = () => false;

/**
 * The draft is persisted to sessionStorage, which only exists in the browser.
 * Gating on hydration keeps the server markup and first client render identical.
 */
export function useDraftHydrated() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
