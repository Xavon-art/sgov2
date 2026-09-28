# Password reset with an emailed OTP

**Status:** Approved — implement

**Architecture:** The login page grows a "Forgot password?" path. A registrant types their email, the server mints and emails a six-digit OTP, and the same page swaps to an OTP + new-password form. A correct code changes the password and revokes every existing session — a changed password is worthless while a stolen session still holds the account, so the reset signs everything out. No user enumeration: the `forgot-password` response is identical whether or not an account exists, and the database distinguishes only inside the security-definer function, never on the public surface.

This is the third OTP flow (invite verification, owner registration approval, now password reset). It differs from the others in one structural way: there is no token to key on. The two earlier flows carry a raw token (`invite_token`, `verifyToken`) that only the intended mailbox ever sees; a reset request is addressed by email alone, so the reset state must live on the account.

**Decision: a dedicated `smartgov.password_resets` table, not the `accounts.otp_*` columns.** The `accounts.otp_hash` / `otp_expires_at` / `otp_attempts` columns are already in use for the invite-activation and owner-registration flows, and reuse would let two simultaneous OTPs fight over one slot. A reset row holds its own budget the way `invites` rows do. RLS stays zero-policy; every write is a `security definer` function.

## Migration `20260101001200_password_reset.sql`

**Table** `smartgov.password_resets`:

| column | note |
| --- | --- |
| `id uuid pk` | |
| `account_id uuid` → `smartgov.accounts (id) on delete cascade` | one row per reset, keyed on the account |
| `otp_hash text` | HMAC of the code, like every stored code |
| `otp_expires_at timestamptz` | |
| `otp_attempts smallint not null default 0` | five per code |
| `otp_resends integer not null default 0` | lifetime budget for the reset row |
| `otp_last_sent_at timestamptz` | two-minute cooldown |
| `created_at timestamptz not null default now()` | |
| `completed_at timestamptz` | set when a correct code lands |

Indexes: `password_resets_account_idx on (account_id)`; partial `password_resets_active_idx on (account_id) where completed_at is null` so at most one live reset exists per account.

**`smartgov.begin_password_reset(p_email text, p_otp_hash text, p_ttl_minutes integer default 15) → boolean`**

- `security definer`, pinned `search_path`.
- Resolves the account by `lower(email)`; only `status = 'active'` accounts may reset (a `pending` account has no password yet and is served by the invite/owner flows).
- No account → returns `false`. The caller (the route) turns that into the same "we have emailed a code if an account exists" response, so the endpoint cannot be used to probe for registered addresses.
- Upserts the active reset row: an existing row on this account (cooldown permitting) is reused so re-sending means re-minting, not piling rows; otherwise a fresh row is inserted with `otp_attempts = 0`.
- Enforces `otp_resends <= 5` for the row's life and the two-minute `otp_last_sent_at` cooldown, mirroring `set_otp`. Expired rows are swept by the upsert: a reset past its `otp_expires_at` no longer counts against the resend budget.
- Writes the new `otp_hash` / `otp_expires_at` (clamped 1..60 minutes, default 15).

**`smartgov.complete_password_reset(p_email text, p_code_hash text, p_new_password text) → jsonb`**

- `security definer`, pinned `search_path`.
- Resolves the active account by `lower(email)` and the active (incomplete, non-expired) reset row `for update`, so concurrent guesses cannot both read the remaining budget.
- Per-account verification budget `consume_rate_limit('password-reset:verify:' || account_id, 20, interval '15 minutes')`.
- `otp_expired` when the stored code has lapsed; `too_many_attempts` at five; `otp_mismatch` else, each wrong guess incrementing `otp_attempts` and reporting `attemptsLeft` (mirroring `verify_owner_otp`).
- `weak_password` for a new password under 8 characters, before anything is consumed.
- On a match: `accounts.password_hash = hash_password(p_new_password)` (hashing happens inside the function, exactly like `accept_invite`; the plaintext never reaches an app layer), `delete from smartgov.sessions where account_id = …` (revoke every session), mark the reset row completed, and clear its OTP fields.

