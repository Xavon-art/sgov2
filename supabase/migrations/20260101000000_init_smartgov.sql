-- SmartGov core schema
-- Centralized governance management for university student governments.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- enums

do $$ begin
  create type public.governance_model as enum ('federated', 'unitary');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.member_role as enum (
    'usg_officer', 'lsg_officer', 'council_officer', 'advisor'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.org_status as enum ('active', 'suspended', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.unit_type as enum (
    'usg', 'lsg', 'college', 'campus', 'council'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- tables

create table if not exists public.organizations (
  id               uuid primary key default gen_random_uuid(),
  slug             text        not null unique,
  name             text        not null,
  description      text,
  governance_model public.governance_model not null,
  status           public.org_status     not null default 'active',
  charter_number   text        not null unique,
  academic_year    text        not null,
  accent           text        not null default '#16324f',
  university_name  text        not null,
  campus_name      text,
  college          text,
  seal_name        text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.organization_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  full_name       text        not null,
  email           text        not null,
  role            public.member_role not null,
  is_founding     boolean     not null default false,
  created_at      timestamptz not null default now(),
  unique (organization_id, email)
);

-- Self-referencing tree: usg -> college/campus -> lsg, or a single council.
create table if not exists public.governance_units (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  parent_id       uuid        references public.governance_units (id) on delete cascade,
  name            text        not null,
  unit_type       public.unit_type not null,
  created_at      timestamptz not null default now()
);

create table if not exists public.submissions (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid        not null references public.organizations (id) on delete cascade,
  reference_no         text        not null,
  title                text        not null,
  body                 text,
  status               text        not null default 'received',
  submitted_by_email   text,
  created_at           timestamptz not null default now(),
  unique (organization_id, reference_no)
);

create index if not exists organizations_model_idx
  on public.organizations (governance_model);
create index if not exists members_org_idx
  on public.organization_members (organization_id);
create index if not exists units_org_parent_idx
  on public.governance_units (organization_id, parent_id);
create index if not exists submissions_org_status_idx
  on public.submissions (organization_id, status);

-- ---------------------------------------------------------------- trigger

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists organizations_touch on public.organizations;
create trigger organizations_touch
  before update on public.organizations
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- RLS
--
-- Prototype posture: the creation flow is unauthenticated, so `anon` may
-- INSERT (setup only). No read, update, or delete policy is granted here —
-- dashboard reads come later behind a server role / authenticated session.

alter table public.organizations       enable row level security;
alter table public.organization_members enable row level security;
alter table public.governance_units     enable row level security;
alter table public.submissions          enable row level security;

drop policy if exists "anon may create organizations" on public.organizations;
create policy "anon may create organizations"
  on public.organizations for insert to anon with check (true);

drop policy if exists "anon may create members" on public.organization_members;
create policy "anon may create members"
  on public.organization_members for insert to anon with check (true);

drop policy if exists "anon may create units" on public.governance_units;
create policy "anon may create units"
  on public.governance_units for insert to anon with check (true);
