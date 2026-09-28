# Realtime org chart — design

Date: 2026-09-29
Status: approved

## Problem

The org chart and "my council" pages render what the database said when the
page loaded. An owner seats an officer in one tab; the officer's own browser
still shows a vacant seat until they reload. For a product whose first audience
is a live stuffing of a government, "hit F5 to see your seat" reads as broken.

## Scope

**In**

- `/org-chart` and `/my-council` refresh themselves every 10 seconds, without a
  reload, and immediately after any write the owner performs on the same page.
- A chart behind a `force-dynamic` server component already re-reads the
  database on every request; the feature is simply making that request happen
  on a timer and after writes.

**Out — deliberately**

- Supabase Realtime WebSocket subscriptions. The zero-policy RLS posture in
  `README.md` means no table is directly readable by `anon`, and realtime
  subscriptions require table-level grants and publications that would turn a
  locked table into a data-exfiltration surface. Polling keeps every read on
  the existing `SECURITY DEFINER` path.
- A dedicated `GET /api/org-chart` endpoint. The chart is already served fresh
  by the server component; a client polling a JSON endpoint would be a second,
  differently-shaped renderer of the same data, split between two files and
  twice the surface to keep in lockstep.

## Design

Reuse what the pages already do. **`router.refresh()`** re-renders the server
component in place, which re-runs `unit_chart` (and `list_roster`) because the
pages are `force-dynamic`, and it does not lose client component state — the
seat panel an owner has open stays open, the text they typed stays in the
fields.

A tiny shared client component, `<ChartRefresher />`, renders nothing and runs
`router.refresh()` on a `setInterval`. Because it is exactly what the mutation
controls already call after every write (OrgChartControls calls
`router.refresh()` after add-position, seat toggle, invite, assign, and
release), a write and a tick converge on the same code path.

Details:

- Interval: 10 seconds.
- The refresher listens for `visibilitychange` and stops polling while the tab
  is hidden, so a backgrounded page does not hammer the Every time it becomes
  visible it refreshes once immediately, so an officer returning to the tab
  sees the current chart without waiting out a tick.
- The scoping stays in Postgres: `unit_chart` filters by the caller's
  memberships in its `where` clause, unchanged. The refresher adds no new
  privileges, routes, tables, or grants.
- No client-side "last good data" cache is needed: if a refresh fails, the
  server component keeps whatever it last rendered and the next tick tries
  again. There is no spinner and no blank state to design.

## Files

- New: `src/components/org-chart/ChartRefresher.tsx`
- Edit: `src/app/org-chart/page.tsx` — render `<ChartRefresher />`
- Edit: `src/app/my-council/page.tsx` — render `<ChartRefresher />`

## Verification

- `npx tsc --noEmit`, `npx eslint .`, `npm run build`.
- `npm run check:federated` and `npm run check:units` still green — the feature
  adds no new route, no new migration, no changes to store/submit.
- Manual: load the org chart in two tabs; in one, assign a seat; the other
  updates within 10 seconds.