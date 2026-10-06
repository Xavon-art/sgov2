# SmartGov

Centralized and intelligent governance management for university student governments — a landing page, a multi-step organization-creation flow, and a working account and invitation system on top of it.

**Status:** Authentication, invitations, and activation are real and database-backed. The `/create` flow issues a charter, registers a sign-in-capable owner account, and the owner can invite officers from the dashboard. The `submissions` table exists in the schema but no product surface writes to it yet.

**Live:** <https://sgov.vercel.app> · **Repo:** <https://github.com/dreamerdev-SYS/smartgov>

## Governance models

The setup flow branches on one early decision, which shapes the org chart, the roles available afterwards, and which of the two dashboards an account lands on:

| | Federated / Decentralized | Unitary / Centralized |
| --- | --- | --- |
| Top body | University Student Government (USG) | Student Council |
| Lower tier | One LSG per college, department, or campus | None |
| Roles created | USG Officer, LSG Officer, Advisor | Council Officer, Advisor |
| `account_kind` | `usg` | `central` |

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Landing page |
| `/create` | Step 1 — Welcome |
| `/create/governance-model` | Step 2 — Federated vs. Unitary |
| `/create/account` | Step 3 — Administrator details (email + password) |
| `/create/institution` | Step 4 — University, campus, college |
| `/create/units` | Step 5 — Organization name, description, academic year, and the LSG councils beneath it |
| `/create/review` | Step 6 — Charter preview + confirm |
| `/create/verification` | Step 7 — Emails an activation link; the mail's button activates the account |
| `/activate` | GET handler for that button — activates the account, mints the session, lands on `/dashboard` |
| `/create/activated` | Legacy confirmation page (no longer reached by the new flow) |
| `/login` | Sign in with email and password |
| `/invite/[token]` | Invited step 1 — set a password (server-probed before render) |
| `/invite/[token]/verify` | Invited step 2 — enter the emailed six-digit code |
| `/dashboard` | Owner and invited workspaces, gated on the server |

The setup flow is federated-only. The unitary option is present on the model
step as copy but is not selectable, and `MODELS` in
`src/app/create/governance-model/page.tsx` no longer contains it — re-enabling
that path means restoring the model card, its roles, and its units behaviour.

Route handlers, all `runtime = "nodejs"`:

| Endpoint | Purpose |
| --- | --- |
| `POST /api/organization` | Atomic `create_organization` — org, founding officer, governance units |
| `POST /api/auth/register` | `create_owner_account` (writes `pending`, returns `verifyToken`), then mails the activation link |
| `GET /activate` | `activate_owner` — flips the pending owner to `active` and mints the session in one step |
| `POST /api/auth/resend-owner-code` | Re-sends the activation email against a live pending registration |
| `POST /api/auth/login` | `login_account`; sets the session cookie; sends the welcome letter if owed |
| `POST /api/auth/logout` | `delete_session`, then clears the cookie |
| `GET /api/invites` | `list_invites` — pending vs. activated, for owners |
| `POST /api/invites` | `create_invite` + email delivery |
| `POST /api/invites/accept` | `accept_invite` (creates a `pending` account) + `set_otp` + code email |
| `POST /api/invites/resend-code` | Probes the invite, then re-mints and re-sends a code |
| `POST /api/invites/verify-otp` | `verify_otp` — flips the account to `active` |

## Stack

Next.js 16 (App Router) · React 19 · TypeScript (`strict`) · Tailwind CSS v4 · Zustand (setup draft, persisted to `sessionStorage`) · raw WebGL GLSL · Motion · Nodemailer · `@supabase/supabase-js` for PostgREST only · Postgres via Supabase.

No ORM, and no test framework is configured — `package.json` has no test script and no runner in devDependencies.

The landing background is hand-written GLSL on a single full-screen triangle — no Three.js — with device-pixel-ratio scaling, `IntersectionObserver` pausing, `WEBGL_lose_context` teardown, a low-quality path for coarse pointers, and a static frame under `prefers-reduced-motion`. It falls back to a CSS gradient mesh without WebGL.

## Local development

```bash
npm install
cp .env.local.example .env.local   # then fill in your own values
npm run dev
```

Scripts: `npm run dev`, `npm run build`, `npm run start`, `npm run lint`.

The client-side setup flow degrades gracefully when Supabase is unreachable: `submitOrganization` returns a locally issued charter with `persisted: false` and the success step shows a notice instead of failing. Sign-in does not degrade — it is a hard dependency on the database.

