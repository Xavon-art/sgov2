# Owner email verification before approval

Date: 2026-09-29
Status: Approved — implement

## Problem

The `/create` wizard currently calls `create_owner_account`, which writes the owner
account straight to `'active'`. Owners skip the OTP verification that invited
accounts already pass through (`set_otp` / `verify_otp`), so a USG registration
is approved the moment a wizard finishes — before its email is proven to belong
to the person registering.

The request: during USG registration the system must email an OTP first, and
only activate the account once it is verified. Both "before approval, send OTP"
and "approval = email verification" were confirmed; the notification goes to the
registrar on the website and by email.

## Chosen design

The invited flow already supplies every building block. The owner flow is made
to use the same machinery instead of new infrastructure:

1. `create_owner_account` writes the account as **`pending`** (not `active`),
   and returns a one-time **`verifyToken`** — 24 random bytes, hex, returned
   once to the caller. Only `sha256(verifyToken)` is stored (new
   `accounts.verify_token_hash` column), matching how invite and session tokens
   are stored.
2. The `/api/auth/register` route, on success, mints an OTP with
   `otpCode()`, stores its HMAC via a new **`set_owner_otp(verifyToken, hash,
   ttl)`** RPC, and emails the code (`otpEmail`). It no longer mints a session
   cookie — the account is `pending`, so `login_account` would refuse it anyway.
3. The success page redirects the user to a new **`/create/verify`** step where
   they enter the emailed code. A new **`verify_owner_otp(verifyToken,
   codeHash)`** RPC activates the account only on a correct code (5-attempt
   ceiling per code, same as invites).
4. On success the verify route marks the account active, sends the **approval
   email**, and logs the user in by re-running `login_account` (the existing
   session path — no new session-minting RPC), landing on the dashboard with a
   **"Your USG has been approved"** callout.

`login_account` already refuses `pending` accounts (`account_pending`), and
`currentAccount`/`resolve_account` only resolve `active` sessions, so a
half-verified owner cannot reach any app surface.

## Security posture

- The OTP comparison happens in Postgres against the stored **HMAC** (peppered
  server-side); the code never crosses to the DB in plaintext.
- `verifyToken` is returned once to the registrant and never emailed — unlike an
  invite token there is no link to send. Its SHA-256 is the only thing stored,
  so a database dump cannot be replayed to verify an account.
- OTP attempts are capped at 5 per code, mirroring `verify_otp`; resends are
  metered by the same per-account `otp_resends` / `otp_last_sent_at` columns the
  invites table already has, so a mailbox cannot be used as an amplifier. Route
  handlers add IP-level rate limits (`register`, `verify-owner`,
  `resend-owner-code`).
- New RPCs get thin `public` wrappers and explicit `grant execute` entries,
  keeping the reachable surface exactly the allowlist in 00300.
- `create_owner_account` keeps its existing hardening: founder check,
  per-email registration rate limit, email-taken check. Only the final `status`
  and the returned payload change.

## Migration 01100 — `20260101001100_owner_otp_approval.sql`

- `alter table smartgov.accounts add column verify_token_hash text;`
- `alter table smartgov.accounts add column otp_resends integer not null default 0;`
- `alter table smartgov.accounts add column otp_last_sent_at timestamptz;`
- replace `smartgov.create_owner_account` (same signature) to insert `pending`
  and return `verifyToken` + `organizationName` / `campusName` context for the
  OTP email.
- new `smartgov.set_owner_otp` — mirrors `set_otp` but keyed on
  `verify_token_hash`; enforces 5-resend ceiling and 2-minute cooldown.
- new `smartgov.verify_owner_otp` — mirrors `verify_otp` but keyed on
  `verify_token_hash`; activates on correct code, clears OTP + verify token.
- `account_workspace` returns `recentlyApproved` (owner scope, `activated_at`
  within 15 minutes) so the dashboard can show a one-shot static banner.
- public wrappers `public.set_owner_otp(text, text, integer)` and
  `public.verify_owner_otp(text, text)` with matching `grant execute` lines.

## Routes

- `src/app/api/auth/register/route.ts` — create pending account, mint + store
  OTP, email it; return `{ ok, verifyToken, email, organizationName }`. No
  session cookie.
- `src/app/api/auth/verify-owner/route.ts` (new) — verifies the code, marks
  active, sends the approval email, re-runs `login_account` to mint the session,
  sets the cookie. Returns account/workspace for the redirect.
- `src/app/api/auth/resend-owner-code/route.ts` (new) — mints + emails a fresh
  OTP for a still-pending `verifyToken`.

## Client

- `src/lib/submit.ts` — `registerAccount` returns `verifyToken` + masked email
  (no `ok:true`-only contract).
- `src/components/auth/OtpVerify.tsx` — generalised to accept a `flow:
  "invite" | "owner"` so the entry/resend UI is shared (invite keeps logging the
  user out; owner logs in on success).
- `src/app/create/success/page.tsx` — after registration succeeds, transitions
  to the owner-verify entry inline (or redirects to `/create/verify`); the
  StepShell-step `success` remains the terminal step.
- `src/app/dashboard/page.tsx` — renders the `recentlyApproved` callout.

## Not doing

- No admin/moderation approval — OTP verification is the approval gate.
- No persistent notification table / bell — a static one-shot banner plus email.
- No Supabase Realtime — pages refresh via the existing route + revalidation.

## Verification

- `npm run tsc`, `npm run lint`, `npm run build`.
- `npm run check:federated`, `npm run check:reveal`, `npm run check:units`.
- Migration `20260101001100_owner_otp_approval.sql` applied by the owner against
  the live project DB; then end-to-end: register → OTP email arrives → wrong
  code ×5 locks the account → correct code activates → dashboard callout.