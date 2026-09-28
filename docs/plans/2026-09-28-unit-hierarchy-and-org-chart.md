# Unit Hierarchy and Org Chart Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let a federated USG declare its colleges, campuses, and departments as child units, then staff each one from an editable org chart with custom positions — and prove that an LSG officer can only ever see their own unit.

**Architecture:** Four new tables in the `smartgov` schema (`org_positions`, `unit_positions`, `roster`, `unit_memberships`) sit behind the same policy-free RLS posture as everything else, so every read and write goes through a `security definer` function that identifies the caller with `smartgov.authenticate(p_session_token)`. The scoped read is enforced *in the database*: an LSG officer's unit list is filtered by a `where` clause in SQL, never by hiding rows in React, because a client-side filter still ships every unit to the browser.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, zustand (persisted wizard draft), Tailwind, Supabase (Postgres + PL/pgSQL), `supabase` CLI as a migration runner. No test framework — verification is `tsc`, `eslint`, `build`, plus Node assertion scripts, which is the existing convention in this repo.

---

## Before you start

Three things about this repo that will waste your time if you assume otherwise.

**1. There is no test framework, and this plan does not add one.** The repo verifies with `npx tsc --noEmit`, `npx eslint .`, `npm run build`, and static assertion scripts in `scripts/` (`check-federated.mjs`, `check-reveal.mjs`) that read source text and assert on its shape. Where this plan says "write the failing test," it means one of:

- a scratch runtime file run with `node <file>.ts` (Node 26.7 strips types natively — confirmed working), or
- a new assertion block in a `scripts/check-*.mjs` file.

Do not add Jest, Vitest, or Playwright. That is out of scope and YAGNI.

**2. You cannot apply migrations.** `supabase` is on PATH, and the README documents `supabase db push --db-url <connection string>`, but `.env.local` holds only the publishable key, SMTP, and the auth pepper. **The database connection string is not in this repo and you must ask the user for it.** Every task in Part A and Part B ends with a step that says *hand this to the user to run*. Write the migration files and the verification queries; do not try to run them yourself.

**3. Migrations must be applied in filename order, and the CLI tracks what it has run.** Never re-run a migration by hand and then run `db push`, or the CLI will replay a file the database already has.

## Conventions you must not break

- All tables: RLS enabled, **zero policies**, `revoke all ... from anon, authenticated`.
- All access: `security definer` functions, `set search_path = public, smartgov, pg_temp`, `revoke all on function ... from public`.
- The client calls functions with the publishable key. **Authentication lives inside the function** via `smartgov.authenticate(p_session_token)`, not in a Supabase JWT. Do not introduce Supabase Auth.
- Every `smartgov` function needs a one-line `public` wrapper **and an explicit
  `grant execute ... to anon, authenticated`**, or it is unreachable from the
  browser. This is not a convenience. `00200` had
  `grant execute on all functions in schema smartgov to anon, authenticated;`
  and **`00300` revoked it** — `revoke execute on all functions in schema
  smartgov from public, anon, authenticated` — then replaced it with thirteen
  named `public` wrappers, thirteen explicit grants, and
  `revoke all on schema smartgov from anon, authenticated`. PostgREST only
  exposes `public`, so a function in `smartgov` with no wrapper fails with
  PGRST202 and the route handler 500s. A function that is correct, tested, and
  unreachable has not shipped.
- A new table has the same rule at the table level: RLS on, zero policies,
  `revoke all on table ... from anon, authenticated`.
- The federated USG-only invariant must stay green: `npm run check:federated` is 19/19 today.

---

# Part A — Schema

All of Part A needs the user's database. Write the files, then hand them the command.

### Task 1: Worktree and the lint trap

**Files:**
- Modify: `eslint.config.mjs` (add one ignore)
- Create: worktree `feature/unit-hierarchy`

**Step 1: Read the ESLint config and add the worktree ignore**

The previous feature hit this exact failure: `npx eslint .` traversed a gitignored worktree, hit `.next/build/chunks/*`, and died with `eslint: 1`. It is latent, not gone — the next worktree recreates it.

Add to the `ignores` array in `eslint.config.mjs`:

```js
".worktrees/**",
```

**Step 2: Verify lint is still clean**

Run: `npx eslint .`
Expected: exit 0, no output.

**Step 3: Create the worktree**

```bash
git worktree add .worktrees/unit-hierarchy -b feature/unit-hierarchy
```

Work in that directory for the rest of the plan.

**Step 4: Commit**

```bash
git add eslint.config.mjs
git commit -m "Ignore worktrees in the lint flat config

A gitignored worktree is not invisible to a flat config, so eslint walked
into a sibling feature's .next build output and failed on minified chunks.
"
```

