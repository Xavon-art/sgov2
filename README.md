# SmartGov

Centralized and intelligent governance management for university student governments — a landing page and a complete multi-step organization-creation flow.

**Status:** UI/UX and flow prototype. No authentication, no encrypted credential handling, and no dashboard product surface yet.

## Governance models

The setup flow branches on one early decision, which shapes the org chart and the roles available afterwards:

| | Federated / Decentralized | Unitary / Centralized |
| --- | --- | --- |
| Top body | University Student Government (USG) | Student Council |
| Lower tier | One LSG per college, department, or campus | None |
| Roles created | USG Officer, LSG Officer, Advisor | Council Officer, Advisor |

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Landing page |
| `/create` | Step 1 — Welcome |
| `/create/governance-model` | Step 2 — Federated vs. Unitary |
| `/create/account` | Step 3 — Administrator account |
| `/create/institution` | Step 4 — University, campus, college, seal |
| `/create/organization` | Step 5 — Org name, mandate, color, term |
| `/create/review` | Step 6 — Charter preview + confirm |
| `/create/success` | Step 7 — Charter granted, persists the org |
| `/dashboard` | Placeholder workspace |

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · Tailwind CSS v4 · raw WebGL shader field · Motion · Zustand (sessionStorage) · Supabase

The shader is hand-written GLSL on a single full-screen triangle — no Three.js — with adaptive resolution scaling, `IntersectionObserver` pausing, a low-quality path for coarse pointers, and a static frame under `prefers-reduced-motion`. It falls back to a CSS gradient mesh without WebGL.

## Local development

```bash
npm install
cp .env.local.example .env.local   # then fill in your project values
npm run dev
```

## Database

Schema lives in `supabase/migrations/20260101000000_init_smartgov.sql` (enums, `organizations`, `organization_members`, `governance_units`, `submissions`, indexes, `updated_at` trigger, RLS).

Apply it once:

1. Open the Supabase dashboard → **SQL Editor** → paste the migration file → **Run**.
2. Or, with the CLI linked: `supabase db push`.

Current RLS posture: `anon` may `INSERT` (so the unauthenticated setup flow can write), and no read/update/delete policy is granted. Dashboard reads come later behind an authenticated session.

Until the schema is applied the flow still completes end-to-end — the success step issues a charter locally and shows a prototype notice instead of failing.

## Environment variables

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

The publishable key is designed for the browser. Never put the database password or a `service_role` key in client code or in a `NEXT_PUBLIC_*` variable.
