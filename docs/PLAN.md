# Implementation Plan — USG / LSG Decentralized Student Government

Status: approved for build. Last updated after the repo audit on 2026-10-05.

## 0. The reality this plan is built on

This is not a greenfield app. Roughly 60% of the target product already exists, built and
proven in production under a specific security model. This plan adds the missing third and
deliberately does **not** disturb the existing foundation.

Three rules below are inherited from the repo's standing constraints, not chosen by me. They
replace parts of the incoming brief, and each replacement is noted in `docs/DECISIONS.md`.

| Incoming brief | What we do instead | Why |
| --- | --- | --- |
| RLS policies on every LSG table | No RLS policies. Scope lives in `security definer` functions under `smartgov`, reached through `public` forwarders | Already the enforced house rule; `scripts/check-units.mjs` fails the build on `create policy`. It also satisfies Hard Rule 1 — scope is enforced in the database, never trusted from the client |
| Supabase Auth | Existing custom session (`sgov_session`) resolved per request by `currentAccount()` | Rewriting auth would invalidate every session and every RPC. No gain |
| `users` / `roles` / `permissions` / `lsgs` / `lsg_members` | Existing `accounts` / `organization_members` / `governance_units` / `unit_memberships` / `org_positions` / `unit_positions` | The live model is a unit **tree** with a **seat** per position, not a flat role string. It already drives the org chart. Reverting would break it |
| Build auth and roles first | Already built | Rebuilding would delete reviewed, deployed work |

The two brief rules that are genuinely new and that we are adopting in full: **separate
`/usg` and `/lsg` route trees** with distinct layouts and nav components, and
**invitations being USG-only with no LSG reach whatsoever**.

## 1. What already exists — do not rebuild

Invite-only registration; invitations with `pending`/`accepted`/`expired`/`revoked`, 14-day
expiry, resend, revoke, account deactivation; `governance_units` as a college/department tree
with a central root; the seat model; the org chart; custom sessions; governance-model modes
(`unit` / `centralized`); proposals with `draft` → `submitted` → `under_review` →
`approved` / `rejected` / `needs_revision` → `published`, plus `proposal_versions` for
resubmission; reviews carrying mandatory remarks; requirement buckets with `file` / `link`
types and allowed-type lists; private Supabase Storage with signed URLs; the `UsgShell` and
`LsgShell`; and a `check:units` suite of 136 assertions.

## 2. What is missing — the build queue

Verified absent: no hits across all 19 migrations.

1. **Roles and permissions.** `smartgov.account_permissions`
   (organization_id, account_id, permission, granted_by, granted_at) keyed by account, with a
   check constraint on the permission name. Grants are USG-Admin-only.
2. **Route split.** `/usg/**` and `/lsg/**`, each with its own layout, nav component and
   accent. `/dashboard/**` stays as a permanent redirect so old links keep working.
3. **Feed.** `posts`, `post_attachments`, `post_comments`. USG writes free-form posts; an LSG
   reaches the feed only by publishing an approved proposal. Type-filtered, pinnable, with
   attachments, remarks and a comment thread.
4. **Tasks.** `tasks` plus `task_assignments` (task × unit, so one task to 12 units is 12
   separate statuses), deadline, priority, computed `overdue`, requirement buckets reused from
   the existing bucket machinery.
5. **Budget.** `budget_requests`, `budget_items` with server-computed totals and an
   approved-amount field that may differ from the requested amount.
6. **Notifications.** `notifications` with an unread count, written by trigger-free RPC calls
   at each status transition. Email is out of scope behind a flag.
7. **Docs and seed.** This file, `docs/DESIGN.md`, `docs/DECISIONS.md`, and a seed script with
   1 USG admin, 2 USG officers, 6 LSGs with 2 officers each, and sample content.

## 3. Role matrix

| Account | Side | Route | Invite | Review proposals | Write feed posts |
| --- | --- | --- | --- | --- | --- |
| `account_scope = owner` | USG | `/usg` | always | yes | yes |
| Invited, seat in a `usg`-kind unit | USG | `/usg` | only with `can_invite` | yes | yes |
| Invited, seat in a descendant unit, no `can_invite` | LSG | `/lsg` | never | no | never |
| Invited, USG seat **and** LSG seat | USG | `/usg` | only with `can_invite` | yes | yes |

USG side wins on a dual seat, because it is the strictly larger privilege set. An LSG seat on
the same account stays in the database and keeps working through the account's unit resolution,
so no membership is lost by holding both.

## 4. Routes

```
/usg   home · units · invitations · accounts · requirements · proposals · tasks · feed · budget · settings
/lsg   today · tasks · proposals · feed · help
```

`/dashboard/**` redirects to the correct side. `/usg/**` and `/lsg/**` each redirect a
cross-side account to its own home on the server, so a bookmarked URL is not a way to reach the
other side. `/lsg` never imports a USG-only component, so those code paths are not in the LSG
bundle.

## 5. Security approach for new features

Every new table is created in `smartgov` with no grants to `anon` or `authenticated`. Every
access path is a `security definer` function that takes `p_session_token`, resolves the caller
to an account, derives the unit from the caller's own membership — never from a parameter the
client can choose — and returns only that unit's rows. The `public` forwarder pins
`search_path = public, extensions, smartgov, pg_temp` and is the only granted surface.

An LSG caller asking for another unit's proposal is refused inside the function because the
resolved unit does not match. This is the Hard Rule 1 guarantee.

## 6. Design tokens — existing, not reinvented

`canvas #fafaf7` · `paper #ffffff` · `ink #16324f` / `ink-deep #0d2135` · `brass #c9a24b`
(warm accent) · `line #e5e1d6`. Type is Fraunces for display and Inter for text. The identity is
civic seal and brass on paper, which is already specific to student government rather than a
generic dashboard. `/usg` and `/lsg` get distinct accents within this system — brass for USG,
ink-blue for LSG — so a user always knows which workspace they are in before reading a word.

## 7. Slices

Each slice is committed on its own after lint, typecheck and build pass.

1. **Roles and route split.** `account_permissions`, a single `account_workspace_role` RPC that
   resolves side plus permissions in one call, `/usg` and `/lsg` layouts with separate nav,
   redirect from `/dashboard`.
2. **Feed and calendar.** Posts, attachments, comments, USG composer, publish-on-approval.
3. **Tasks.** Assignment to one, several or all units; per-unit status; deadline countdown;
   overdue; buckets reused.
4. **Budget.** Line items, computed total, approved amount, summary per unit and university-wide.
5. **Notifications.** Center, unread count, triggers on transitions.
6. **Docs, seed, and cross-access tests.** The proof that an LSG cannot read another unit's data
   or reach `/usg`.