## Environment variables

Everything the app reads, all documented in `.env.local.example`. Only two are public.

| Variable | Public | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL, e.g. `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | Publishable/anon key. Safe to ship to the browser |
| `AUTH_PEPPER` | **no** | Server-side secret used to HMAC one-time passcodes before they are stored. Required, never defaulted — see `src/lib/auth/crypto.ts` |
| `GMAIL_USER` | **no** | The Gmail account that sends every transactional message. Gates all mail together with `GMAIL_APP_PASSWORD` |
| `GMAIL_APP_PASSWORD` | **no** | A Google **app password**, not the account password — Gmail refuses the account password over SMTP. Create one at <https://myaccount.google.com/apppasswords> (2FA must be on); it is shown once, grouped in fours |
| `MAIL_FROM_NAME` | no | Display name on the `From:` line. Defaults to `SmartGov` |
| `SMTP_HOST` | no | Defaults to `smtp.gmail.com` |
| `SMTP_PORT` | no | Defaults to `587` |
| `SMTP_SECURE` | no | `"true"` for implicit TLS; otherwise STARTTLS on 587 |
| `SMTP_FROM_EMAIL` | no | Defaults to `GMAIL_USER` |
| `NEXT_PUBLIC_SITE_URL` | yes | Base URL used to build links inside emails. Defaults to `http://localhost:3000` |

The older `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM_NAME` names still work and are
read as a fallback, so an existing deployment does not break — but `GMAIL_USER`
and `GMAIL_APP_PASSWORD` are what `.env.local.example` documents.

Generate a pepper with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.

`AUTH_PEPPER`, the SMTP variables, and the real Supabase values live in `.env.local`, which is gitignored (`.gitignore` ignores `.env*` and re-admits only `.env.local.example`). Never put the database password or a `service_role` / secret key in `.env.local.example`, in a `NEXT_PUBLIC_*` variable, or anywhere in the client bundle.

There is no `service_role` key in this project at all — see the architecture section below for why that shaped the whole design.

## Database

Postgres on Supabase. Migrations live in `supabase/migrations/` and **must be applied in filename order** — 003 replaces functions that 002 created, and 002's version of `create_owner_account` is the vulnerable one.

| File | Contents |
| --- | --- |
| `20260101000000_init_smartgov.sql` | Core schema in `public`: `organizations`, `organization_members`, `governance_units`, `submissions`, four enums, indexes, the `updated_at` trigger, and RLS enabled. It also creates three `anon` INSERT policies, which the next file immediately drops — read it as the starting point, not the destination |
| `20260101000100_create_organization_rpc.sql` | Drops those insert policies, revokes table grants from `anon`, and adds `create_organization(jsonb)` — the single atomic write path for org creation |
| `20260101000200_auth_and_invitations.sql` | Creates the `smartgov` schema: `accounts`, `invites`, `sessions`, four enums, helpers (`sha256`, `hash_password`, `password_matches`), and the auth functions |
| `20260101000300_expose_auth_api_and_hardening.sql` | The `public` PostgREST wrappers (13 of them), the `smartgov.rate_limits` table and `consume_rate_limit`, and the hardening of 002 |
| `20260101000500_add_department_unit_type.sql` | Adds `department` to `public.unit_type` as a peer of `college`/`campus` — a unit row *is* that place's LSG, there is no separate LSG layer |
| `20260101000600_unit_hierarchy_tables.sql` | `org_positions` (org-level template), `unit_positions` (which seats a unit has), `roster` (people without accounts yet), `unit_memberships` (dated seats). Two partial unique indexes: one active holder per seat, one active seat per person per unit |
| `20260101000700_create_organization_unit_tree.sql` | Replaces the arbitrary `parentIndex` nesting with an enforced depth-1 shape: a federated USG writes a `usg` root plus one child per declared college/campus/department, all in the one transaction. Still accepts the legacy one-element `usg` payload so the deployed client keeps working through rollout |
| `20260101000800_unit_chart_functions.sql` | `unit_chart` — the scoping centrepiece. An owner sees every unit; an LSG officer sees only their own units plus the parent USG, filtered in the SQL `where` clause so other units are never in the result set. Plus the owner-only writes: `add_position`, `toggle_unit_position`, `assign_officer`, `release_officer` |
| `20260101000900_roster_invites.sql` | Extends `create_invite` with unit/position args: it writes the roster row and the membership in the same transaction, so the seat is filled at invite time and accepting only links the account. `accept_invite` sets `roster.account_id` |
| `20260101001000_list_roster.sql` | Owner-only roster read for the seat-assignment picker. Necessary because the roster is one row per email per org: without it an officer could never be moved between seats, since re-inviting the same address collides with the unique index |
| `20260101001100_owner_otp_approval.sql` | `create_owner_account` now writes `pending`, mints a one-time `verifyToken` (only its SHA-256 is stored), and `verify_owner_otp` gates activation on an emitted code. Superseded for owners by 016 below, but `set_owner_otp` / `verify_owner_otp` are still the invite verification path (`account_workspace` gains `recentlyApproved` for the dashboard banner) |
| `20260101001200_password_reset.sql` | Password recovery keyed on a dedicated `password_resets` row (at most one live reset per account). `begin_password_reset` emails a code only to an `active` account and answers identically for a missing one, so the endpoint cannot probe for registered addresses; `complete_password_reset` re-hashes the password and revokes every session on a match |
| `20260101001600_owner_activation_link.sql` | Owners now approve by magic link instead of a typed code: the registration emails a button for `activate_owner`, which flips the pending account to `active` **and** mints the session in one step, so the owner lands directly on their dashboard. `owner_send_activation` is the cooldown/limit gate for resends |

