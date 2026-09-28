# Email uniqueness and change-email - design

Date: 2026-09-28
Status: approved
Migration: `supabase/migrations/20260101000500_email_uniqueness_and_change.sql`

## What this is

Two things, asked for together:

1. Registration must refuse an address that is already in use, and must do it
   **before** anything is written.
2. A signed-in user must be able to change their own email, verified by a code
   sent to the new address, with a warning in the UI and a notification to the
   old address.

## Why (1) is a fix and not a feature

`email_taken` already exists. `smartgov.create_owner_account` has returned it
since migration 003 (`20260101000300_...sql:243-245`), and
`src/lib/auth/messages.ts:18` already maps it to "That email already has an
account."

The actual bug is **ordering**. The `/create` flow runs:

1. `POST /api/organization` -> `create_organization` inserts an organization
   **and** a founding member row
2. `POST /api/auth/register` -> `create_owner_account` -> `email_taken` -> 400

So a duplicate address leaves an **orphan organization** behind, and the user
is then shown "Your organization was created, but the sign-in account was
not." The organization exists. The account does not.

`create_organization` never reads `smartgov.accounts`, so nothing stops it.

Two further gaps:

- The check is `exists`-then-`insert`, not atomic. A race surfaces as a raw
  `23505` from the `accounts_email_uniq` index and reaches the client as a
  generic HTTP 500, not as `email_taken`.
- There is no pre-flight probe, so the user only finds out at the very end,
  after seven wizard steps.

## Source of truth

`smartgov.accounts` only.

Supabase built-in `auth.users` is **not** used anywhere: no `auth.*` call in
`src/`, no `service_role` key in the project, no sync trigger, and no migration
touching the `auth` schema. The `auth` schema exists on the live platform
because Supabase provisions it, and it stays out of scope here.

Recorded as a known, separate surface: anyone holding the publishable key can
`signUp()` into `auth.users` and mint a row SmartGov will never see. It grants
access to nothing, because all eight tables are RLS-on with zero policies.

## Decisions

| Question | Decision |
|---|---|
| Which table is authoritative for "taken" | `smartgov.accounts` |
| An account in `pending` | Point them at activation, do not silently block |
| An account in `suspended` | Say it is suspended (enum exists, currently unreachable) |
| How the new address is verified | 6-digit code, same as the invite flow |
| Notify the old address | Yes |
| Re-enter password first | Yes |
| Old address afterwards | Released immediately |
| Where in the UI | The Account panel on `/dashboard` |
| Other devices' sessions | All killed; the current session survives |
| Where the pending change lives | New `smartgov.email_changes` table |

## 1. Schema

```sql
create type smartgov.email_change_status as enum
  ('pending', 'verified', 'cancelled', 'expired');

create table smartgov.email_changes (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references smartgov.accounts (id) on delete cascade,
  old_email        text not null,
  new_email        text not null,
  otp_hash         text,
  otp_expires_at   timestamptz,
  otp_attempts     smallint not null default 0,
  otp_resends      integer not null default 0,
  otp_last_sent_at timestamptz,
  status           smartgov.email_change_status not null default 'pending',
  created_at       timestamptz not null default now(),
  verified_at      timestamptz
);

-- one live change per account, however many times a change is started
create unique index email_changes_pending_uniq
  on smartgov.email_changes (account_id) where status = 'pending';

-- two accounts cannot both hold a claim on the same target address
create unique index email_changes_new_uniq
  on smartgov.email_changes (new_email) where status = 'pending';

create index email_changes_resend_idx
  on smartgov.email_changes (otp_last_sent_at);
```

RLS on, no grants, matching the other `smartgov` tables.

`email_changes_new_uniq` is the load-bearing one. Without it two accounts can
both start a change to the same address, the first to verify wins, and the
second fails on `accounts_email_uniq` at the swap with nothing to show for it.

`old_email` is stored so the notification names the address being removed. It is
a record, not a reservation: the old address is released the moment the change
verifies.

