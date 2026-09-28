# Unit hierarchy and org chart — design

Date: 2026-09-28
Status: approved, not yet implemented

## Problem

The setup wizard lets a federated USG create exactly one organization and, since
the USG-only change, no longer asks for a campus — correctly, because a USG sits
above every campus. But that leaves the product with no way to say *which*
campuses the USG covers, and no way to record who runs each one.

The product needs a USG to declare its colleges, campuses, and departments; those
become the Local Student Governments it governs; and each of them needs officers.
That is the foundation for every monitoring feature later (submissions, document
verification, budget, events), because each of those is really the question
"who is allowed to see and act on this unit?"

## Scope

**In**

- A wizard step where a federated USG declares its colleges, campuses, and departments.
- An org chart where the USG defines positions, enables seats per unit, and puts
  people in them.
- A roster of people who exist in the organization without accounts yet.
- A scoped "my council" view for an LSG officer.
- Server-side enforcement that an LSG officer cannot read another unit.

**Out — deliberately, and these are the bulk of the product**

- Requirements submission, resolution submission, document verification, status
  tracking, remarks, digital document storage, budget tracking, events, and
  budget requests. None of this is in this slice. There is no schema for any of
  it today.

The reason to build the foundation first is that all nine monitoring features
need per-unit access scoping, and that cannot be expressed in the current schema
at all — nothing carries a unit reference.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Membership shape | Dedicated `unit_memberships` table with `start_date` / `end_date` | Officers change every election. A single role column loses the history, so "what did last year's council do" becomes unanswerable. |
| Unit entry | Add-row plus bulk paste | A university like UP has ~20 colleges and ~4 campuses. One-at-a-time is ~24 rounds of typing. |
| Officer assignment | Org chart page after the wizard, not a wizard step | 24 units × 2–3 officers is 24–72 invites. One bad address mid-flow must not block the rest, and the chart is resumable and incremental as officers are actually recruited. |
| Positions | Organization template, enabled per unit | Schools differ; a college may have no Auditor while a campus does. Per-unit templates would mean ~192 rows across 24 units. |
| Person vs account | Separate `roster` | A seat must be fillable by someone who has not registered. Requiring 70 accounts up front is not achievable. |
| Nesting | Depth 1: USG → unit, enforced in the database | Not a preference, and not a new capability. 00400 could already write an arbitrary tree from `parentIndex`; this narrows that to one level on purpose. Microsoft Entra administrative units cannot nest at all, and deep nesting is what breaks a permission model. `parent_id` stays in the schema for a future that needs more, so widening it back is a migration rather than a redesign. |
| Unit is the LSG | One row per college/campus/department | A "College of Engineering" is a single row that both *is* the LSG and describes what kind of thing it is. Two layers would be redundant. |
| LSG view | Yes, a small scoped view | Otherwise scoping is written but never exercised, and the failure would only surface when the monitoring features land. |

## Data model

Four new tables, all in the `smartgov` schema, plus one enum value.

```sql
-- Positions: one list per organization, authored by the USG.
create table smartgov.org_positions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  label           text not null,
  sort_order      smallint not null default 0,
  created_at      timestamptz not null default now(),
  unique (organization_id, label)
);

-- Seats: which positions a given unit actually has.
create table smartgov.unit_positions (
  unit_id     uuid not null references public.governance_units (id) on delete cascade,
  position_id uuid not null references smartgov.org_positions (id) on delete cascade,
  primary key (unit_id, position_id)
);

-- People who exist in the organization but hold no account yet.
create table smartgov.roster (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  full_name       text not null,
  email           text not null,
  account_id      uuid references smartgov.accounts (id) on delete set null,
  created_at      timestamptz not null default now()
);

-- Case-insensitive on purpose, and an INDEX rather than a table constraint:
-- Postgres rejects an expression inside `unique (...)` with a syntax error at
-- CREATE TABLE.
create unique index roster_org_email_uniq
  on smartgov.roster (organization_id, lower(email));

-- Who holds which seat, and when.
create table smartgov.unit_memberships (
  id          uuid primary key default gen_random_uuid(),
  roster_id   uuid   not null references smartgov.roster (id) on delete cascade,
  unit_id     uuid   not null references public.governance_units (id) on delete cascade,
  position_id uuid   not null references smartgov.org_positions (id) on delete cascade,
  start_date  date   not null default current_date,
  end_date    date,
  created_at  timestamptz not null default now()
);
```

Two partial unique indexes carry the real invariants:

```sql
-- One person, one active seat, per unit.
create unique index unit_memberships_one_active_person_per_unit
  on smartgov.unit_memberships (unit_id, roster_id) where end_date is null;

-- One seat, one active holder.
create unique index unit_memberships_one_active_holder_per_seat
  on smartgov.unit_memberships (unit_id, position_id) where end_date is null;
```

These are what stop two people being Treasurer at once, and stop one person
holding two seats in the same unit. `end_date is null` means *current*, which is
what makes the constraint partial rather than permanent.

A person may hold different positions in different units simultaneously — that
is not constrained, and is intended.

### Enum change

`department` is missing from `public.unit_type` (today: `usg, lsg, college,
campus, council`). Adding it needs its own migration, because Postgres cannot use
a newly added enum value in the same transaction that creates it. This is the
only vocabulary this slice adds: the unit tree, `parent_id`, `college` and
`campus` all already exist.

### Unit tree