---

### Task 2: Add `department` to the unit type enum

**Files:**
- Create: `supabase/migrations/20260101000500_add_department_unit_type.sql`

**Step 1: Write the migration**

`public.unit_type` is currently `usg, lsg, college, campus, council`. This gets its own file because Postgres will not let a migration use a newly added enum value in the same transaction that creates it, and keeping it separate means the failure is isolated and obvious.

```sql
-- A college, campus, or department is a single row that both describes what
-- kind of thing it is and acts as that place's Local Student Government, so
-- `department` joins the existing `college` and `campus` values here rather
-- than becoming a layer above or below them.

alter type public.unit_type add value if not exists 'department';
```

**Step 2: Write the verification query and hand it to the user**

```sql
select unnest(enum_range(null::public.unit_type)) as unit_type;
```

Expected: six rows — `usg`, `lsg`, `college`, `campus`, `council`, `department`.

**Step 3: Commit**

```bash
git add supabase/migrations/20260101000500_add_department_unit_type.sql
git commit -m "Add the department unit type

A USG covers departments as well as colleges and campuses, and a department
is the same kind of thing: one row that is both the place and its LSG.
"
```

---

### Task 3: Create the four tables

**Files:**
- Create: `supabase/migrations/20260101000600_unit_hierarchy_tables.sql`

**Step 1: Write the migration**

```sql
-- ---------------------------------------------------------------- Positions

-- One list of positions per organization, authored by the USG. Every unit
-- draws from this same list, so a USG with 24 units manages 24 seats' worth
-- of labels from one place instead of maintaining 24 separate templates.
create table if not exists smartgov.org_positions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  label           text not null check (length(btrim(label)) > 0),
  sort_order      smallint not null default 0,
  created_at      timestamptz not null default now()
);

-- Case-insensitive, so "Auditor" and "auditor" cannot both be added by two
-- people in the same org chart. It has to be an INDEX, not a table constraint:
-- Postgres rejects an expression inside `unique (...)` with a syntax error at
-- CREATE TABLE, which takes the whole migration down and everything after it.
create unique index if not exists org_positions_org_label_uniq
  on smartgov.org_positions (organization_id, lower(label));

-- Which positions a given unit actually has. This is the seat: a unit that
-- has no Auditor simply has no row here, and no Auditor renders anywhere.
create table if not exists smartgov.unit_positions (
  unit_id     uuid not null references public.governance_units (id) on delete cascade,
  position_id uuid not null references smartgov.org_positions (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (unit_id, position_id)
);

-- ---------------------------------------------------------------- Roster

-- People who exist in the organization without accounts yet. Requiring an
-- account before someone can hold a seat would mean 70 registrations up front,
-- which is not how student organizations actually recruit.
create table if not exists smartgov.roster (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  full_name       text not null check (length(btrim(full_name)) > 0),
  email           text not null check (length(btrim(email)) > 0),
  account_id      uuid references smartgov.accounts (id) on delete set null,
  created_at      timestamptz not null default now()
);

-- Same expression-unique problem as above, and the same fix.
create unique index if not exists roster_org_email_uniq
  on smartgov.roster (organization_id, lower(email));

-- ---------------------------------------------------------------- Membership

-- Who holds which seat, and when. `end_date is null` means current. Replacing
-- an officer closes one row and opens another rather than overwriting, so the
-- record of the previous election survives.
create table if not exists smartgov.unit_memberships (
  id          uuid primary key default gen_random_uuid(),
  roster_id   uuid not null references smartgov.roster (id) on delete cascade,
  unit_id     uuid not null references public.governance_units (id) on delete cascade,
  position_id uuid not null references smartgov.org_positions (id) on delete cascade,
  start_date  date not null default current_date,
  end_date    date,
  created_at  timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);

-- One person, one active seat, per unit. Someone may hold different positions
-- in different units at once; this only stops them holding two in the same one.
create unique index if not exists unit_memberships_one_active_person_per_unit
  on smartgov.unit_memberships (unit_id, roster_id)
  where end_date is null;

-- One seat, one active holder. This is what stops two Treasurers at once, and
-- it is partial so a closed membership does not collide with a closed one.
create unique index if not exists unit_memberships_one_active_holder_per_seat
  on smartgov.unit_memberships (unit_id, position_id)
  where end_date is null;

-- ---------------------------------------------------------------- RLS

-- Policy-free on purpose, matching the rest of the schema. The SECURITY
-- DEFINER functions added in Part B are the only path in or out; a policy
-- here would be a second, weaker door.
alter table smartgov.org_positions    enable row level security;
alter table smartgov.unit_positions   enable row level security;
alter table smartgov.roster           enable row level security;
alter table smartgov.unit_memberships enable row level security;

revoke all on all tables in schema smartgov from anon, authenticated;
```

