# Add campus/department first, then invite LSG officers

**Status:** Approved — implement

**Architecture:** The USG owner dashboard becomes units-first. Today the dashboard invites a person by free-text campus and a unit-type select, and the org chart — which lives on real `public.governance_units` rows — cannot add a unit after setup: `create_organization` writes the tree at signup and the org-chart page only adds *positions*. The owner of a USG created with the legacy one-`usg`-row shape therefore has zero child units and no way to scope an officer to one. This change adds the missing write — an owner-only `add_unit` — and points the dashboard invite form at real units instead of free text. An invited officer needs no position seat ("LSG and USG lang"): the seat-less invite fills a membership with a null position, and existing `unit_chart` visibility rules scope the new account to that one unit, which is their LSG dashboard. The hardened invite → mailed link → OTP → `accept_invite` flow is reused untouched.

The invite gear already has the two paths the change is built on: `create_invite(…, p_unit_id, p_position_id)` (seat-filling, used by the org chart) and `create_invite` with null ids (org-wide, used by the dashboard). `unit_chart` on an owner already aggregates every unit, so no new read is designed — the dashboard reuses `unit_chart` to list units for the invite dropdown and the add-first gate.

## Migration `20260101001400_add_unit_and_seatless_invites.sql`

**Make `smartgov.unit_memberships.position_id` nullable.**

- An LSG officer is a member of a unit without holding any seat, so the membership row cannot require a position.
- The two partial unique indexes already tolerate NULLs (Postgres treats NULL as distinct in a unique index), so multiple seat-less LSG officers in one unit are allowed, and `unit_memberships_one_active_person_per_unit` remains per-person. No index change is needed.

**New `smartgov.add_unit(p_session_token text, p_name text, p_unit_type text) → jsonb`** + `public.add_unit` wrapper:

- `security definer`, pinned `search_path = public, extensions, smartgov, pg_temp`.
- `authenticate`; `unauthenticated` / `no_organization` mirrors in `create_invite`'s shape.
- Owner proof is the founding `public.organization_members` row (`is_founding` matching email), the same check `add_position` uses; otherwise `forbidden`.
- Validates `p_name` non-empty (`invalid_name`), and `p_unit_type` ∈ `college`, `campus`, `department` (`invalid_type`) — the cast goes through the enum so a value the enum lacks fails the transaction.
- Duplicate name within the org → `duplicate_unit_name` (btrimmed, case-insensitive comparison against existing `governance_units.name` for the org).
- Resolves the org's `usg` root (`parent_id is null`); inserts a `governance_units` row under it with the caller's name and unit type. No seats are enabled — a new unit renders in the org chart as "No positions enabled for this unit yet," which is the intended "LSG and USG lang" posture.
- Rate-limited with `consume_rate_limit` (per-session and global buckets), matching the org-chart write posture.
- Returns `{ ok: true, unitId, name, unitType, parentId }`.

**Relaxed `smartgov.create_invite`** (drop and recreate the six-argument form, and re-create the `public` wrapper with the same defaults):

- Current rule — `(p_unit_id is null and p_position_id is not null) or (p_unit_id is not null and p_position_id is null)` → `invalid_request` — narrows to forbid position-without-unit only. A unit id with a null position is the seat-less LSG invite.
- Unit ownership is still enforced (`governance_units.id` in the caller's org → else `not_found`).
- Seat checks move inside the position-present branch: `seat_not_enabled` when no `unit_positions` row, `seat_occupied` when an active (null `end_date`) membership holds the seat. For a seat-less invite these checks are skipped.
- The insert still writes invite + roster row + a `unit_memberships` row; for a seat-less invite the membership's `position_id` is null.
- All other contracts (`already_registered`, per-session and per-address rate limits, revoke of prior pending invites for the same address, the unique-violation → `seat_occupied` handler) stay as-is.

**`accept_invite` unchanged** — it links `roster.account_id` by email. A seat-less LSG officer's `unit_chart` returns `scope: "unit"` (visibility is driven by the membership row, not by having a position), so the post-activation redirect to `/my-council` is the officer's LSG dashboard.

**PostgREST surface:** `public.add_unit(text, text, text)` one-line wrapper + `revoke`/`grant` pattern, and the re-created `public.create_invite(text, text, text, text, uuid, uuid)`. No policies; the zero-policy contract holds.

## API routes

### `src/app/api/units/route.ts` (new)
- `runtime = "nodejs"`.
- **`POST`**: owner-gated (`currentAccount` + `accountScope === "owner"`), IP rate-limit (30 per 10 min, mirroring the invite routes), body `{ name, unitType }`. Calls `add_unit(session_token, name, unitType)`; maps `reason` via `messageFor`. Returns `{ ok: true, unitId, name, unitType }`.
- **`GET`**: reads the session token, calls `unit_chart`, returns `{ ok: true, root, units }` (the owner's whole chart — root excluded in the client, since the dropdown lists child units only).

### `src/app/api/invites/route.ts` (modified)
- `POST` body gains `unitId?`. When present, pass `p_unit_id = unitId` and no position; the free-text `campusName` / `unitType` are dropped for that invite (the actual unit's data comes back from the RPC). When absent, behavior is unchanged (org-wide invite).
- The response keeps `email` for the mailer; the mail template is unchanged.

### `src/lib/auth/messages.ts` (modified)
- Add `duplicate_unit_name` and `invalid_name` / `invalid_type` reason→message entries.

## Dashboard UI (`src/components/dashboard/Workspace.tsx`, USG/decentralized variant)

- New owner-only **"Add a campus / department"** panel at the top of the owner workspace: text input (name), a type select (College / Campus / Department), and an Add button. On success it clears the fields and refetches the unit list.
- The invite form becomes **Email + a unit dropdown** (the child units returned by `GET /api/units`, root excluded). The free-text "Campus or unit" field and the "Unit type" select are removed.
- **Empty state:** with zero child units the invite section renders "Add a campus or department first" instead of the form, and the send button is withheld — the units-first gate.
- The invitation feed table is unchanged.
- Centralized (`central` variant) workspace is unchanged: a unitary org's units are not a tree under a USG, and this design is scoped to the decentralized USG owner.
- The org-chart page is untouched; newly added units simply appear there because it reads `unit_chart`, and their empty seats render as "No positions enabled yet."

## Out of scope
- Invite accept, email templates, and the OTP flows — unchanged.
- The org-chart position/seat machinery — unchanged for owners who use it.
- Existing pending invites (currently 2) — org-wide invites, unaffected, not deleted.

## Constraints
- Owner authority is proven server-side (account scope) and inside each `security definer` function (founding member + username check). No organization id is read from a request body.
- Session tokens are never written to the response; the raw invite token still goes only to the invitee's mailbox via `sendBranded`.
- Unit type validation rejects anything the `public.unit_type` enum lacks, in the database, so a client cannot invent a tier.