Apply them either way:

1. Supabase dashboard → **SQL Editor** → paste each file in order → **Run**.
2. Or the Supabase CLI: `supabase db push --db-url <connection string>`. The CLI records what it has applied in `supabase_migrations.schema_migrations`; there is no `supabase/config.toml` in this repo, so the CLI is used as a migration runner only.

Do not re-run a migration by hand and then run `db push` — or vice versa — or the CLI will try to replay a file the database has already had.

## Architecture and security

### Authentication is custom, not Supabase Auth

There is no `supabase.auth.*` call anywhere in `src/`, and no `@supabase/ssr`. `@supabase/supabase-js` is imported in exactly one file, `src/lib/supabase.ts`, with `persistSession: false`. It is used purely as a PostgREST RPC transport on the server.

Why: this project has no `service_role` key, so there is no privileged client that could read or write tables directly. Every operation is instead expressed as a `SECURITY DEFINER` Postgres function.

How a session works:

1. `smartgov.login_account(email, password)` verifies the bcrypt hash and mints the session **in the same statement**. The token is 32 bytes from `gen_random_bytes(32)`; only `smartgov.sha256(token)` is written to `smartgov.sessions.token_hash`. The raw token is returned exactly once.
2. `POST /api/auth/login` sets it as an **httpOnly** cookie named `sgov_session`, `sameSite=lax`, `secure` in production, 30-day maxAge — matching the `interval '30 days'` granted in SQL.
3. Every authenticated read goes through `smartgov.resolve_account(token)`, which hashes the token, refuses expired sessions, refuses any account whose status is not `active`, and refreshes `last_seen_at`.

There is deliberately **no** function that takes an account id and returns a token. `anon` could call such a function for any id it guessed, so `/api/auth/register` mints the new owner's session by re-running `login_account` with the credentials it just set.

Passwords are hashed in Postgres with `crypt(password, gen_salt('bf', 10))` — pgcrypto bcrypt at cost 10. Plaintext never reaches the database.

### Two schemas, and why

- `public` holds the governance data (`organizations`, `organization_members`, `governance_units`, `submissions`) and the `create_organization` function.
- `smartgov` holds `accounts`, `invites`, `sessions`, and every auth function.

PostgREST on this project exposes **only the `public` schema**, so `supabase.rpc("login_account", …)` failed with `PGRST202` until 003 published thin `public` wrappers. Each wrapper is a one-line `security definer` forwarder — all validation and authorization stay in the `smartgov` original, so a wrapper can never be stricter or looser than the logic it calls. Do not add logic to a wrapper.

The reachable surface is that explicit list of 13 plus the six published later (00800 and 001000), and nothing else. 003 revokes `execute` on the `smartgov` originals from `public`, `anon`, and `authenticated`, so the other originals in the schema are never published — deliberately, in every case:

