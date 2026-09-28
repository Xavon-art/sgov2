# Design — Owner invite actions: cancel + resend (dashboard)

Date: 2026-09-29
Status: Approved
Scope: Owner dashboard invitation table — both `usg` and `central` variants.

## Problem

The owner dashboard lists invitations but offers no way to act on them. An
owner cannot stop a link they no longer want sent, and cannot re-deliver a
welcome email when it was lost to spam or a typo'd inbox. The table also shows
an `Activated` date column that no dashboard action feeds, and the add-unit
button always reads "Add campus" even when a College or Department is selected.

## Decisions (confirmed with the owner)

1. **Cancel = revoke.** The invite row's `status` becomes `revoked`. It vanishes
   from the dashboard (`.list_invites` already filters `status <> 'revoked'`);
   the row stays in the database for the audit trail; the mailed link stops
   working immediately because `accept_invite_probe` rejects any
   `status <> 'pending'`. Idempotent for an already-revoked row.
2. **Resend = fresh link, same invite.** A new session-like raw token is minted
   (only its SHA-256 is stored, so the original raw token can never be
   re-sent — the old link must die regardless). The invite row keeps its
   `status = 'pending'`, its `expires_at` is re-extended to `now() + 14 days`,
   and the standard welcome/invite email is re-delivered with the new link.
   `pending` and `expired` invites are resendable; `activated` is refused.
3. **Confirm is inline, not a modal.** Clicking Cancel turns the action cell
   into a two-button confirm ("Yes, cancel / Keep") with the caption
   "The link will stop working immediately." No dialog infrastructure is added.
4. **Button label tracks the selected type.** "Add campus" becomes
   `Add {Campus|College|Department}` from the selected add-unit type.

## Architecture

### Database — migration `20260101001500_invite_cancel_and_resend.sql`

Two owner-only functions in `smartgov`, each with a thin `public` forwarder
(from `revoke all`/`grant execute` pattern established for `add_unit`):

- `smartgov.revoke_invite(p_session_token text, p_invite_id uuid) returns jsonb`
  - `authenticate()`; null -> `unauthenticated`; `account_scope <> 'owner'` ->
    `forbidden`.
  - `update smartgov.invites set status = 'revoked' where id = p_invite_id
    and organization_id = v_account.organization_id
    and status <> 'activated'` (activated -> `invite_activated`).
  - Zero rows updated -> distinguish: invite exists but other-org/activated ->
    `not_found` / `invite_activated`; already `revoked` is a no-op `ok`.
  - Returns `{ ok, inviteId }`.
- `smartgov.resend_invite(p_session_token text, p_invite_id uuid) returns jsonb`
  - Same auth + owner gate. Invite scope by caller org.
  - `status` must be `pending` or `expired`; `activated` -> `invite_activated`;
    missing/other-org -> `not_found`.
  - Mint `v_raw = encode(gen_random_bytes(24), 'hex')`; update
    `token_hash = sha256(v_raw)`, `expires_at = now() + interval '14 days'`,
    `status = 'pending'`.
  - Returns `{ ok, token: v_raw, inviteId, email, campusName, organizationName,
    universityName }` (campus/org names read from the invite row and the
    owner's account so the mail layer needs no second lookup).

### API routes

- `src/app/api/invites/resend/route.ts` — `POST { inviteId }`.
  - `readSessionToken` gate; IP rate limit (invite create-style, ~20/10 min, it
    mails); UUID validation on `inviteId` (convention from the create route).
  - RPC -> `sendBranded(inviteEmail({ to, token, organizationName,
    universityName, campusName }))`, same `inviteEmail` template and
    `delivery_failed` branch as `POST /api/invites`.
  - `messageFor` on every reason; 400 on bad row state.
- `src/app/api/invites/cancel/route.ts` — `POST { inviteId }`.
  - Same gates; looser IP limit (~60/10 min, no mail). RPC -> `{ ok }`.

### Dashboard — `src/components/dashboard/Workspace.tsx`

- Table headers: `Email | Campus or unit | Status | Invited | Action`
  (the `Activated` date column is replaced by `Action`).
- `Action` cell:
  - `activated` rows -> `—`.
  - `pending` / `expired` rows -> two icon buttons: **Resend** (`IconMail`) and
    **Cancel** (`IconClose`). Buttons sit in the same row, disabled while a
    request for that `inviteId` is in flight (`busyId`).
  - Cancel -> click toggles an inline confirm in the action cell with a
    "Cancel the invitation?" prompt + "The link will stop working
    immediately." caption + `Yes, cancel` / `Keep` buttons (`confirmId` state;
    `Enter` no-ops, only clicks act).
- Row actions refetch the invites list on success (`fetchInvites()`); the
  cancelled row disappears because it is now `revoked`.
- Success for resend: transient inline note "Invitation re-sent to {masked}."
  Errors: existing `error` banner.
- `Add {Type}` label: `const label = UNIT_TYPE_OPTIONS
  .find(t => t.value === newUnitType)?.label ?? "campus"` ->
  button text `adding ? "Adding…" : \`Add ${label}\``.

### Messages — `src/lib/auth/messages.ts`

- Add `invite_activated: "That invitation has already been activated."`
  (used by both forbid-revoked-activate and forbid-resend-activate paths).

## Testing

- `scripts/check-units.mjs`: new contract guards —
  cancel/resend unauthenticated 401-shape, non-owner forbidden, other-org
  invite `not_found`, activated refused `invite_activated`, revoke makes the
  link dead (probe no longer answers `pending`), resend returns a fresh token
  that probes fine while the old one is dead, resend keeps status `pending`
  with re-extended expiry.
- Behavior test run against the live DB inside a rolled-back transaction
  (pattern from the units suite): synthetic org + invite -> revoke -> probe
  fails; re-invite -> mint -> resend -> old token dead, new token live.
- Live prod E2E (throwaway invite + unit, fully cleaned up): add unit -> invite
  -> cancel -> gone from `/api/invites` list -> resend throws away previously
  missing row -> confirm list absence of crafted artifacts.

## Not in scope

- No owner -> "activated" actions; imported rows are untouched.
- No modal component; no bulk actions.
- No changes to the invitee-side accept/OTP flows (they already honor
  `status <> 'pending'`).