**Step 2: Write the verification query and hand it to the user**

```sql
-- Expect 4 rows, all with rowsecurity = t, and 0 policies each.
select c.relname, c.relrowsecurity,
       (select count(*) from pg_policies p where p.schemaname = 'smartgov' and p.tablename = c.relname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'smartgov'
  and c.relname in ('org_positions','unit_positions','roster','unit_memberships')
order by c.relname;
```

**Step 3: Commit**

```bash
git add supabase/migrations/20260101000600_unit_hierarchy_tables.sql
git commit -m "Add the unit hierarchy tables

org_positions is the org-level template, unit_positions says which seats a
unit has, roster holds people who need not have accounts, and memberships
are dated so an election cycle does not erase the last one.

The partial unique indexes are the real constraint here: one active holder
per seat, one active seat per person per unit. Without them the database
would happily let two people be Treasurer at once.

RLS is enabled with no policies, same as every other table here, so these
stay reachable only through the SECURITY DEFINER functions.
"
```

---

### Task 4: Write the unit tree in `create_organization`

**Files:**
- Create: `supabase/migrations/20260101000700_create_organization_unit_tree.sql`
- Read first: `supabase/migrations/20260101000400_harden_create_organization.sql`

**Step 1: Read the current function**

Open `00400` and find the `governance_units` insert. It is already a loop, not a
single row: it walks `v_units`, honours a zero-based `parentIndex` per element
by resolving it against the ids it has already inserted, and writes an N-row
tree of arbitrary depth. The bug is not that it writes one row — it is that it
writes whatever the browser described, so the depth, the shape, and the whole
structure of a university are decided by a payload the database cannot check.

Your job is to replace that generality with an enforced depth-1 shape, which is
a deliberate **narrowing**: a federated USG loses the ability to declare a
second level. Say so in the file header, because a later reader who finds
`parentIndex` gone will otherwise assume a regression.

**Step 1b: Read the live payload, and do not break it**

`src/lib/submit.ts` and `src/app/api/organization/route.ts` are the deployed
client and neither has been changed. They send `units: [{ name, unitType }]`,
and for federated that is a single element with `unitType: "usg"`. The key is
`unitType`, not `type`, and a client that only ever sends `type` is a *later*
task (Task 9).

So this migration must be safe to apply on either side of that change, in
either order, with no window where federated signup is broken. If it reads
`type` alone, every federated signup raises 22023 and the whole creation
transaction rolls back. Resolve the per-element type as
`coalesce(v_unit ->> 'type', v_unit ->> 'unitType')`, and treat a federated
payload containing no `college|campus|department` element as the legacy shape:
write only the `usg` root row and do not raise. Once any element does declare a
child tier, validate every element against the allowlist.

That legacy branch is a rollout affordance, not a second permanent contract.
Say exactly that in a comment at the top of the function, and say it should be
deleted once the client only ever sends `type`, or it will be read as a
supported input shape forever.

Leave unitary alone. Its live payload is `unitType: "council"`, which is not in
the `college|campus|department` allowlist, so a unitary call must not be
validated against that set — it is derived from the organization name and the
array is never read.

**Step 2: Write the replacement**

The new version inserts the USG root first so children have a `parent_id` to
point at, then writes one child per declared element, and only when the payload
declares a child tier. `v_units` is already declared in the function; add
`v_root_id uuid`, `v_unit jsonb`, and a boolean recording whether any element
declared a child tier. Unit types are cast through the enum rather than
interpolated, so a value the enum does not contain fails the whole transaction
instead of inserting a row nobody can query, and the validation error should
name the offending array index.

```sql
  -- Federated: the USG row is the root, and every declared college, campus,
  -- or department hangs off it as its LSG. Unit types come from the payload
  -- -- under `type` from the wizard, or `unitType` from the deployed client --
  -- and are cast through the enum rather than interpolated, so a value the
  -- enum does not contain fails the whole transaction instead of inserting
  -- a row nobody can query.
  v_root_id := null;

  if v_model = 'federated' then
    insert into public.governance_units (organization_id, name, unit_type, parent_id)
    values (v_org_id, v_name, 'usg', null)
    returning id into v_root_id;

    -- No child tier declared means the legacy payload: the root alone, no
    -- children, no error. See Step 1b -- this branch is temporary.
    if v_children then
      for v_unit in
        select jsonb_array_elements(coalesce(v_units, '[]'::jsonb))
      loop
        insert into public.governance_units (organization_id, name, unit_type, parent_id)
        values (
          v_org_id,
          btrim(v_unit ->> 'name'),
          coalesce(v_unit ->> 'type', v_unit ->> 'unitType')::public.unit_type,
          v_root_id
        );
      end loop;
    end if;
  end if;
```