- `smartgov.authenticate` — returns a whole `accounts` row, including `password_hash` and `otp_hash`.
- `smartgov.sha256`, `hash_password`, `password_matches` — withheld so `anon` cannot use the database as a free bcrypt or hashing oracle.
- `smartgov.refresh_invite_status` — maintenance sweep with no caller.
- `smartgov.consume_rate_limit`, `login_rate_limited`, `register_rate_limited` — added by 003 itself, but reachable only from inside the `security definer` originals, never as an entry point. `anon` cannot spend somebody else's budget by calling the limiter directly.

A function added to the `smartgov` schema later does **not** become callable by accident, because the blanket schema grant from 002 was dropped.

### RLS posture — read this before you "fix" something

This is deliberate and load-bearing:

- **RLS is enabled on all twelve tables** — the four in `public` and the eight in `smartgov` (`accounts`, `invites`, `sessions`, `rate_limits`, `org_positions`, `unit_positions`, `roster`, `unit_memberships`) — with **zero policies**.
- **`anon` holds no table grants on any of them**, and `authenticated` does not either.
- The `SECURITY DEFINER` functions are the only way in or out.

> **Do not add a table policy, and do not add a direct client read.** Granting one policy on one table silently converts a locked table into a data-exfiltration surface for anyone holding the publishable key, which is public by design. A bare `FOR INSERT … WITH CHECK (true)` policy is in fact rejected at runtime on this project's Postgres (`new row violates row-level security policy`), and the only shape that does admit rows is `FOR ALL … USING (true)` — which would hand the publishable key read, update, and delete on every table. That is the whole reason `create_organization` is a function rather than a policy. If a query seems to need table access, it needs a new function in the `smartgov` schema plus a `public` wrapper and a grant in 003.

Note that the zero-policy end state is reached in **two** migrations, not one: 000 creates three `anon` INSERT policies and 00100 drops them. A database that has only had 000 applied is not in the posture described here.

### Account scopes

| Scope | How it is created | What it may do |
| --- | --- | --- |
| `owner` | `create_owner_account`, from the `/create` flow | Everything in the workspace, including issuing invitations |
| `invited` | `accept_invite`, from an emailed link | Sign in and see its own scope; cannot invite |

An invited account is created `pending` and only becomes `active` when the emailed six-digit code is verified. `resolve_account` refuses any account that is not `active`, so a half-finished OTP flow cannot reach `/dashboard` even with a valid session cookie.

The six-digit code is generated in the application — it has to be emailed — and only `HMAC-SHA256(code, AUTH_PEPPER)` is stored, so a dump of `smartgov.accounts` cannot be replayed. The `AUTH_PEPPER` is required rather than defaulted: an unkeyed digest would let anyone who reads the database brute-force all one million codes for an account in seconds. Guessing is bounded at five wrong codes per code, five re-sends per invite (lifetime, not per window, plus a two-minute cooldown), and twenty raw `verify_otp` calls per invite per fifteen minutes.

Invitation links carry 24 bytes from `gen_random_bytes(24)`, stored the same way as sessions — SHA-256 in `smartgov.invites.token_hash`, plaintext only in the email. Both `set_otp` and `verify_otp` are bound to the **invite token** rather than an account id, because a uuid is enumerable in bulk while the invite token is the only secret the recipient actually holds.

Owners approve the same way, minus the code: `create_owner_account` keeps the `verifyToken` in the email as a magic link, and the link's click proves address ownership. `activate_owner` is a magic-link log-in — it stages the activation and the session mint in one call, and rejects anything that is not a live, still-pending `verifyToken` (guessed tokens hit a 10-minute IP budget on `/activate`).

### No function trusts an identity from the client

Every owner-facing function takes the session token and resolves the caller's own account internally. There is no request body anywhere that carries an organization id to authorize against. `create_invite` in particular takes the organization from `v_account.organization_id`, so there is no way to invite into somebody else's workspace.

`create_owner_account` is the sharpest case. Migration 002 accepted any organization id that merely existed, which meant the publishable key plus any org id was enough to become that organization's owner and start minting invitations into it. 003 requires a `public.organization_members` row with `is_founding` set **and** a matching email — the founding-member record written by `create_organization` is the proof of authorship. A client-supplied organization id on its own is rejected with `not_organization_founder`.

### Unit scoping is enforced in SQL, not in React

An LSG officer's view must contain only their own units and the parent USG. `unit_chart` builds the officer's id list from their **memberships** in the `where` clause, so every other unit is absent from the result set — a client-side filter would still ship every unit to the browser, where devtools can read it, making scoping decorative. The same founding-member check gates every owner-only write (`add_position`, `toggle_unit_position`, `assign_officer`, `release_officer`, `list_roster`), so an LSG officer can read their chart but cannot mutate anything.

