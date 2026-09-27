# SmartGov

Centralized and intelligent governance management for university student governments — a landing page and a complete multi-step organization-creation flow.

**Status:** UI/UX and flow prototype. No authentication, no encrypted credential handling, and no dashboard product surface yet. Organization creation does persist to Supabase through a single atomic RPC.

**Live:** <https://smart-gov-lime.vercel.app> · **Repo:** <https://github.com/dreamerdev-SYS/smartgov>

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

Migrations live in `supabase/migrations/`:

| File | Contents |
| --- | --- |
| `20260101000000_init_smartgov.sql` | Enums, `organizations`, `organization_members`, `governance_units`, `submissions`, indexes, `updated_at` trigger, RLS enabled |
| `20260101000100_create_organization_rpc.sql` | The `create_organization(jsonb)` RPC — the only write path the browser can reach |

Apply both:

1. Supabase dashboard → **SQL Editor** → paste each file in order → **Run**.
2. Or `supabase db push --db-url <connection string>`.

### Why an RPC instead of a public INSERT policy

A bare `FOR INSERT ... WITH CHECK (true)` policy is still rejected at runtime on this project's Postgres (`new row violates row-level security policy`), and the only policy shape that does admit the row is `FOR ALL ... USING (true)` — which would hand the publishable key read, update, and delete on every table.

So creation goes through `create_organization`, a `SECURITY DEFINER` function owned by `postgres` (which bypasses RLS by design). The resulting posture is tighter than the original intent:

- RLS stays **enabled on all four tables with zero policies**, and `anon` holds no table grants, so the publishable key cannot touch any table directly.
- `anon` may only `EXECUTE` this one function, which validates its input and writes the organization, its founding member, and its governance units in a **single transaction** — the earlier three-request client flow could leave an organization row behind when a later insert failed.
- `slug` and `charter_number` collisions are resolved server-side, so two identically named councils both succeed and the client renders the values the database actually stored.

Units are passed as a flat array; each entry may carry a zero-based `parentIndex` pointing at an earlier entry, which keeps the self-referencing `governance_units` tree flat on the wire.

Until the migrations are applied the flow still completes end-to-end — the success step issues a charter locally and shows a prototype notice instead of failing.

## Environment variables

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

The publishable key is designed for the browser. Never put the database password or a `service_role` key in client code or in a `NEXT_PUBLIC_*` variable.
