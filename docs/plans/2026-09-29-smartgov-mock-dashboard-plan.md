# SmartGov Mock Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a two-sided clickable demo of SmartGov (USG admin + LSG officer dashboards), deployed to Vercel with two linked URLs.

**Architecture:** Standalone Next.js App Router app in `C:\Users\Julius M. Matro\Desktop\smartgov-mock` (its own Vercel project), TypeScript + Tailwind. A typed mock store (`src/lib/mock/`) holds seed data, persists to `localStorage` behind an injected storage interface, and exposes the full approval workflow (file → in_review → approved/returned). `/usg` and `/lsg` read/write the same store, so the two sides stay in sync by construction.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, Vitest (logic layer), Vercel CLI.

**All `npx`/`npm` commands in tasks below run in `C:\Users\Julius M. Matro\Desktop\smartgov-mock` unless stated otherwise.**

---

### Task 1: Scaffold the app

**Files:**
- Create: entire `smartgov-mock` project via create-next-app

**Step 1: Scaffold non-interactively**

Run:
```bash
npx create-next-app@latest smartgov-mock --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes
```
Run from `C:\Users\Julius M. Matro\Desktop`. Expected: `smartgov-mock` folder created, `npm run dev` bootable, git initialized inside it.

**Step 2: Add Vitest**

Run:
```bash
npm i -D vitest
```
Add to `package.json` scripts: `"test": "vitest run"`.

**Step 3: Smoke check**

Run: `npm run build`
Expected: build succeeds.

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: scaffold smartgov-mock (Next.js + TS + Tailwind + Vitest)"
```

---

### Task 2: Domain types and approval pipeline (logic core)

**Files:**
- Create: `src/lib/mock/types.ts`
- Create: `src/lib/mock/approval.ts`
- Test: `src/lib/mock/approval.test.ts`

**Step 1: Write the failing tests**

`src/lib/mock/approval.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { canSubmit, canReview, nextStatus } from "./approval";
import type { Status } from "./types";

describe("nextStatus", () => {
  it("files pending -> in_review when the USG starts a review", () => {
    expect(nextStatus("pending", "start_review")).toBe("in_review");
  });
  it("in_review -> approved on approve", () => {
    expect(nextStatus("in_review", "approve")).toBe("approved");
  });
  it("in_review -> returned on return", () => {
    expect(nextStatus("in_review", "return")).toBe("returned");
  });
  it("returned -> in_review on resubmit", () => {
    expect(nextStatus("returned", "resubmit")).toBe("in_review");
  });
  it("throws on invalid transitions", () => {
    expect(() => nextStatus("approved", "approve")).toThrow();
    expect(() => nextStatus("pending", "approve")).toThrow();
  });
});

describe("role gates", () => {
  it("only usg reviews; only lsg files", () => {
    expect(canSubmit("lsg")).toBe(true);
    expect(canSubmit("usg")).toBe(false);
    expect(canReview("usg")).toBe(true);
    expect(canReview("lsg")).toBe(false);
  });
});
```

**Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/mock/approval.test.ts`
Expected: FAIL — module not found.

**Step 3: Write minimal implementation**

`src/lib/mock/types.ts`:
```ts
export type Role = "usg" | "lsg";
export type Status = "pending" | "in_review" | "approved" | "returned";
export type ItemKind = "proposal" | "event" | "budget";
export type Review = { decidedBy: string; at: string; comment: string };
export type TimelineEntry = { at: string; from: Status; to: Status; by: string; note?: string };
```

`src/lib/mock/approval.ts`:
```ts
import type { Role, Status } from "./types";

export function nextStatus(from: Status, action: "start_review" | "approve" | "return" | "resubmit"): Status {
  const table: Record<string, Status> = {
    "pending:start_review": "in_review",
    "in_review:approve": "approved",
    "in_review:return": "returned",
    "returned:resubmit": "in_review",
  };
  const to = table[`${from}:${action}`];
  if (!to) throw new Error(`Illegal ${from} + ${action}`);
  return to;
}

export function canSubmit(role: Role): boolean {
  return role === "lsg";
}
export function canReview(role: Role): boolean {
  return role === "usg";
}
```

**Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/mock/approval.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: domain types and approval pipeline gates"
```

---

### Task 3: Mock store with injected storage + seeded actions

**Files:**
- Create: `src/lib/mock/db.ts`
- Create: `src/lib/mock/seed.ts`
- Test: `src/lib/mock/db.test.ts`

**Step 1: Write the failing tests**

`src/lib/mock/db.test.ts`: use an in-memory storage faked from `{ getItem, setItem }` backed by a `Map`. Verify:
- first load returns the seed (proposals present, statuses mixed),
- `reviewItem("proposal", id, "approve", comment)` flips status to `approved` and appends a timeline entry + review,
- `fileItem("event", {...})` returns a new id with `status: "pending"` and length grows by 1,
- `reset()` restores the seed counts,
- the second `load()` on the same storage returns the mutated store (persistence round-trip).

**Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/mock/db.test.ts`
Expected: FAIL — module not found.

**Step 3: Write minimal implementation**

`src/lib/mock/db.ts` — a `createStore(storage, seed?)` factory:
```ts
export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

const KEY = "smartgov.mock.v1";

export type Item<T extends ItemKind> = {
  id: string;
  kind: T;
  title: string;
  status: Status;
  filedBy: string; // council name
  filedByEmail: string;
  createdAt: string;
  timeline: TimelineEntry[];
  review?: Review | null;
  detail: Record<string, unknown>;
};

export type MockState = {
  proposals: Item<"proposal">[];
  events: Item<"event">[];
  budgets: Item<"budget">[];
  announcements: { id: string; title: string; body: string; pinned: boolean; at: string; by: string }[];
  units: { id: string; name: string; lead: string; officers: string[] }[];
  councils: { id: string; name: string; officers: string[] }[];
};
```
Functions on the store: `load()`, `save()`, `reset()`, `file(kind, fields)`, `review(kind, id, action, comment, by)`, `announce(...)`, `togglePin(id)`.
`load()`: if `storage.getItem(KEY)` parses, return it, else persist `seed()` and return it. `review` uses `nextStatus` and throws on illegal action. `file` sets `status:"pending"`, id from `crypto.randomUUID()`, `createdAt` now, `timeline:[{at, from:"none", to:"pending", by: fields.filedBy}]`.

`src/lib/mock/seed.ts` — `seed()`:
- 4 units: Finance, Events & Culture, Academics, Students Welfare.
- 3 councils: CCIS Student Council, COE Student Council, CAS Student Council (each 4 officers).
- 5 proposals (2 approved, 2 in_review, 1 returned), 3 events (1 approved+future, 1 pending, 1 completed), 4 budgets (per unit: allotted, spent; statuses 2 approved, 1 pending, 1 returned), 3 announcements (1 pinned).
- All timeline/review fields consistent with the status.

**Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/mock/db.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: seeded mock store with review/file/reset actions"
```

---

### Task 4: Shared UI foundation

**Files:**
- Create: `src/components/kpi-card.tsx`
- Create: `src/components/status-badge.tsx`
- Create: `src/components/dashboard-shell.tsx`
- Create: `src/components/card.tsx`
- Create: `src/components/modal.tsx`
- Create: `src/components/field.tsx` (label + input/textarea/select primitives)
- Create: `src/components/timeline.tsx`
- Create: `src/components/tab-bar.tsx`
- Modify: `src/app/globals.css` (keep Tailwind tokens; add a tiny `.thin-scroll` utility)

**Contract (all components):** no external state deps beyond props; `StatusBadge` maps `pending|in_review|approved|returned` to (label, classes) — amber/blue/emerald/rose. `DashboardShell` takes `{ role, title, tabs: {id,label,count?}[], active, onTab, children, right }` and renders a top bar with role badge (USG indigo / LSG emerald) plus the tab strip. `Modal` is a fixed inset overlay with backdrop click + Esc close; `Timeline` renders `TimelineEntry[]` newest-first.

**Step 1:** Implement all files above exactly per the contract.

**Step 2: Verify**

Run: `npm run build`
Expected: succeeds.

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: shared UI foundation (shell, badges, modals, form fields)"
```