Declare `v_root_id uuid;`, `v_unit jsonb;` and `v_children boolean := false;` in
the declare block, and set `v_children` in the validation block above the write
— not here, so that the type validation and the write cannot disagree about
which shape the payload was.

Keep the `if v_model = 'unitary'` branch that inserts the single `council` row
exactly as it is today, and keep the unit-name duplicate check — it should now
also consider the payload's names, so the wizard and the database agree on what
a duplicate is.

**Step 3: Verification query for the user**

```sql
-- Create a federated org with 3 units through the RPC, then:
select gu.unit_type, gu.name, p.unit_type as parent_type
from public.governance_units gu
left join public.governance_units p on p.id = gu.parent_id
join public.organizations o on o.id = gu.organization_id
where o.name = '<the test org you created>'
order by gu.unit_type, gu.name;
```

Expected: one `usg` row with a null parent, three children whose `parent_type`
is `usg`.

**Step 4: Commit**

```bash
git add supabase/migrations/20260101000700_create_organization_unit_tree.sql
git commit -m "Write the unit tree when an organization is created

A federated USG now declares its colleges, campuses, and departments during
the wizard, and those land as children of the USG row inside the same
transaction. Unit type is cast through the enum rather than interpolated,
so an unknown type fails the whole create instead of inserting a unit that
no query can match.
"
```

---

# Part B — Data access

Every function here follows `account_workspace`: `security definer`, `set search_path = public, smartgov, pg_temp`, caller resolved by `smartgov.authenticate(p_session_token)`, revoked from `public`.

### Task 5: The scoped org chart read — the security centrepiece

**Files:**
- Create: `supabase/migrations/20260101000800_unit_chart_functions.sql`

**Step 1: Write `smartgov.unit_chart(p_session_token text)`**

This is the function that makes scoping real, so it is worth reading twice. An LSG officer must not learn the existence of any other unit, so the filter lives in the `where` clause — the rows simply are not in the result set, and no amount of devtools can find them.

```sql
create or replace function smartgov.unit_chart(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
declare
  v_account    smartgov.accounts%rowtype;
  v_is_owner   boolean := false;
  v_unit_ids   uuid[];
  v_result     jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  -- The founder sees the whole organization. The founding-member row written
  -- by create_organization is the proof of authorship, matching the check
  -- create_owner_account already makes; a client-supplied organization id on
  -- its own is not authority.
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = v_account.organization_id
      and m.email = v_account.email
      and m.is_founding
  ) into v_is_owner;

  if v_is_owner then
    select coalesce(array_agg(id), '{}') into v_unit_ids
    from public.governance_units
    where organization_id = v_account.organization_id;
  else
    -- An LSG officer sees their own units plus the USG root above them.
    -- Nothing else is selected, so nothing else exists in the payload. The
    -- parent is in the array, not resolved later from outside it: the `root`
    -- lookup filters on `any(v_unit_ids)`, so a row the filter did not admit
    -- must not be reachable by another route either.
    --
    -- The parent is included ON PURPOSE. It is not a leak -- it is the
    -- officer's own parent org, reached by following `parent_id` from a unit
    -- they already hold a seat in. A sibling shares that parent and is still
    -- not nameable: sibling ids are never in `seated`, and the parent branch
    -- projects one `p.id`, not the parent's subtree. Do not "tighten" this by
    -- dropping the parent; the LSG view is specified to render it.
    --
    -- The `p.organization_id` predicate is load-bearing, not decorative:
    -- `governance_units.parent_id` is a self-reference carrying no
    -- organization, so nothing stops it pointing into another organization.
    with seated as (
      select gu.id, gu.parent_id
      from smartgov.unit_memberships m
      join public.governance_units gu on gu.id = m.unit_id
      join smartgov.roster r on r.id = m.roster_id
      where r.organization_id = v_account.organization_id
        and r.account_id = v_account.id
        and gu.organization_id = v_account.organization_id
        and m.end_date is null
    )
    select coalesce(array_agg(distinct visible.id), '{}') into v_unit_ids
    from (
      select s.id from seated s
      union
      select p.id from seated s
      join public.governance_units p on p.id = s.parent_id
      where p.organization_id = v_account.organization_id
    ) visible;
  end if;

  if not v_is_owner and v_unit_ids = '{}' then
    return jsonb_build_object('ok', false, 'reason', 'no_unit');
  end if;

  select jsonb_build_object(
    'ok', true,
    'scope', case when v_is_owner then 'organization' else 'unit' end,
    'root', (
      select jsonb_build_object('id', gu.id, 'name', gu.name, 'unitType', gu.unit_type)
      from public.governance_units gu
      where gu.id = any(v_unit_ids) and gu.parent_id is null
      order by gu.id
      limit 1
    ),
    'units', (
      select coalesce(jsonb_agg(t.unit order by t.sort_order, t.name), '[]'::jsonb)
      from (
        select
          gu.id,
          gu.name,
          gu.unit_type,
          gu.parent_id,
          coalesce(
            jsonb_agg(
              jsonb_build_object(
                'positionId', up.position_id,
                'label', op.label,
                'rosterId', um.roster_id,
                'fullName', r.full_name,
                'email', r.email,
                'membershipId', um.id,
                'startDate', um.start_date
              )
              order by op.sort_order, op.label
            ) filter (where up.position_id is not null),
            '[]'::jsonb
          ) as seats
        from public.governance_units gu
        left join smartgov.unit_positions up on up.unit_id = gu.id
        left join smartgov.org_positions op on op.id = up.position_id
        left join smartgov.unit_memberships um
          on um.unit_id = up.unit_id
         and um.position_id = up.position_id
         and um.end_date is null
        left join smartgov.roster r on r.id = um.roster_id
        where gu.id = any(v_unit_ids)
        group by gu.id, gu.name, gu.unit_type, gu.parent_id
      ) t
    ),
    'positions', (
      select coalesce(jsonb_agg(
        jsonb_build_object('id', op.id, 'label', op.label, 'sortOrder', op.sort_order)
        order by op.sort_order, op.label
      ), '[]'::jsonb)
      from smartgov.org_positions op
      where op.organization_id = v_account.organization_id
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function smartgov.unit_chart(text) from public;
```

