import { nextStatus } from "./approval";
import { seed } from "./seed";
import type { Action, ItemKind, Review, Status, TimelineEntry } from "./types";

export const STORAGE_KEY = "smartgov.mock.v1";

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type Item<T extends ItemKind> = {
  id: string;
  kind: T;
  title: string;
  status: Status;
  filedBy: string;
  filedByEmail: string;
  createdAt: string;
  timeline: TimelineEntry[];
  review: Review | null;
  detail: Record<string, unknown>;
};

export type Announcement = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  at: string;
  by: string;
};

export type Unit = { id: string; name: string; lead: string; officers: string[] };
export type Council = { id: string; name: string; officers: string[] };

export type MockState = {
  proposals: Item<"proposal">[];
  events: Item<"event">[];
  budgets: Item<"budget">[];
  announcements: Announcement[];
  units: Unit[];
  councils: Council[];
};

export type FileInput = {
  title: string;
  filedBy: string;
  filedByEmail: string;
  detail: Record<string, unknown>;
};

const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();

export type Store = {
  load(): MockState;
  reset(): MockState;
  file(kind: ItemKind, input: FileInput): Item<ItemKind>;
  review(kind: ItemKind, id: string, action: Action, comment: string, byLabel: string, byName: string): MockState;
  announce(input: { title: string; body: string; by: string }): MockState;
  togglePin(id: string): MockState;
  addOfficer(unitId: string, name: string): MockState;
  addCouncilOfficer(councilId: string, name: string): MockState;
};

export function createStore(storage: StorageLike, seedData: () => MockState = seed): Store {
  const read = (): MockState | null => {
    const json = storage.getItem(STORAGE_KEY);
    if (!json) return null;
    try {
      return JSON.parse(json) as MockState;
    } catch {
      return null;
    }
  };

  const write = (state: MockState) => storage.setItem(STORAGE_KEY, JSON.stringify(state));

  const listFor = (state: MockState, kind: ItemKind) =>
    state[`${kind}s` as keyof MockState] as unknown as Item<ItemKind>[];

  const load = (): MockState => {
    const existing = read();
    if (existing) return existing;
    const fresh = seedData();
    write(fresh);
    return fresh;
  };

  const file = (kind: ItemKind, input: FileInput): Item<ItemKind> => {
    const state = load();
    const item: Item<ItemKind> = {
      id: uid(),
      kind,
      title: input.title,
      status: "pending",
      filedBy: input.filedBy,
      filedByEmail: input.filedByEmail,
      createdAt: now(),
      timeline: [
        { at: now(), from: "none", to: "pending", by: input.filedBy, note: "Filed for review" },
      ],
      review: null,
      detail: input.detail,
    };
    listFor(state, kind).push(item);
    write(state);
    return item;
  };

  const review = (kind: ItemKind, id: string, action: Action, comment: string, byLabel: string, byName: string): MockState => {
    const state = load();
    const list = listFor(state, kind);
    const idx = list.findIndex((it) => it.id === id);
    if (idx === -1) throw new Error(`No ${kind} with id ${id}`);
    const item = list[idx];
    const to = nextStatus(item.status, action);
    item.status = to;
    item.timeline.push({
      at: now(),
      from: to === "in_review" && item.timeline.length === 1 ? "pending" : (item.timeline[item.timeline.length - 1]?.to ?? "none"),
      to,
      by: byLabel,
      note:
        action === "return"
          ? comment
          : action === "approve"
            ? "Approved"
            : action === "start_review"
              ? "Review started"
              : "Resubmitted",
    });
    if (action === "approve" || action === "return") {
      item.review = { decidedBy: byName, at: now(), comment };
    } else {
      item.review = null;
    }
    write(state);
    return state;
  };

  const announce = (input: { title: string; body: string; by: string }): MockState => {
    const state = load();
    state.announcements.unshift({ id: uid(), title: input.title, body: input.body, pinned: false, at: now(), by: input.by });
    write(state);
    return state;
  };

  const togglePin = (id: string): MockState => {
    const state = load();
    const a = state.announcements.find((x) => x.id === id);
    if (a) a.pinned = !a.pinned;
    write(state);
    return state;
  };

  const addOfficer = (unitId: string, name: string): MockState => {
    const state = load();
    const u = state.units.find((x) => x.id === unitId);
    const trimmed = name.trim();
    if (u && trimmed && !u.officers.includes(trimmed)) u.officers.push(trimmed);
    write(state);
    return state;
  };

  const addCouncilOfficer = (councilId: string, name: string): MockState => {
    const state = load();
    const c = state.councils.find((x) => x.id === councilId);
    const trimmed = name.trim();
    if (c && trimmed && !c.officers.includes(trimmed)) c.officers.push(trimmed);
    write(state);
    return state;
  };

  const reset = (): MockState => {
    const fresh = seedData();
    write(fresh);
    return fresh;
  };

  return { load, reset, file, review, announce, togglePin, addOfficer, addCouncilOfficer };
}