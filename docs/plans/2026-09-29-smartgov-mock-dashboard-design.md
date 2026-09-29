# SmartGov Mock Dashboard — Design

Date: 2026-09-29
Status: Approved (user: Julius)

## Purpose

A clickable, two-sided demo of SmartGov for student body organizations (USG and
LSG councils). No real backend — a fully seeded mock that behaves like the real
product so the person browsing it understands the workflow without signing up.

## Deliverables

Two live Vercel links on a single deployed project:

- `https://<project>.vercel.app/usg` — USG admin dashboard
- `https://<project>.vercel.app/lsg` — LSG officer dashboard
- `https://<project>.vercel.app/` — landing page with a role picker

The two sides are interrelated: LSG files proposals/events/budgets, USG reviews
them, and status changes appear on the other side. Both read/write one shared
mock store.

## Architecture

Standalone app in `Desktop\smartgov-mock` (NOT inside the smartgov1 repo), its
own Vercel project.

- Stack: Next.js (App Router) + TypeScript + Tailwind CSS.
- Data: `src/lib/mock/` — typed store with seed data, persisted to
  `localStorage` behind a versioned migrations key. First load seeds; a
  "Reset demo data" button reseeds.
- No auth, no database, no file uploads, no cross-device sync.

## Routes

| Path | Content |
|---|---|
| `/` | Landing: product one-liner, two entry cards, active demo data summary |
| `/usg` | USG admin dashboard |
| `/lsg` | LSG officer dashboard |

## Modules (both sides)

Status pipeline mirrors the real product: `pending → in_review → approved | returned`.

| Module | LSG side | USG side |
|---|---|---|
| Proposal approvals | File new proposal; list + track status w/ timeline | Review inbox; approve/return with comment |
| Event management | Propose event; calendar/list of approved org events | Approve events; all events listed with status |
| Budget & funds | Request funds; allotted vs spent tracker | Approve budgets; ledger of org allocations |
| Org chart / units | Read-only unit tree + officers | Maintain units + officer rosters |
| Announcements | Read USG posts in feed | Compose + pin announcements |

## Seed data

- USG top org with 4 units: Finance, Events & Culture, Academics, Students Welfare.
- 3 LSG councils: CCIS, COE, CAS, each with officers.
- ~5 proposals (2 approved, 2 in_review, 1 returned), 3 events (1 approved + upcoming,
  1 pending, 1 completed), budget allocations with spent/remaining per unit, 3 announcements.

## Out of scope

Real login, real database, file uploads, multi-device persistence, mobile-perfect
layout. Demo data is browser-local only.

## Deploy

`vercel` CLI, project `smartgov-mock` (auto-generated URL). Requires a Vercel
login/token on the build machine.