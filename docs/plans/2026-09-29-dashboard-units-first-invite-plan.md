# Dashboard units-first invite Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let a USG owner add a campus/department (a real `governance_units` row under their USG root) from the dashboard, then invite an LSG officer into that unit by email — no position seat required — who activates via the existing mailed-link + OTP flow and lands in their unit-scoped LSG dashboard.

**Architecture:** A new owner-only `add_unit` RPC writes child `governance_units` rows; `create_invite` is relaxed so a unit id without a position is valid (roster + null-position membership); `unit_memberships.position_id` becomes nullable. `unit_chart` already scopes a non-owner account to its membership's unit, so accept/activation is untouched. Two new/updated API routes (`/api/units`, `/api/invites`) and one client component (`Workspace.tsx`) wire it to the UI. No positions, no seats, no org-chart changes.

**Tech Stack:** Next.js 16 (App Router, server + client components), Supabase Postgres (pg_statements-style `security definer` PL/pgSQL RPCs over PostgREST), Supabase CLI for migrations, existing `scripts/check-*.mjs` contract guards, direct `pg` node scripts for behavioral tests.

---

## Background the implementer must know

- Connect string / password / Supabase project used for `supabase db push` and for direct `pg` scripts: the same ones every prior migration used. The pooled URL is `postgresql://postgres.qyatedebfmupzntcltru:<url-encoded-password>@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres` and the password is the `@01`-terminated one already in use. These are secrets — never commit them; read them from the shell env or `.env` as prior sessions did. Supabase CLI version in use is 2.106.0.
- `public.unit_type` enum currently `('usg', 'lsg', 'college', 'campus', 'council')` plus `'department'` (added by 00500).
- Postgres treats NULLs as distinct in a unique index, so the two partial indexes on `unit_memberships` already tolerate many null-position memberships; no index change needed.
- Read the pattern files below before writing any code:
  - `supabase/migrations/20260101000900_roster_invites.sql` — full `create_invite`/`accept_invite` to be modified.
  - `supabase/migrations/20260101000800_unit_chart_functions.sql` — `add_position` for the owner-proof + rate-limit pattern and the `public`-wrapper ceremony; `unit_chart` for scope semantics.
  - `src/app/api/org-chart/position/route.ts` — the exact route shape to copy for `/api/units`.
  - `src/components/dashboard/Workspace.tsx` — the component to modify.
  - `server` gate: `canManageChart` (`src/lib/auth/session.ts:105`) is `accountScope === "owner" && organizationId`. `currentAccount()` only resolves `active` accounts.
- No unit-test framework exists. Verification is: contract guard script (`node scripts/check-units.mjs`), DB behavioral tests via a one-off `pg` script inside a rolled-back transaction, then `npm run lint`, `npx tsc --noEmit`, `npm run build`.
- Shell is **PowerShell 5.1** on Windows. No `&&`; chain with `; if ($?) { … }`. Brace-multiline `if` blocks need braces on their own lines.

---

### Task 1: Write the failing contract guards

**Files:**
- Modify: `scripts/check-units.mjs`

Add guards that the feature migration must satisfy. Read the file first — it slices function blocks with regex and asserts hardening clauses (`security definer` + `set search_path` + `revoke … from public`), and it already imports `m5…m12`. Add `m13` (OTP) and `m14` (this feature) via `readMigration`, and append section **12** before the final `console.log` summary:

```js
const m14 = readMigration("20260101001400_add_unit_and_seatless_invites.sql");
```