### The document shape, and why the order matters

A government structure is `{ committees: [{ key, name, positions: [...] }] }` — an object with a `committees` array, never a bare array. Committee and position order is the render order of a published chart, and `jsonb` does not promise array order survives a key sort, so every read that assembles one walks the array with `with ordinality as c(value, ord)` and emits `order by c.ord`. An earlier version let Postgres sort the keys, which put "Audit Committee" ahead of "Ceremonials" in a published structure.

`key` is a stable slug, client-generated, that survives a rename and a reorder. That is what lands in `governance_units.structure_key`: without it, re-approving a renamed committee would have to guess whether "Welfare Committee" and "Welfare and Outreach Committee" are the same row, and a rename would orphan every seat inside it. Removing a position frees its row but never recycles its key, so nothing later inherits an identity a history already used.

`isUnit: true` marks the one committee whose seats belong to the unit the structure is *for* rather than to a child of it. At most one committee may carry it and it must be the first — a council's own board is the council, not a committee inside it — and `gov_document_valid` checks the flag inside the per-committee loop, before the committee's body is trusted, so a misplaced one is refused rather than silently filing a council's own officers into a committee.

### Approval rewrites seats, so authorship is load-bearing

`review_structure` with `approved` materialises the document into `governance_units`, enabled positions and live seats. Approving can therefore move the reviewer off their own seat and out of the chart entirely, which is what makes the 03010 rules load-bearing rather than defensive tidying:

- `created_by` and `decided_by` are `on delete set null`. Under `restrict`, one authored structure makes its organization permanently undeletable.
- A structure whose author is `null` stays hidden from reviewers. `created_by <> v_account.id` alone reads as *unknown* for a departed author, and three-valued logic would hand that draft to everyone reviewing.
- 03020 widens `unit_chart` to union `gov_authored_unit_ids` over an authored structure's unit and its immediate parents. Before it, approving your own structure took the chart away from the person who wrote it — they no longer held a seat, and the chart only ever knew about seats.

### Photos are write-only in the document, and the base64 is unwrapped

A holder's `photo` goes up in a draft as bytes and comes back as `hasPhoto: true`. Reads carry the flag only, because embedding base64 would put every officer's face into the JSON of every structure read; the picture is fetched separately from `/api/structures/photos/[rosterId]`, itself scoped by `gov_people_unit_ids` so an officer cannot page a sibling council's personnel.

Two encoding details that were real bugs rather than style. `encode(..., 'base64')` wraps at 76 columns, which is not base64 as far as `atob` is concerned, so the newline is stripped on the way out. And the photo flag has to be written with a nested `jsonb_set(p.value, '{holder}', p.value->'holder' || ...)` — the earlier `p.value->'holder' || jsonb_build_object('hasPhoto', ...)` replaced the whole position and lost the seat's own key and title.

### Templates can be listed because they cannot carry a person

`list_structure_templates` (03030) returns each template's `document`, which is what lets a gallery's "Use this" button do anything at all — `import_structure_template` is an upsert *into* the gallery and never returns one. Returning documents in a shared response is safe here for one reason: every writer of a template (`import_structure_template` and the built-in seeding) validates with `gov_document_valid(doc, p_allow_holders => false)`, which refuses any holder with the detail "A template cannot name people". So the change adds committee and position keys to a response that already named the template, and never an officer's name, email or photo.

### The setup flow, end to end

`/create/success` calls `POST /api/organization`, which calls `create_organization`: it validates the payload, resolves `slug` and `charter_number` collisions server-side (so two identically named councils both succeed and the client renders the values the database actually stored), then writes the organization, its founding officer, and its governance units in **one transaction**. The earlier three-request client flow could leave an organization row behind when a later insert failed.

Only once the organization exists does it call `POST /api/auth/register`, because the account is bound to that row. If the organization succeeds and registration fails, the page says exactly that rather than pretending the whole thing failed.

Units are passed as a flat array. For federated, a `usg` root is written first and each `{name, type}` child hangs off it; the hierarchy is deliberately depth-1 — the schema `parentIndex` nesting that predates this is gone. The wizard requires at least one unit for federated and skips the step entirely for unitary.

### Mail

Three branded messages, sent through Nodemailer: invitation, one-time passcode, and welcome. All three inline the SmartGov mark by Content-ID rather than hot-linking it, because Gmail and Outlook routinely block remote images.