**Step 2: Write the write-side functions in the same file**

Three more, same shape. Keep each one owner-only — an LSG officer has a read-only view in this slice, so every mutation re-checks the founding-member row rather than trusting the caller's word about which org they are in.

- `smartgov.add_position(p_session_token text, p_label text, p_sort_order smallint default 0)` — inserts into `org_positions`, then enables the seat on every existing unit in the org, so a new position is not invisible until someone visits each unit.
- `smartgov.toggle_unit_position(p_session_token text, p_unit_id uuid, p_position_id uuid, p_enabled boolean)` — inserts or deletes the `unit_positions` row. Refuse to disable a seat that has an active holder; that would silently orphan a membership.
- `smartgov.assign_officer(p_session_token text, p_unit_id uuid, p_position_id uuid, p_roster_id uuid)` — closes any active membership on that seat with `end_date = current_date`, then opens a new one. Rejects with `seat_occupied` if a concurrent call already took it, which the partial index will otherwise surface as a raw constraint violation.
- `smartgov.release_officer(p_session_token text, p_membership_id uuid)` — sets `end_date`, deletes nothing.

**Step 3: Publish each one through a `public` wrapper with an explicit grant — not optional**

This is the step that decides whether any of this is reachable from the
browser, and it is the step most easily forgotten. `00300` revoked 002's
blanket `grant execute on all functions in schema smartgov to anon,
authenticated` and replaced it with thirteen named wrappers and thirteen
explicit grants, plus `revoke all on schema smartgov from anon,
authenticated`. PostgREST only exposes `public`. So a function that lives in
`smartgov` and has no wrapper is uncallable: `supabase.rpc("unit_chart", ...)`
returns PGRST202 and the route handler 500s, with no SQL error to explain it.

For each of the five functions — `unit_chart`, `add_position`,
`toggle_unit_position`, `assign_officer`, `release_officer` — add a
one-line forwarder at the bottom of the same file. The wrapper holds no logic,
so it can never be stricter or looser than the function it calls, and it pins
the same `search_path`:

```sql
create or replace function public.unit_chart(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.unit_chart(p_session_token); $$;

revoke all on function public.unit_chart(text) from public;
grant execute on function public.unit_chart(text) to anon, authenticated;
```

Copy the `revoke` / `grant` pair style from
`20260101000300_expose_auth_api_and_hardening.sql:702-714`. Watch the
signature: a wrapper whose parameter names or types do not match the original
creates a *different* function, and the original stays unreachable while the
error looks like nothing at all.

Do not add `authenticate`, `sha256`, `hash_password`, `password_matches`,
`consume_rate_limit` or `refresh_invite_status` to the published surface. The
first resolves a token to a password hash, the next two turn the database into
a free bcrypt oracle, the next spends somebody else's rate-limit budget.