**PostgREST surface:** `public.begin_password_reset(text, text, integer)` and `public.complete_password_reset(text, text, text)` — one-line `sql security definer` wrappers, each followed by its own `revoke … from public`, then `grant execute … to anon, authenticated`. New `smartgov` originals are revoked from public inline where they are defined, same as 01100 (`20260101001100_owner_otp_approval.sql`). No policies anywhere — the zero-policy contract holds.

## Routes

### `src/app/api/auth/forgot-password/route.ts` (new)
- `runtime = "nodejs"`.
- `IP_LIMIT = 6 per 15 min` per IP, mirroring `resend-owner-code` — each call mints a fresh passcode and spends a real delivery.
- Body `{ email }`. Calls `begin_password_reset(email, hmacOtp(otpCode()), 15)`.
- `true` → send `passwordResetEmail`; a transport failure returns `{ ok: true, code: "email_failed" }` so the UI can prompt a retry **after** the next cooldown, never an enumeration signal.
- `false` → return `{ ok: true }` without minting or sending (the row write is what tells us the account is real; skipping the mint keeps a probe from even spending random bytes).
- Response shape is `{ ok: true }` in both cases — the caller cannot distinguish "no account" from "code going out."

### `src/app/api/auth/reset-password/route.ts` (new)
- `runtime = "nodejs"`.
- `IP_LIMIT = 20 per 15 min` per IP, matching `login`.
- Body `{ email, code, newPassword }`. Calls `complete_password_reset(email, hmacOtp(code), newPassword)`.
- On success `{ ok: true }` — the password is changed, sessions are revoked, and the page returns to the sign-in form.
- Errors map through `messageFor` (`otp_expired`, `otp_mismatch`, `too_many_attempts`, `weak_password`, `rate_limited`, `invalid_request`); a masked email is returned for the success notice.

## Client — `src/app/login/page.tsx`

`Phase = "login" | "reset" | "done"`. The "Forgot password?" link under the password field swaps to the reset form; a back link returns to sign-in.

- **Reset step (email):** one `TextField`. On submit POSTs `/api/auth/forgot-password`, then shows the canned line ("If an account exists, we emailed a code.") — never a per-address verdict. A `code: "email_failed"` response shows the retry hint.
- **Reset step (code + new password):** the OTP input (numeric, `autoComplete="one-time-code"`, `maxLength 6`, same tracking styling as the success step) plus a new-password `TextField`; `OTP_MINUTES` copy and the same 30-second resend cooldown as the owner flow. POSTs `/api/auth/reset-password`; on success sets `done`.
- **Done step:** "Password changed" with a button back to the sign-in form.

The OTP control is small enough to inline in this one page, so no new shared component is extracted.

## Email — `passwordResetEmail` in `src/lib/mail/templates.ts`

A new template reusing the `shell` / `eyebrow` / `heading` / `paragraph` primitives and the deep-navy code block from `otpEmail`: header tone **"Password reset"**, a large tracked six-digit code, "Expires in 15 minutes", and a note that only the person holding the inbox can act on it. Text fallback lists the code. `esc()` on every interpolated value, as always.

## Not doing

- No reusable reset links — the code-email already proves the mailbox; a link token would add nothing.
- No password-strength meter beyond the existing 8-character floor, and no "current password" check — that is what the emailed code is for.
- No cap on total resets per account over time: the per-reset budget, verification budget, and route IP limits already bound the damage, and a hard lifetime quota would lock a real user out of their own recovery.

## Deploy (user-run, in order)

1. Apply `supabase/migrations/20260101001200_password_reset.sql` in the Supabase SQL editor (with `20260101001000_list_roster.sql` and `20260101001100_owner_otp_approval.sql`, still pending).
2. Nothing environment-specific beyond the SMTP variables the site already needs.

## Verification (this repo)

- `npm run check:units` gains a section asserting the 01200 contract: table + indexes exist, `begin_password_reset` only touches `status = 'active'`, resend cap and cooldown, `complete_password_reset` revokes sessions and re-hashes, the new functions are hardened and the wrappers are granted to `anon, authenticated`, and no policy is created.
- `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm run check:federated`, `npm run check:reveal` all stay green.