### Why not reuse `accounts.otp_hash` / `otp_expires_at` / `otp_attempts`

The invite OTP machinery is already triple-coupled to the invite row: keyed on
the invite token, located by email + org, and it only ever writes to accounts
with `status = 'pending'`. Its resend budget is the most carefully reasoned code
in the project - a window would not bound the guess budget, because invites live
14 days (`20260101000300_...sql:430-433`).

`verify_otp` sets `otp_hash = null` on success. A second flow reading and
writing the same three columns on the same row means the next person to touch
either one can silently clear the other's in-flight code. A dedicated table
costs nine columns once and removes the possibility. It also follows the
project's own rule: new table -> new function + wrapper + grant.

## 2. Reason codes

| Situation | Code | Message |
|---|---|---|
| An `active` account exists | `email_taken` (exists) | That email already has an account. |
| A `pending` account exists | `invite_pending` (new) | You have a pending invitation here. Sign in and enter the code we emailed you. |
| A `suspended` account exists | `account_suspended` (new) | This account is suspended. Contact your officer. |

Two new codes, no new vocabulary beyond the existing `messageFor` table.

A pending claim in `smartgov.email_changes` is treated exactly like an `active`
account when judging a *target* address, or the reservation means nothing.

### One helper, three callers

`smartgov.email_conflict_reason(p_email text) returns text` - empty string when
free, otherwise the code. It reads both `smartgov.accounts` and pending
`email_changes` rows.

- `public.check_email_available(email)` - the pre-flight probe, rate limited
- `create_organization` - **this is the actual orphan fix**
- `create_owner_account` - replaces the bare `exists` check

Plus a `unique_violation` handler in `create_owner_account`, so the race returns
`email_taken` instead of a 500.

## 3. Functions

Logic goes in `smartgov`. One-line `security definer` forwarder in `public`, one
`grant execute` each. Every one pins
`set search_path = public, extensions, smartgov, pg_temp` and takes a session
token rather than an account id (`README:127`, `README:172-174`).

| Function | Behaviour |
|---|---|
| `email_conflict_reason(email)` | Internal. Empty when free. |
| `begin_email_change(session, password, new_email)` | Resolve session, require `status='active'`, **verify the password**, validate the address, reject `same_email`, check conflict, rate limit, cancel any prior pending change, insert a row **with no OTP hash**. Returns `{ok, maskedNewEmail}`. |
| `set_email_change_otp(session, otp_hash, ttl)` | Mirrors `set_otp`: 5 resends lifetime, 2-minute cooldown, TTL clamped to 1..60. Stores the hash, increments counters. |
| `verify_email_change(session, code_hash)` | Rate limit, find the pending change, TTL and attempt and mismatch handling identical to `verify_otp`, **re-check the conflict at swap time**, swap, update the founding member row, kill the other sessions, mark `verified`. |
| `cancel_email_change(session)` | Mark the pending change `cancelled`, releasing the target address. |
| `check_email_available(email)` | Rate-limited probe. |

`begin_email_change` deliberately does not store an OTP hash. The route mints
the code, which follows the ordering contract at `README:190` - record first,
send second - so an SMTP failure leaves a retryable row rather than a lost code.

`verify_email_change` must also update `public.organization_members.email` when
`is_founding`, or the founding-member check in `create_owner_account` stops
matching the account it belongs to.

The swap re-checks the conflict and catches `unique_violation`, because a
reservation can still lose a race against an address claimed through some other
path in the gap between `begin` and `verify`.

## 4. API routes

All `POST`. No `?email=` query parameter: an address in a query string lands in
Vercel access logs and every proxy in between. JSON body only.

| Route | Does |
|---|---|
| `POST /api/account/email-check` | Pre-flight probe, rate limited against enumeration |
| `POST /api/account/email/change` | `begin_email_change` -> mint code -> `set_email_change_otp` -> send |
| `POST /api/account/email/verify` | `verify_email_change` |
| `POST /api/account/email/resend` | New code, same 5-lifetime cap |
| `POST /api/account/email/cancel` | Release the locked target address |