Neither the tree nor `parent_id` is new. `public.governance_units` already has
`parent_id`, its column comment already describes this shape, and
`create_organization` already wrote N rows from `parentIndex`. What is new is
that the shape is *derived* rather than described: a federated organization
creates one `usg` row with `parent_id = null`, then one child per declared unit
with `parent_id` set to the USG row, and nothing can put a second level under
either. Unitary creates a single `council` row as it does today and is
unaffected.

## Security posture

Every table has RLS enabled with **no policies**, and is revoked from `anon` and
`authenticated`. All access therefore goes through `security definer` functions
whose execute is revoked from `public`. The new tables follow exactly the same
rule, and the new functions must do the same.

The consequence that matters for scoping: **an LSG officer's unit list must come
from a function, not from a client-side filter over a full fetch.** Fetching all
units and hiding the others in React would put every unit in the browser payload,
where devtools can read them. The scoped read is enforced in the database.

Authorization rule, applied in the function that serves the chart:

- A USG officer (the organization owner) sees and edits every unit.
- An LSG officer sees their own unit, and their unit's parent USG as read-only.
- Anyone else sees nothing.

## Flow

### Wizard

```
1 Welcome → 2 Model → 3 Account → 4 Institution → 5 Organization
→ 6 Units (new, federated only) → 7 Review → 8 Charter → 9 Org chart (new)
```

Unitary skips step 6; it has no local tier.

**Step 6** asks "Which campuses, colleges, and departments does your USG cover?"
Each row is a name and a type of College, Campus, or Department. A paste box
accepts one unit per line, with an optional type suffix
(`College of Engineering — college`); a bare name infers its type from the word
"Campus" or "Department" and otherwise defaults to College. A live counter shows
how many units are declared.

Validation: no duplicate names within the draft, case-insensitive, and at least
one unit for federated — the umbrella is the premise of the design, so an empty
list is not a state this wizard allows.

`units` is a new field on the draft object. Because zustand's persist shallow-merges
persisted state over defaults, a draft written before this change simply has no
`units` key and inherits the empty default. **The persist key does not need to be
bumped** and existing v2 drafts keep working.

The review step lists the declared units before anything is written.

### RPC change

`public.create_organization(p_payload jsonb)` already writes a tree. Migration
00400 loops `v_units` and inserts one row per element, with a zero-based
`parentIndex` naming an earlier element as that row's parent, so the existing
function expresses arbitrary nesting and has always done so. What it could not
do was *constrain* the result: the shape of the organization was whatever the
browser payload described, and the database had no way to know that a federated
USG is supposed to be two levels.

This migration therefore **replaces that capability with an enforced depth-1
shape**. It is a deliberate narrowing, not the addition of something missing,
and the tradeoff is worth stating plainly: after this change a USG cannot
express a faculty, a year level, or a college-to-department second tier, and a
client cannot smuggle one in. What is bought with that is a permission model
that is provably two levels — "my unit" and "my unit's parent" is a complete
statement about what an LSG officer can see, which is what makes the scoping in
the security section below checkable rather than aspirational. A deeper tree
would make every later access check a question about how far up somebody is
allowed to look, and Entra administrative units, which is the closest
comparable system, cannot nest at all.

The USG row is derived from the organization name rather than declared, so a
client cannot omit it, and it is written first so the children have a
`parent_id` to point at. All of it happens inside the transaction the function
already has, so a failure part-way leaves nothing behind.

### Org chart

Not a wizard step — its own page, reachable after the charter is granted.

The USG authors positions with **Add position**, which adds to the organization
template and shows everywhere. Each unit then **enables** the seats it has, and
each seat holds a person or reads "Vacant".

Choosing an officer offers an existing roster entry or a new name and email,
which sends an invite. On acceptance the `smartgov.accounts` row is created and
`roster.account_id` is set; the seat is already filled and does not need to move.

Replacing an officer does not delete anything — it sets `end_date` on the old
membership and starts a new one, so "who held Treasurer last term" stays
answerable.

### LSG view

A small "My council" page: the officer's own unit, its seats and occupants, and
the parent USG read-only above it. Read-only, and it is the proof that scoping
holds.

## Migration order

1. Add `department` to `public.unit_type` (own transaction).
2. Create the four tables, both partial unique indexes, and enable RLS with no
   policies; revoke all from `anon` and `authenticated`.
3. Replace `create_organization` so the tree it writes is derived and
   constrained to depth 1, rather than whatever `parentIndex` describes. It
   must accept the payload the deployed client sends today as well as the one
   the wizard will send, because these two steps can be applied in either
   order.
4. Add the org-position, seat, roster, and membership functions — all
   `security definer`, execute revoked from `public` — and publish each one
   through a one-line `public` wrapper with an explicit grant. A function with
   no wrapper is unreachable from the browser, because 00300 revoked the blanket
   schema grant and replaced it with an explicit allowlist.
5. Add the invitation path so a roster member can accept into an existing seat.

Each step is independently deployable; the UI lands after step 4.

## What this unlocks, and what it does not

It does not deliver any monitoring feature. What it delivers is that the nine
features no longer require a schema redesign to be possible, and that access
scoping is proven end to end before a single submission exists.

## Open items

- Whether a budget approval authority should be modelled as its own entity,
  distinct from scope roles. The research supports it, but it depends on the
  organization's bylaws.
- Whether the roster needs a "contacted / not yet invited" state distinct from
  an accepted invite.
- Rate limiting on the new invite path, which the existing invite endpoints have
  and the roster endpoint must not skip.