Section 12 assertions (each one line, matching the file's existing style — `check("label", cond, detail)`):

```js
// --- 12. Dashboard units-first invites ---
const m14Flat = flat(m14);
const addUnit = functionBlocks(m14).find((b) => b.name === "smartgov.add_unit")?.body ?? "";
const relaxedInvite = functionBlocks(m14).find((b) => b.name === "smartgov.create_invite")?.body ?? "";
const relaxedFlat = flat(relaxedInvite);

check("001400 drops the NOT NULL on unit_memberships.position_id",
  /alter table smartgov\.unit_memberships\s+alter column position_id\s+drop not null/.test(m14Flat));
check("001400 creates smartgov.add_unit", addUnit.length > 0);
check("add_unit proves ownership through the founding-member row",
  /from public\.organization_members m/.test(flat(addUnit)) && /m\.is_founding/.test(flat(addUnit)));
check("add_unit allows only college, campus, department",
  /v_type not in \('college', 'campus', 'department'\)/.test(flat(addUnit)));
check("add_unit rejects duplicate names within the org",
  /duplicate_unit_name/.test(flat(addUnit)));
check("add_unit charges a rate-limit bucket",
  /consume_rate_limit/.test(flat(addUnit)));
check("001400 keeps the six-argument public.create_invite wrapper",
  /create or replace function public\.create_invite\(\s*p_session_token text, p_email text, p_campus_name text, p_unit_type text, p_unit_id uuid default null, p_position_id uuid default null/.test(m14));
check("the relaxed create_invite allows unit without position",
  !/or \(p_unit_id is not null and p_position_id is null\)/.test(relaxedFlat.replace(/--[^\n]*/g, " ")));
check("the relaxed create_invite still forbids position without unit",
  /p_unit_id is null and p_position_id is not null/.test(relaxedFlat));
```

**Step: Run and confirm it fails**

Run: `node scripts/check-units.mjs`
Expected: FAIL — the `001400` checks report `not defined` because the migration does not exist yet.

**Step: Commit**

```bash
git add scripts/check-units.mjs
git commit -m "test: guard the dashboard units-first invite contract"
```

---

### Task 2: The migration `20260101001400_add_unit_and_seatless_invites.sql`

**File:**
- Create: `supabase/migrations/20260101001400_add_unit_and_seatless_invites.sql`

Full file content (comment header first, explaining the "LSG and USG lang" posture and reusing 00900's own wording where the function is unchanged):

```sql
-- The dashboard, units-first: an owner adds a campus or department to their
-- USG, then invites an LSG officer into it. No position seat is involved.
--
-- Until this migration the org chart could not be grown after setup:
-- `create_organization` wrote the tree at signup, and an owner of a USG
-- created with the legacy single-`usg` shape had zero child units and no way
-- to create one. This adds the missing write -- an owner-only `add_unit` --
-- and broadens `create_invite` so a unit id without a position is the
-- seat-less LSG invite rather than an `invalid_request`.
--
-- The scope story stays closed. A membership row drives what `unit_chart`
-- shows a non-owner account: the officer's unit (plus its parent USG) is
-- resolved from `unit_memberships` in SQL, and nothing else is put in the
-- result. `position_id` is made nullable so an LSG officer can *be* in a unit
-- without holding any seat, and the two partial unique indexes already treat
-- NULL as distinct, so many seat-less officers fit in one unit and the
-- one-active-person-per-unit rule is unchanged. `accept_invite`, the mailed
-- link, and the OTP flow are all untouched: the new account verifies exactly
-- like any invitee, and their post-activation `/my-council` view is the LSG
-- dashboard, because `unit_chart` returns `scope: "unit"` for them.

alter table smartgov.unit_memberships
  alter column position_id drop not null;

-- ---------------------------------------------------------------- add_unit

create or replace function smartgov.add_unit(
  p_session_token text,
  p_name          text,
  p_unit_type     text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_name    text := btrim(coalesce(p_name, ''));
  v_type    public.unit_type;
  v_parent  uuid;
  v_unit_id uuid;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  if not exists (
    select 1
    from public.organization_members m
    where m.organization_id = v_account.organization_id
      and m.email = v_account.email
      and m.is_founding
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_name = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_name');
  end if;

  -- Cast through the enum so a type the enum lacks fails the call as
  -- `invalid_type` rather than a raw 22P02 the route would have to reword.
  begin
    v_type := p_unit_type::public.unit_type;
  exception when invalid_text_representation then
    return jsonb_build_object('ok', false, 'reason', 'invalid_type');
  end;

  -- Only the child tiers below the USG root may be added by hand. `usg` and
  -- `council` are the roots, and `lsg` is a scope label, not a tier an owner
  -- would declare under another one.
  if v_type not in ('college', 'campus', 'department') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_type');
  end if;

  if exists (
    select 1
    from public.governance_units gu
    where gu.organization_id = v_account.organization_id
      and lower(btrim(gu.name)) = lower(v_name)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'duplicate_unit_name');
  end if;

  -- The caller's own org binds the parent, like everywhere else in this
  -- schema: no organization id is accepted from the request.
  select gu.id into v_parent
  from public.governance_units gu
  where gu.organization_id = v_account.organization_id
    and gu.parent_id is null
  limit 1;

  if v_parent is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- Charged after validation, before the write, keyed on the account and on a
  -- global bucket so one USG cannot build an unbounded tree in a sitting.
  if not smartgov.consume_rate_limit(
       'unit:session:' || v_account.id::text, 60, interval '1 hour')
     or not smartgov.consume_rate_limit(
       'unit:global', 240, interval '1 hour') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  insert into public.governance_units (organization_id, name, unit_type, parent_id)
  values (v_account.organization_id, v_name, v_type, v_parent)
  returning id into v_unit_id;

  return jsonb_build_object(
    'ok', true,
    'unitId', v_unit_id,
    'name', v_name,
    'unitType', v_type,
    'parentId', v_parent
  );
end;
$$;

revoke all on function smartgov.add_unit(text, text, text) from public;

-- ---------------------------------------------------------------- invites

-- The six-argument form is replaced in place (same signature, so changing it
-- cannot leave a live overload behind), and `public.create_invite` is
-- re-created after it with identical defaults.
create or replace function smartgov.create_invite(
  p_session_token text,
  p_email         text,
  p_campus_name   text,
  p_unit_type     text,
  p_unit_id       uuid default null,
  p_position_id   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account       smartgov.accounts%rowtype;
  v_email         text := lower(trim(coalesce(p_email, '')));
  v_raw           text := encode(extensions.gen_random_bytes(24), 'hex');
  v_unit          public.unit_type := 'lsg';
  v_invite_id     uuid;
  v_org_name      text;
  v_roster_id     uuid;
  v_membership_id uuid;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  if v_email = '' or position('@' in v_email) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_email');
  end if;

  if not smartgov.consume_rate_limit(
       'invite:session:' || v_account.id::text, 30, interval '1 hour')
     or not smartgov.consume_rate_limit(
       'invite:email:' || v_email, 5, interval '1 hour') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  if exists (select 1 from smartgov.accounts a where lower(a.email) = v_email) then
    return jsonb_build_object('ok', false, 'reason', 'already_registered');
  end if;

  if p_unit_type in ('lsg', 'college', 'campus', 'council', 'department') then
    v_unit := p_unit_type::public.unit_type;
  end if;

  -- Narrowed from 00900: a unit id with no position is now the seat-less LSG
  -- invite ("LSG and USG lang"). Position without a unit is still meaning-
  -- less -- a seat has to live somewhere -- and stays refused.
  if p_unit_id is null and p_position_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if p_unit_id is not null then
    -- Every id is checked against the caller's own organization before it is
    -- used, exactly as in 00900. When a position is present, the seat checks
    -- apply; when it is absent, the unit standing alone is the invite.
    if not exists (
      select 1
      from public.governance_units gu
      where gu.id = p_unit_id
        and gu.organization_id = v_account.organization_id
    ) or (
      p_position_id is not null
      and not exists (
        select 1
        from smartgov.org_positions op
        where op.id = p_position_id
          and op.organization_id = v_account.organization_id
      )
    ) then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;

    if p_position_id is not null then
      if not exists (
        select 1
        from smartgov.unit_positions up
        where up.unit_id = p_unit_id
          and up.position_id = p_position_id
      ) then
        return jsonb_build_object('ok', false, 'reason', 'seat_not_enabled');
      end if;

      if exists (
        select 1
        from smartgov.unit_memberships m
        where m.unit_id = p_unit_id
          and m.position_id = p_position_id
          and m.end_date is null
      ) then
        return jsonb_build_object('ok', false, 'reason', 'seat_occupied');
      end if;
    end if;
  end if;

  update smartgov.invites
     set status = 'revoked'
   where organization_id = v_account.organization_id
     and lower(email) = v_email
     and status = 'pending';

  insert into smartgov.invites (
    organization_id, email, campus_name, unit_type, unit_id, position_id,
    token_hash, invited_by, expires_at
  )
  values (
    v_account.organization_id, v_email, trim(coalesce(p_campus_name, '')),
    v_unit, p_unit_id, p_position_id,
    smartgov.sha256(v_raw), v_account.display_name, now() + interval '14 days'
  )
  returning id into v_invite_id;

  if p_unit_id is not null then
    insert into smartgov.roster (organization_id, full_name, email)
    values (v_account.organization_id, v_email, v_email)
    on conflict (organization_id, lower(email)) do update
      set email = excluded.email
    returning id into v_roster_id;

    -- position_id is null for the seat-less LSG invite. The partial unique
    -- index on (unit_id, position_id) treats NULL as distinct, so a unit may
    -- hold many seat-less officers; `one_active_person_per_unit` is per
    -- roster_id and is unaffected.
    insert into smartgov.unit_memberships (roster_id, unit_id, position_id)
    values (v_roster_id, p_unit_id, p_position_id)
    returning id into v_membership_id;
  end if;

  select o.name into v_org_name
  from public.organizations o
  where o.id = v_account.organization_id;

  return jsonb_build_object(
    'ok', true,
    'token', v_raw,
    'inviteId', v_invite_id,
    'email', v_email,
    'organizationName', v_org_name,
    'universityName', v_account.university_name,
    'rosterId', v_roster_id,
    'membershipId', v_membership_id,
    'expiresAt', (now() + interval '14 days')
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'seat_occupied');
end;
$$;

revoke all on function smartgov.create_invite(text, text, text, text, uuid, uuid) from public;

create or replace function public.add_unit(
  p_session_token text,
  p_name          text,
  p_unit_type     text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select smartgov.add_unit(p_session_token, p_name, p_unit_type);
$$;

revoke all on function public.add_unit(text, text, text) from public;
grant execute on function public.add_unit(text, text, text) to anon, authenticated;

create or replace function public.create_invite(
  p_session_token text,
  p_email         text,
  p_campus_name   text,
  p_unit_type     text,
  p_unit_id       uuid default null,
  p_position_id   uuid default null
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select smartgov.create_invite(
    p_session_token, p_email, p_campus_name, p_unit_type, p_unit_id, p_position_id
  );
$$;

revoke all on function public.create_invite(text, text, text, text, uuid, uuid) from public;
grant execute on function public.create_invite(text, text, text, text, uuid, uuid) to anon, authenticated;
```

**Step: Run the contract guards**

Run: `node scripts/check-units.mjs`
Expected: all checks pass (`all … checks passed`). If the `or (p_unit_id is not null and p_position_id is null)` negation guard trips, it means the default-argument line still contains the old invalid-request text — ensure that clause was fully removed from the body (the comment mentions the old rule; the guard strips only `--` comments, so write the comment about the narrowed rule with words that do not repeat the exact old boolean literally, or the guard's negative regex may match. Rephrase the inline comment to avoid literally containing `p_unit_id is not null and p_position_id is null`).

**Step: Commit**

```bash
git add supabase/migrations/20260101001400_add_unit_and_seatless_invites.sql
git commit -m "feat: add owner add_unit and seat-less LSG invite"
```

---

### Task 3: Apply the migration to the database

**Step: Push**

Run (from repo root, secrets from shell env as prior migrations did):

```powershell
supabase db push --db-url "$env:SMARTGOV_DB_URL" --password "$env:SMARTGOV_DB_PASSWORD" --yes
```

Expected: migration `20260101001400_add_unit_and_seatless_invites.sql` applies cleanly; `supabase migration list` shows it as local+remote. If the table already exists, the `drop not null` is idempotent; the function DDL is all `create or replace`.

**Step: Verify the surface**

Run: `npx supabase migration list`
Expected: `20260101001400_add_unit_and_seatless_invites` listed as applied.

**Step: Commit (none — nothing in repo changed).**

---

### Task 4: Behavioral tests against the live database

**File:**
- Create (temp, NOT in repo): `C:\Users\JULIUS~1.MAT\AppData\Local\Temp\opencode\units-behavior-test.mjs`

Write a node script in the same style as the existing OTP behavioral test that:
1. Connects with `pg` to the database URL from env.
2. Opens a transaction (`BEGIN`), runs all assertions, then `ROLLBACK` so nothing persists.
3. Creates a scratch org + owner account the way the OTP test did (insert `public.organizations`, `public.organization_members`, and an `smartgov.accounts` owner row via `smartgov.hash_password`), plus a second non-owner account; calls functions exactly as the browser would via the `public.*` wrappers.

Assertions:
- `public.add_unit` as the owner with `'campus'` → `{ ok: true, unitId }`, and the new `governance_units` row has `parent_id` = the USG root and `unit_type = 'campus'`.
- `add_unit` with the same name again → `{ ok: false, reason: "duplicate_unit_name" }`.
- `add_unit` with `unit_type = 'usg'` → `{ ok: false, reason: "invalid_type" }`.
- `add_unit` as the non-owner account → `{ ok: false, reason: "forbidden" }`.
- `public.create_invite(token, 'officer@test.edu', unitName, 'campus', unitId)` (no position) → `{ ok: true, token, rosterId, membershipId }`; assert the `unit_memberships` row has `position_id IS NULL`.
- A second seat-less invite to a different email in the same unit succeeds (NULL-distinct index).
- `create_invite` with `position_id` but no `unit_id` → `{ ok: false, reason: "invalid_request" }`.
- `public.unit_chart(nonOwnerToken)` for the invited-but-not-verified person (link the roster `account_id` by hand to mimic post-verification) → `scope: "unit"` and exactly the invited unit + its parent USG in `units`.

Run: `node C:\Users\JULIUS~1.MAT\AppData\Local\Temp\opencode\units-behavior-test.mjs`
Expected: exit 0, every assertion PASS.

**Step: Commit (none — file is outside the repo).**

---

### Task 5: Message mappings

**File:**
- Modify: `src/lib/auth/messages.ts`

Add three entries to `RPC_MESSAGES`:

```ts
  invalid_name: "Give the campus or department a name before adding it.",
  invalid_type: "That unit type is not one you can add here.",
  duplicate_unit_name: "Your organization already has a campus or department by that name.",
```

**Step: Verify**

Run: `npm run lint`
Expected: PASS.

**Step: Commit**

```bash
git add src/lib/auth/messages.ts
git commit -m "feat: map add_unit reason codes to user-facing messages"
```

---

### Task 6: The `/api/units` route

**File:**
- Create: `src/app/api/units/route.ts`

Full file, modeled on `src/app/api/org-chart/position/route.ts`:

```ts
import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { canManageChart, currentAccount, readSessionToken } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/** Adds judge by hand, not for a bulk import: the 10-minute ceiling matches the invite routes. */
const IP_LIMIT = 60;
const IP_WINDOW_MS = 10 * 60_000;

const MAX_NAME = 120;
const UNIT_TYPES = ["college", "campus", "department"] as const;

type Unit = { id: string; name: string; unitType: string; parentId: string | null };

export type UnitsResponse = RpcResult & {
  root?: Unit | null;
  units?: Unit[];
  unitId?: string;
  name?: string;
  unitType?: string;
};

/**
 * The owner's unit list for the dashboard — one scoped read through
 * `unit_chart`, which is what the org chart already renders. The client
 * drops the root; this endpoint returns it plus all children unchanged.
 */
export async function GET() {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  try {
    const res = await callRpc<UnitsResponse>("unit_chart", {
      p_session_token: token,
    });

    if (!res.ok) {
      return NextResponse.json({ ok: false, message: messageFor(res.reason) }, { status: 403 });
    }

    return NextResponse.json({ ok: true, root: res.root ?? null, units: res.units ?? [] });
  } catch (error) {
    console.error("[units:list]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load your campuses and departments." },
      { status: 500 },
    );
  }
}

/**
 * Adds one campus, college, or department under the caller's USG root.
 *
 * Owner authority is proven twice — as an `accountScope === "owner"` gate
 * here, and again inside `add_unit` via the founding-member row — and no
 * organization id is read from the body.
 */
export async function POST(req: Request) {
  const account = await currentAccount();
  if (!account) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  if (!canManageChart(account)) {
    return NextResponse.json(
      { ok: false, reason: "forbidden", message: messageFor("forbidden") },
      { status: 403 },
    );
  }

  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: { name?: string; unitType?: string };
  try {
    body = (await req.json()) as { name?: string; unitType?: string };
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const limit = rateLimit(`units:create:ip:${clientIp(req)}`, IP_LIMIT, IP_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, reason: "rate_limited", message: messageFor("rate_limited") },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json(
      { ok: false, reason: "invalid_name", message: messageFor("invalid_name") },
      { status: 400 },
    );
  }

  if (name.length > MAX_NAME) {
    return NextResponse.json(
      { ok: false, message: `Keep the name to ${MAX_NAME} characters or fewer.` },
      { status: 400 },
    );
  }

  const unitType = typeof body.unitType === "string" ? body.unitType : "";
  if (!UNIT_TYPES.includes(unitType as (typeof UNIT_TYPES)[number])) {
    return NextResponse.json(
      { ok: false, reason: "invalid_type", message: messageFor("invalid_type") },
      { status: 400 },
    );
  }

  try {
    const res = await callRpc<RpcResult & { unitId?: string; name?: string; unitType?: string }>(
      "add_unit",
      { p_session_token: token, p_name: name, p_unit_type: unitType },
    );

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, reason: res.reason, message: messageFor(res.reason) },
        { status: res.reason === "forbidden" ? 403 : 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      unitId: res.unitId,
      name: res.name,
      unitType: res.unitType,
    });
  } catch (error) {
    console.error("[units:create]", error);
    return NextResponse.json(
      { ok: false, message: "We could not add that campus or department." },
      { status: 500 },
    );
  }
}
```

**Step: Verify**

Run: `npm run lint` then `npx tsc --noEmit`
Expected: both PASS.

**Step: Commit**

```bash
git add src/app/api/units/route.ts
git commit -m "feat: add and list dashboard units"
```

---

### Task 7: Accept `unitId` in the invite route

**File:**
- Modify: `src/app/api/invites/route.ts`

Changes:
1. In `POST`, widen the body type from `{ email?; campusName?; unitType? }` to also carry `unitId?: string` (parse it in the same `req.json()` block and again in the local variable section: `const unitId = typeof body.unitId === "string" ? body.unitId : "";`).
2. In the `callRpc("create_invite", …)` call, pass `p_unit_id: unitId === "" ? null : unitId` (omit `p_position_id` entirely — the default keeps it null). Keep `p_campus_name` and `p_unit_type` as-is; the client sends the selected unit's name and type for the email template and the account's `campus_name`.
3. Update the doc comment above `POST` to note the two shapes: unit-scoped (`unitId`) and org-wide, both reaching the same RPC.

**Step: Verify**

Run: `npm run lint` then `npx tsc --noEmit`
Expected: both PASS.

**Step: Commit**

```bash
git add src/app/api/invites/route.ts
git commit -m "feat: allow unit-scoped dashboard invites"
```

---

### Task 8: The dashboard workspace UI

**File:**
- Modify: `src/components/dashboard/Workspace.tsx`

Changes, preserving the existing design language (StatCard grid, `eyebrow`, `rounded-2xl border border-line bg-paper/70`, `TextField`, `Button`, existing error/success banner classes):

1. **New state** — on top of the existing invites/email state:
   ```ts
   const [units, setUnits] = useState<UnitOption[]>([]);
   const [unitsLoading, setUnitsLoading] = useState(true);
   const [unitName, setUnitName] = useState("");
   const [unitType, setUnitType] = useState("campus");
   const [selectedUnitId, setSelectedUnitId] = useState("");
   const [unitError, setUnitError] = useState<string | null>(null);
   const [unitAdded, setUnitAdded] = useState<string | null>(null);
   ```
   with a local type `type UnitOption = { id: string; name: string; unitType: string };` and `const UNIT_TYPE_OPTIONS = [{ value: "campus", label: "Campus" }, { value: "college", label: "College" }, { value: "department", label: "Department" }];`.
   Remove `campusName`/`unitType` free-text state and the `UNIT_TYPES` constant used by the removed select.

2. **Fetch units** — extend the existing `isOwner` effect (or a second parallel `useEffect` with the same `cancelled` guard) to `fetch("/api/units")` and set `units` to `data.units.filter((u: UnitOption) => u.id !== data.root?.id)` (children only). Set `unitsLoading(false)`.

3. **`onAddUnit`** — `POST /api/units` with `{ name: unitName, unitType }`; on success clear `unitName`, set `unitAdded("Added …")`, refetch units; on failure set `unitError(data.message)`.

4. **`onInvite`** — when a unit is selected, body becomes `{ email, campusName: <selected unit name>, unitType: <selected unit type>, unitId: selectedUnitId }`. Find the selected unit from `units` by id for the name/type.

5. **UI structure** for `isOwner`, inserted above the invite section, a new section:
   ```
   <section id="units">
     eyebrow: "Add a campus or department"   (variant === "usg" ? same : "Add a unit")
     helper: "Create the campus, college, or department first — then you can invite an LSG officer into it."
     form: TextField (name, placeholder "College of Engineering") + select of UNIT_TYPE_OPTIONS + Button "Add campus"
     error/success banners (same classes as invite section)
   </section>
   ```
6. **Invite section replacement** — remove the free-text "Campus or unit" `TextField` and the "Unit type" `select`. Keep the Email `TextField`. Add a `select` for the unit choice, populated from `units` (`<option value="">Choose a campus or department…</option>` then one per unit). Disable the submit `Button` when `!selectedUnitId`. When `units.length === 0 && !unitsLoading`, replace the form (or the form's lower half) with the empty-state paragraph: `"Add a campus or department first — until then there is no unit to invite someone into."` and render no send button.

**Step: Verify**

Run: `npm run lint` then `npx tsc --noEmit`
Expected: both PASS (no unused imports; `UNIT_TYPES` removed from use).

**Step: Commit**

```bash
git add src/components/dashboard/Workspace.tsx
git commit -m "feat: units-first dashboard invite flow"
```

---

### Task 9: Build, then E2E against the live site

**Step: Build**

Run: `npm run build`
Expected: production build succeeds, `/api/units` present in the route list.

**Step: Deploy**

Run (token is the Vercel token used for every deploy this project):

```powershell
vercel --prod --token "$env:SMARTGOV_VERCEL_TOKEN" --yes
```

Expected: new production deployment, alias updated to `https://sgov.vercel.app`.

**Step: E2E** (owner session with curl/cookies or a small fetch script that logs in with the owner credentials via `/api/auth/login`, then):
- `GET /api/units` → `ok: true`, `units` array.
- `POST /api/units` with a unique test campus name → `ok: true`, `unitId`; then the same name again → `duplicate_unit_name`.
- `POST /api/invites` `{ email: <test address>, campusName: <test unit>, unitType: "campus", unitId }` → `ok: true`, and the feed `GET /api/invites` shows the row with the campus name.
- `GET /api/units` still returns the newly added unit; the dashboard dropdown renders it.

**Step: Clean up the test unit** (delete via SQL: `delete from public.governance_units where name = '<test name>'` — cascades to the invite/membership) so production data stays as the user expects.

**Step: Commit (if any local changes)**
```bash
git status
git add -A
git commit -m "chore: deploy dashboard units-first flow"
```

---

## Verification summary

- `node scripts/check-units.mjs` — green (Tasks 1, 2 dialect guards).
- DB behavioral script — all assertions pass inside a rolled-back transaction (Task 4).
- `npm run lint`, `npx tsc --noEmit`, `npm run build` — green after every code task.
- Live E2E on `https://sgov.vercel.app` — add → duplicate-refused → invite → appears in feed (Task 9).

## Notes / risks
- The contract guard strips `--` line comments before negative matching; do not restate the old `invalid_request` boolean verbatim in a comment in `create_invite`, or the negation assertion can misfire. Phrase it as "a seat has to live somewhere."
- `governance_units` has no unique constraint on name; the duplicate check is function-level only, which is correct (names are per-org, case-insensitive, and the function is the only writer besides `create_organization`).
- Do not touch `accept_invite`, the OTP routes, or the org-chart pages — this plan deliberately changes neither; verify none of them are in your diff.
- Leave the two existing pending invites (`markisgone24@gmail.com`, `juliusmatro02@gmail.com`) untouched.