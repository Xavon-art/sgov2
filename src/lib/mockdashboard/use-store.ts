"use client";

import { useEffect, useMemo, useState } from "react";
import { createStore, type MockState, type Store } from "./db";
import type { Action, ItemKind } from "./types";

let singleton: Store | null = null;

function getStore(): Store {
  if (typeof window === "undefined") throw new Error("useStore must run on the client");
  if (!singleton) singleton = createStore(window.localStorage);
  return singleton;
}

export function useStore() {
  const [state, setState] = useState<MockState | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const loaded = getStore().load();
      if (!active) return;
      setState(loaded);
    })();
    return () => {
      active = false;
    };
  }, []);

  const actions = useMemo(
    () => ({
      file: (kind: ItemKind, input: Parameters<Store["file"]>[1]) => {
        const item = getStore().file(kind, input);
        setState(getStore().load());
        return item;
      },
      review: (kind: ItemKind, id: string, action: Action, comment: string, byLabel: string, byName: string) => {
        setState(getStore().review(kind, id, action, comment, byLabel, byName));
      },
      announce: (input: { title: string; body: string }) =>
        setState(getStore().announce({ ...input, by: "USG Office" })),
      togglePin: (id: string) => setState(getStore().togglePin(id)),
      addOfficer: (unitId: string, name: string) => setState(getStore().addOfficer(unitId, name)),
      addCouncilOfficer: (councilId: string, name: string) =>
        setState(getStore().addCouncilOfficer(councilId, name)),
      reset: () => setState(getStore().reset()),
    }),
    [],
  );

  return { state, actions };
}