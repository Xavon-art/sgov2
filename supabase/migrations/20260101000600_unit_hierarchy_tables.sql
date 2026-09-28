-- The org chart's four tables.
--
-- Nothing in the database carries a unit reference today, so an LSG officer
-- cannot be scoped to their own council. That is why these exist before any
-- monitoring feature does: all nine of them are really the question "who may
-- see and act on this unit?", and none of them can be answered without a row
-- that says which unit somebody belongs to.
--
-- The posture is the same as every other table in this schema. RLS is enabled
-- with zero policies and the tables are revoked from `anon` and `authenticated`,
-- so the `security definer` functions in 00800 and 00900 are the only way in or
-- out. Do not add a policy here: on this project one permissive policy turns a
-- locked table into a read surface for anyone holding the publishable key.

-- ---------------------------------------------------------------- positions

-- One list of positions per organization, authored by the USG. Positions are
-- org-level rather than per-unit because the template is shared: a USG with 24
-- colleges and 4 campuses would otherwise be maintaining 28 separate lists, and
-- "who can be an Auditor" is a question the organization answers once.
create table if not exists smartgov.org_positions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  label           text not null check (length(btrim(label)) > 0),
  sort_order      smallint not null default 0,
  created_at      timestamptz not null default now()
);

-- Postgres will not take an expression in a table-level `unique` constraint,
-- so the case-insensitive guarantee has to be a named index instead. Without
-- it, "Auditor" and "auditor" could both be added to the same org chart; the
-- index makes them a single label, and `add_position` turns the violation
-- into `duplicate_label` rather than surfacing it raw.
create unique index if not exists org_positions_one_label_per_org
  on smartgov.org_positions (organization_id, lower(label));

-- Which positions a given unit actually has. This is the seat. A unit with no
-- Auditor simply has no row here, so no Auditor renders anywhere in that
-- unit's card and nothing has to be filtered client-side to hide it.
create table if not exists smartgov.unit_positions (
  unit_id     uuid not null references public.governance_units (id) on delete cascade,
  position_id uuid not null references smartgov.org_positions (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (unit_id, position_id)
);

-- ---------------------------------------------------------------- roster

-- People who exist in the organization without accounts yet. Kept separate from
-- `smartgov.accounts` because a seat has to be fillable by someone who has
-- never signed in: requiring ~70 registrations up front is not how student
-- organizations recruit, and the officers of a council are frequently the last
-- to register. `account_id` is null until they do, and is the only thing that
-- links a roster entry to a login.
create table if not exists smartgov.roster (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  full_name       text not null check (length(btrim(full_name)) > 0),
  email           text not null check (length(btrim(email)) > 0),
  account_id      uuid references smartgov.accounts (id) on delete set null,
  created_at      timestamptz not null default now()
);

-- Case-insensitive email uniqueness has to be a named index for the same
-- reason the position label does: a table-level `unique` constraint cannot
-- take an expression. Without it, mixed-case variants of one address look
-- like two different people and a second invite for the same person
-- succeeds instead of being refused at the source.
create unique index if not exists roster_one_row_per_email
  on smartgov.roster (organization_id, lower(email));

-- ---------------------------------------------------------------- membership

-- Who holds which seat, and when. Dated rather than overwritten because
-- officers change every election and "what did last year's council do" has to
-- stay answerable; replacing a holder closes one row and opens another instead
-- of rewriting the old one in place. `end_date is null` therefore means
-- *current*, which is the definition both partial indexes below rely on.
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

-- The real invariants, and the reason this table is not just a join.
--
-- Without them the database would cheerfully let two people be Treasurer at
-- once, or let one person hold both President and Secretary of the same
-- council. Both are partial so that CLOSED rows never collide with each other:
-- a term ending and the next one beginning is exactly the case that would
-- otherwise be rejected, and it is the case that has to work.

-- One active holder per seat. This is what stops two simultaneous Treasurers.
create unique index if not exists unit_memberships_one_active_holder_per_seat
  on smartgov.unit_memberships (unit_id, position_id)
  where end_date is null;

-- One active seat per person per unit. Someone may hold different positions in
-- different units at once -- a department officer who also sits on a campus
-- council is not an error -- but not two offices in the same one.
create unique index if not exists unit_memberships_one_active_person_per_unit
  on smartgov.unit_memberships (unit_id, roster_id)
  where end_date is null;

-- ---------------------------------------------------------------- RLS

-- Policy-free on purpose, matching every other table in this schema. RLS with
-- no policies already denies everything; the SECURITY DEFINER functions in 00800
-- are the only path, and a policy here would be a second, weaker door.
alter table smartgov.org_positions    enable row level security;
alter table smartgov.unit_positions   enable row level security;
alter table smartgov.roster           enable row level security;
alter table smartgov.unit_memberships enable row level security;

revoke all on all tables in schema smartgov from anon, authenticated;