Delivery is ordered so a transient SMTP failure never loses a letter. The invitation is recorded first, so a send failure surfaces as `delivered: false` with the row still visible as pending for the officer to resend. The welcome letter is sent on an invited account's first successful sign-in — after login, not after activation — and the claim is recorded only once the transport accepted it, so the next sign-in retries. A mail failure never blocks a sign-in; the caller is already authenticated at that point.

## Rate limiting

Two layers, and they are meant to hold together.

**The SQL layer is the real one.** `smartgov.rate_limits` is a fixed-window counter table keyed `"<bucket>#<window slot>"`, charged by `smartgov.consume_rate_limit(bucket, limit, window)` in a single atomic upsert, so concurrent callers cannot race past the cap. Because it runs inside the function, the limits hold for a caller hitting PostgREST directly as well as for traffic through the Next.js routes. It also survives a restart and cannot be walked around with a forged header.

| Limit | Budget |
| --- | --- |
| `login:email:<address>` | 10 per 10 min |
| `login:global` | 2000 per 10 min |
| `register:email:<address>` | 5 per 1 hour |
| `register:global` | 500 per 1 hour |
| `invite:session:<account>` | 30 per 1 hour |
| `invite:email:<address>` | 5 per 1 hour |
| `otp:verify:<invite>` | 20 per 15 min |

The per-address and global ceilings are both present on login and registration because they defend against different things: a per-address cap stops one account being ground down, and a global cap bounds a spray across many addresses, which a per-address limit cannot see.

**The in-process layer is defence in depth.** `src/lib/rate-limit.ts` adds a per-IP fixed-window `Map` at the sensitive route handlers, because the database can only see an email address and nothing inside the RPC layer can see the caller's IP. It mirrors the SQL window-slot key so the two layers age the same way.

Its ceiling is explicit: the counters are per process. A serverless or scaled-out deployment gives every instance its own `Map`, so load spread across instances buys a fresh budget per instance, and a cold start or a redeploy empties it outright. A forged `x-forwarded-for` that changes every request would mint a fresh bucket each time, so anything that does not parse as a plain address collapses to a shared `unknown` bucket instead — which is why the windows are set for a campus NAT rather than for one person. **This layer is not a reason to relax the SQL limits.** `login_account` mints its token before the password check, so a wrong guess still costs a rate-limit write and cannot be distinguished by timing.

## Where things live

```
src/
  app/
    page.tsx                     landing page
    login/                       sign-in form
    create/                      the 8-step setup flow
    invite/[token]/              invited flow: set password, then verify code
    dashboard/                   server-gated, force-dynamic
    api/
      organization/              atomic org creation
      auth/                      register, login, logout
      invites/                   list, create, accept, resend-code, verify-otp
      org-chart/                 position, unit-position, invite, assign, release
    org-chart/                   owner chart (server-gated)
    my-council/                  LSG officer's scoped chart (server-gated)
      structure/                 LSG officer's structure builder (server-gated)
    usg/
      structure/                 USG structure queue (server-gated)
  components/
    auth/                        AuthShell, InviteSetupForm, OtpVerify
    create/                      FlowShell, StepShell, WelcomeStart
    dashboard/                   Workspace, SignOutButton
    structure/                   StructureWorkspace, ReviewQueue, document (editor + validator)
    fx/                          ShaderField (WebGL), Reveal, FloatingField
    landing/  ui/
  lib/
    supabase.ts                  the only @supabase/supabase-js import
    auth/
      rpc.ts                     callRpc over PostgREST
      session.ts                 sgov_session cookie, currentAccount, canInvite
      crypto.ts                  otpCode, hmacOtp, randomToken
      messages.ts                reason code -> user-facing wording
    rate-limit.ts                per-IP in-process limiter
    mail/                        send.ts (Nodemailer), templates.ts
    store.ts                     Zustand setup draft (sessionStorage)
    units.ts                     bulk unit parsing + validation
    chart.ts                     unit_chart / list_roster types + fetchers
    submit.ts                    submitOrganization, registerAccount
    steps.ts                     the setup flow's step definitions
supabase/migrations/             twelve files, apply in order
```

`@/*` is aliased to `./src/*` in `tsconfig.json`. Every route handler and server component that touches auth runs on `export const runtime = "nodejs"`, because Nodemailer and the HMAC helpers need Node built-ins.