---

### Task 5: Client store hook + loading

**Files:**
- Create: `src/lib/mock/use-store.ts`

`useStore()` (client hook): hydrates from `createStore(localStorage)` once on mount (`useState(() => load())`), exposes `{ state, actions }` where every action applies `next = store.action(...)` then `setState(next)` and persists. Wrap actions with `useCallback`. Reset triggers `setState(store.reset())`.

**Verify:** `npm run build`. Then **Commit** (`feat: client use-store hook`).

---

### Task 6: USG admin dashboard (`/usg`)

**Files:**
- Create: `src/app/usg/page.tsx` (client)
- Create: `src/components/usg/overview.tsx`
- Create: `src/components/usg/reviews.tsx` (inbox: proposals / events / budgets tabs; approve & return with a comment textarea in a `Modal`)
- Create: `src/components/usg/ledger.tsx` (approved budgets: allotted vs spent bars, remaining)
- Create: `src/components/usg/announcements.tsx` (compose form + list + pin toggle)
- Create: `src/components/usg/units.tsx` (unit tree + councils with officer rosters, add-officer input)
- Create: `src/components/usg/calendar.tsx` (all events with status chips inline grouped by status)

**Behavior:** Reviews tab default; badge counts = items in `in_review` (red dot on tab). Approve/return moves item status and appends timeline + review `{decidedBy:"USG", comment}`. Overview shows KPI cards (awaiting review, approved this week, total funds allotted, spent %). 

**Verify:** `npm run build`. Then **Commit** (`feat: USG admin dashboard`).

---

### Task 7: LSG officer dashboard (`/lsg`)

**Files:**
- Create: `src/app/lsg/page.tsx` (client)
- Create: `src/components/lsg/overview.tsx`
- Create: `src/components/lsg/my-submissions.tsx` (kind filter; status chips; `Timeline` drawn from item.timeline)
- Create: `src/components/lsg/file-new.tsx` (3-step modal: kind pick → form (kind-specific fields) → `store.file()` + success)
- Create: `src/components/lsg/funds.tsx` (allotted vs spent per unit, own council highlighted)
- Create: `src/components/lsg/feed.tsx` (announcements, pinned first)
- Create: `src/components/lsg/orgchart.tsx` (read-only tree + officer lists)

**Behavior:** File New creates `pending` item that instantly appears in `/usg` reviews (verify manually: file an event on `/lsg`, check the count on `/usg`). Submitted by defaults to first council (e.g., "CCIS Student Council").

**Verify:** `npm run build`. Then **Commit** (`feat: LSG officer dashboard`).

---

### Task 8: Landing page + reset

**Files:**
- Create: `src/app/page.tsx` (client): hero line, two link cards (`/usg`, `/lsg`) with role descriptions, live summary (state counts via `useStore`), "Reset demo data" button.

**Verify:** `npm run build`. Then **Commit** (`feat: landing page with role picker and reset`).

---

### Task 9: Full verification

Run:
```bash
npm run lint
npx tsc --noEmit
npx vitest run
npm run build
```
Expected: all pass. Fix issues, re-run until green. Then **Commit** if any fixes (`chore: verification fixes`).

---

### Task 10: Deploy to Vercel

**Prerequisite:** Vercel CLI must be authenticated. If `vercel whoami` fails, ask Julius to run `vercel login` (or provide a token).

**Step 1: Preview deploy**

Run (from `smartgov-mock`): `vercel --yes`
Expected: project auto-linked as `smartgov-mock`, preview URL printed.

**Step 2: Manual sanity**

Open preview URLs `/usg` and `/lsg`; file an event on `/lsg`; confirm it lands in `/usg` Reviews inbox with count. (If headless, at minimum confirm both routes render 200.)

**Step 3: Promote**

Run: `vercel --prod --yes`
Expected: production URL printed.

**Step 4: Hand over**

Report the two links: `<prod-url>/usg` and `<prod-url>/lsg`.

**Final commit** only if deploy revealed fixes.