**Step 4: Verification query for the user**

The one that matters — create a USG with two units, an LSG account in unit A,
then:

```sql
select public.unit_chart('<LSG session token>');
```

Call the `public` wrapper, not the `smartgov` original, so the grant is under
test too.

Expected: `"scope": "unit"`, exactly **two** units returned — the officer's own
unit and the parent USG, which the design requires the LSG view to render —
and the *other* unit's name absent from the output entirely. Read the whole
returned text and confirm the sibling's name, id and seat are not in it, not
just the `units` array. Then call it with the owner's token and confirm
`"scope": "organization"` and every unit.

**Step 5: Commit**

```bash
git add supabase/migrations/20260101000800_unit_chart_functions.sql
git commit -m "Scope the org chart read to the caller's own unit

An LSG officer's unit list is filtered in the where clause, so other units
are never in the result set rather than merely hidden in the UI. A
client-side filter would ship every unit to the browser where devtools can
read it, which would make the scoping decorative.

Owner access is proven by the founding-member row, the same check
create_owner_account already makes, so an organization id supplied by the
client is not authority.
"
```

---

### Task 6: Invite a roster member into an existing seat

**Files:**
- Create: `supabase/migrations/20260101000900_roster_invites.sql`
- Read first: `supabase/migrations/20260101000300_expose_auth_api_and_hardening.sql` (the `create_invite` at line 341)

**Step 1: Extend `create_invite`, don't fork it**

`smartgov.invites` has a `campus_name text` column and no unit reference. Add nullable `unit_id` and `position_id` columns plus an `organization_id`-scoped uniqueness guarantee, then let `create_invite` accept two more optional arguments. When they are supplied, the invite also creates the `roster` row and the `unit_memberships` row in the same transaction — so accepting the invite needs no chart work afterwards, which is what keeps "invite a person into a seat" one action instead of two that can half-fail.

**Step 1b: Keep the `public` wrappers in step with the new signature**

`public.create_invite` is a four-argument forwarder and it is the only route
to the `smartgov` original. Adding parameters to the original does not add them
to the wrapper: Postgres will happily create a *new* four-argument function
beside the old one, the client will keep calling the old one, and the new
arguments will be silently dropped with no error anywhere. Update the wrapper
in the same migration, and `drop function` the superseded overload if you leave
one. The grant block at `00300:702-714` names signatures explicitly, so a
changed signature needs its grant restated too.

**Step 2: Extend `accept_invite` to link the account**

On activation, set `roster.account_id = <the new account id>`. The seat was already filled at invite time; the membership row does not move.

**Step 3: Rate limiting**

The new path must go through `smartgov.consume_rate_limit` like the existing ones. A roster endpoint that mints 24 invites in a row is the abuse case this already defends against — do not skip it.

**Step 4: Commit**

```bash
git add supabase/migrations/20260101000900_roster_invites.sql
git commit -m "Invite a roster member straight into a seat

The membership is written at invite time, so accepting the invite only has
to link the account to the roster row instead of also filling a seat. One
action instead of two that can half-fail.
"
```

---

# Part C — The wizard

### Task 7: Pure helpers, with runtime tests

**Files:**
- Create: `src/lib/units.ts`
- Create: `scripts/test-units.ts` (scratch; delete before commit)

**Step 1: Write the failing test**

`node scripts/test-units.ts`, using `node:assert/strict`:

```ts
import assert from "node:assert/strict";
import { parseBulkUnits, inferUnitType, validateUnits } from "../src/lib/units.ts";

assert.deepEqual(inferUnitType("Baguio Campus"), "campus");
assert.deepEqual(inferUnitType("College of Engineering"), "college");
assert.deepEqual(inferUnitType("Nursing Department"), "department");
assert.deepEqual(inferUnitType("Main Building"), "college"); // falls back

assert.deepEqual(parseBulkUnits("Baguio Campus\nCollege of Engineering"), [
  { name: "Baguio Campus", type: "campus" },
  { name: "College of Engineering", type: "college" },
]);
assert.deepEqual(parseBulkUnits("College of Engineering — college"), [
  { name: "College of Engineering", type: "college" },
]);
assert.deepEqual(parseBulkUnits("\n\n  \n"), []); // blanks ignored

assert.equal(validateUnits([]).ok, false); // federated needs >= 1
assert.equal(validateUnits([{ name: "A", type: "college" }]).ok, true);
assert.equal(
  validateUnits([
    { name: "Baguio Campus", type: "campus" },
    { name: "baguio campus", type: "college" },
  ]).reason,
  "duplicate"
);
```