The ordering inside `change` is the part that matters: the hash is stored
**before** the send. If SMTP then fails, the row survives and the response is
`canResend: true`, matching `src/app/api/invites/accept/route.ts:85-94`. Sending
first and storing second loses the code whenever the transport fails.

The notification to the old address is sent **only after a successful verify**,
not on `begin`. A password is already required to begin, so a request on its own
is not a change; the post-verify notice is the alarm that reaches the real owner
when an attacker has both a stolen session and the password.

## 5. UI

The Account panel on `/dashboard` (`src/app/dashboard/page.tsx:162-179`), which
is currently a read-only `<dl>` in a server component.

New `src/components/dashboard/ChangeEmailPanel.tsx` ("use client"), following
the 27-line `SignOutButton.tsx` pattern. The warning the request asked for is a
visible block ahead of the form:

> This will replace the email you sign in with. After this, the old address will
> no longer work and becomes available for someone else to register. You will be
> signed out on every other device. The old address receives a notification.

Then a new-address input and a password input, then the code state.

`src/components/auth/OtpVerify.tsx` is reused rather than reimplemented -
parameterised with `verifyUrl` and `resendUrl` - so the 6-digit input and the
30-second resend cooldown stay in one place.

After success: `router.refresh()`, so `/dashboard` re-reads the new address from
`account_workspace` (`20260101000200_...sql:900`).

Two entries added to `src/lib/auth/messages.ts`: `invite_pending` and
`account_suspended`.

## 6. Rate limits

In SQL, inside the function, so direct PostgREST callers are bound too:

| Bucket | Limit |
|---|---|
| `check:email:<email>` | 10 / 10 min |
| `emailchange:<account_id>` | 5 / 1 hour |
| `emailchange:verify:<change_id>` | 20 / 15 min |

In-process per-IP on the routes, reusing `src/lib/rate-limit.ts`:
`change` 5/15 min, `verify` 20/10 min, `resend` 6/15 min, `email-check` 20/10 min.

## 7. Rollout

The risk is that this migration changes two live functions that are already in
use. Sequence:

1. Apply the migration.
2. Probe `check_email_available` read-only against production.
3. Confirm `create_organization` now refuses a taken address.
4. Confirm normal organization creation still works end to end.
5. Only then deploy the app code, and re-run the F1 regression.

Nothing runs against production without asking first.

Expired `email_changes` rows are cleaned **opportunistically**: `begin_email_change`
marks anything older than 7 days `expired` when it is called. The project has no
cron and no scheduler, and this matches how the rest of the codebase treats
housekeeping.

## 8. Testing

The repository has no test framework, so verification is script-based, as
carried out for the previous migrations.

SQL level - reason-code matrix: free / `active` / `pending` / `suspended` /
claimed by a pending change, plus `same_email` and malformed input.

Live E2E: begin -> assert the row and that no code leaked to the client -> wrong
code -> assert `otp_attempts` moved -> right code -> assert the address swapped
-> assert the founding member row followed -> assert the other sessions are gone
and the current one survives -> assert the old address is registrable again
-> assert a second change to the same address is refused -> cancel path ->
resend cap -> purge.

Regression: the F1 founding-member check, and that a taken address at
`/create` no longer leaves an organization behind.

## 9. Housekeeping

- `README.md` is already stale - it lists four migrations and omits 004. It must
  list 000 through 005, and document the new rate-limit buckets and the reason
  codes.
- `smartgov.refresh_invite_status` is dead code with no caller, and
  `account_status = 'suspended'` was unreachable until this change gives it a
  message. Neither is in scope here, but both are now visible.

## Out of scope

- Supabase `auth.users` mirroring or closure of the `signUp` surface.
- A password-change flow, which would want the same re-auth treatment.
- Session management UI (list and revoke devices).
- Any `suspended` write path; the status is only ever read.