**Step 2: Run it and watch it fail**

Run: `node scripts/test-units.ts`
Expected: `ERR_MODULE_NOT_FOUND` for `../src/lib/units.ts`.

**Step 3: Write the implementation**

`inferUnitType` checks the name case-insensitively for "campus", then "department", else `"college"`. `parseBulkUnits` splits on newlines, trims, drops blanks, and splits each line once on `—` or `-` when a valid type follows, otherwise infers. `validateUnits` rejects empty for federated and rejects case-insensitive duplicate names.

**Step 4: Run it and watch it pass**

Run: `node scripts/test-units.ts`
Expected: exit 0, no output.

**Step 5: Commit the helper, drop the scratch test**

```bash
git rm scripts/test-units.ts
git add src/lib/units.ts
git commit -m "Add bulk unit parsing and validation

A university with 20 colleges and 4 campuses should not take 24 rounds of
typing, so a unit can be pasted a line at a time. Type is inferred from the
name when the line does not say one.
"
```

---

### Task 8: Add `units` to the wizard draft

**Files:**
- Modify: `src/lib/store.ts`
- Modify: `scripts/check-federated.mjs`

**Step 1: Add the failing assertion to the check script**

Add to the nine contract items in `scripts/check-federated.mjs`:

> 10. The draft carries a `units` array, and `validateStep` requires at least one unit when the model is federated.
> 11. The persist key is **not** bumped, because zustand's shallow merge gives a pre-existing draft the empty default for free.

**Step 2: Run it and watch it fail**

Run: `npm run check:federated`
Expected: the new item fails.

**Step 3: Implement**

Add `units: UnitDraft[]` to the draft type with `EMPTY_DRAFT.units = []`, an `addUnit`/`removeUnit`/`updateUnit` set of actions, and a federated branch in `validateStep` requiring at least one unit.

**Do not bump the persist key.** zustand's persist shallow-merges persisted state over the initial state, so a v2 draft written before this change has no `units` key and inherits `[]`. Bumping would silently discard every in-flight draft for no reason.

**Step 4: Run the gates**

Run: `npm run check:federated` then `npx tsc --noEmit`
Expected: 21/21 (or whatever the count becomes), exit 0.

**Step 5: Commit**

```bash
git add src/lib/store.ts scripts/check-federated.mjs
git commit -m "Let a federated draft declare its units

At least one unit is required for federated, since a USG with nothing under
it is not the state this design describes. The persist key stays put: a
draft from before this change has no units key and inherits the empty
default, so bumping it would only throw away work in progress.
"
```

---

### Task 9: The Units step, and sending it

**Files:**
- Create: `src/app/create/units/page.tsx`
- Modify: `src/lib/steps.ts`
- Modify: `src/lib/submit.ts`
- Modify: `src/app/create/review/page.tsx`

**Step 1: Add the step**

Insert between Organization and Review. The router guard must skip it entirely
when the model is `unitary` — unitary has no local tier, and showing it would
imply a structure that does not exist.

**Step 2: Build the UI**

Add-row with a name input and a College/Campus/Department select, plus a paste
box wired to `parseBulkUnits`, plus a live counter. Both routes write to the
same draft array, so pasting and adding rows compose.

**Step 3: Send it**

`submit.ts` maps `units` to `{ name, type }` in the `create_organization`
payload. It must not reintroduce `campusName` or `college` — the federated
invariant forbids it, and `check:federated` should go red if you do.

**Step 4: Show it in review**

`review/page.tsx` lists declared units with a link back to step 6 to edit.

**Step 5: Commit**

```bash
git add src/app/create/units/page.tsx src/lib/steps.ts src/lib/submit.ts src/app/create/review/page.tsx
git commit -m "Add the units step to the setup wizard

Federated only. A unitary organization has no local tier, and showing the
step would imply a structure it does not have.
"
```

---

# Part D — The org chart

### Task 10: Owner chart page

**Files:**
- Create: `src/app/org-chart/page.tsx`
- Create: `src/lib/chart.ts`

`chart.ts` calls `public.unit_chart` with the session token and narrows on `ok`. Call the `public` wrapper, never `smartgov.unit_chart` — the client has the publishable key only, execute on the `smartgov` schema was revoked from `anon` and `authenticated` in 00300, and the call fails with PGRST202. Render the USG root at top, each unit as a card below with its seats, and "Vacant" wherever `rosterId` is null.

Guard the page: a non-owner with `scope: "unit"` should be redirected to the LSG view, not shown a chart that happens to contain one unit.

### Task 11: Position builder and seat toggles

**Files:**
- Modify: `src/app/org-chart/page.tsx`

"Add position" writes the org template and, per `add_position`, appears on every unit at once. Each unit card has per-position toggles calling `toggle_unit_position`. Surface the refusal to disable an occupied seat as a visible message rather than a swallowed error.

### Task 12: Seat assignment and the roster picker

**Files:**
- Modify: `src/app/org-chart/page.tsx`
- Create: `src/app/api/org-chart/invite/route.ts`

Clicking a vacant seat offers an existing roster entry or a new name and email. New people post to the invite route; existing people call `assign_officer`. Handle `seat_occupied` by telling the user the seat was just taken and refreshing, instead of showing a raw constraint error.

### Task 13: The LSG scoped view

**Files:**
- Create: `src/app/my-council/page.tsx`

Read-only: the caller's own unit, its seats and occupants, and the parent USG above. This page is the proof the scoping holds, so treat a row appearing here that the owner-only query would have hidden as a bug, not a feature.

---

# Part E — Verification

### Task 14: Contract checks

**Files:**
- Create: `scripts/check-units.mjs`

Follow the pattern of `check-federated.mjs`, including its header comment about mutation-testing the assertions so a check that cannot fail is not mistaken for a passing one. Assert:

1. The four tables exist and the enum includes `department`.
2. Both partial unique indexes exist.
3. `unit_chart` filters by the caller's memberships in SQL, not in TypeScript — the check should fail if a `where` on membership is removed. Also assert the parent union is present, and fail if it is removed: the design requires the LSG view to render the parent, and its absence is a bug rather than a leak to be closed.
4. The wizard step is skipped for unitary.
5. `submit.ts` sends `units` and no retired field.
6. Every new function is `security definer` with `set search_path` and `revoke ... from public`.
7. The four new tables are RLS-enabled with no policies.
8. **Every `smartgov` function added here has a `public` wrapper with an explicit `grant execute ... to anon, authenticated` whose signature matches the original.** A static check cannot prove the grant exists in the database, so pair this with the runtime assertion below; a wrapper that is correct but ungranted is still unreachable, and a wrapper whose signature drifts is a different function.
9. Runtime, against the user's database: `has_function_privilege('anon', 'public.unit_chart(text)', 'execute')` is true, and `has_function_privilege('anon', 'smartgov.unit_chart(text)', 'execute')` is **false**. The second one is the security assertion; the first is the reachability one.
10. No migration contains `unique (..., lower(...))` or `unique (..., upper(...))` inside a `create table`. Postgres rejects an expression in a table-level `unique` constraint, so this is a syntax error that takes the whole migration down. It has been written that way by mistake before; the correct form is a `create unique index`.

Add `"check:units": "node scripts/check-units.mjs"` to `package.json`.

### Task 15: End-to-end scoping proof, with the user

This needs the database and real accounts. Walk the user through it:

1. Create a federated org with three units.
2. Sign in as the owner, add positions, enable seats, invite two officers into unit A.
3. Have one accept the invite.
4. Sign in as that officer, open `my-council` — it must show unit A and the
   parent USG, and nothing else.
5. **Call `public.unit_chart` with their session token directly** and confirm
   exactly two units come back (unit A and the parent) and that units B and C
   do not appear anywhere in the JSON at all. This is the assertion that
   matters; the UI could be hiding rows regardless. The parent USG *is*
   supposed to be there — the design puts it above the officer's own unit,
   read-only — so its presence is not a leak and its absence is a bug.
6. Confirm the call is made through the `public` wrapper and not the
   `smartgov` original, so the grant is exercised. A direct call to
   `smartgov.unit_chart` must fail: `00300` revoked execute on the whole
   schema.
7. Add the registry check back against the public `invites` API and confirm the invite surface did not regress.

### Task 16: Documentation

**Files:**
- Modify: `README.md`

Update the migration count, document the new tables and functions, and record the scoping rule and the reason it is enforced in SQL. The README is where the security posture is already documented at length; do not leave this posture undocumented in the one file that carries it.

### Task 17: Full gates

```bash
npx tsc --noEmit
npx eslint .
npm run build
npm run check:federated
npm run check:reveal
npm run check:units
```

Expected: all exit 0. Then hand the plan's migration files to the user for
`supabase db push`, and deploy only after they confirm.

---

## What this plan deliberately does not do

No monitoring features: no requirements or resolution submission, document verification, status tracking, remarks, document storage, budget, events, or budget requests. No test framework. No Supabase Auth. No nesting beyond one level. No client-side filtering as a substitute for a database-enforced scope.

Each of the nine monitoring features will need per-unit access checks, and this is the layer that lets them have any. Building it first is not gold-plating — it is the part that is expensive to retrofit.
