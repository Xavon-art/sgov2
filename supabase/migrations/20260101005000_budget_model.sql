alter type public.unit_type add value if not exists 'department';

create table if not exists smartgov.budget_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 120),
  starts_on date not null,
  ends_on date not null,
  status text not null default 'open' check (status in ('draft', 'open', 'closed')),
  created_at timestamptz not null default now(),
  unique (organization_id, label),
  check (ends_on >= starts_on)
);

create table if not exists smartgov.budget_allocations (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references smartgov.budget_periods (id) on delete cascade,
  unit_id uuid not null references public.governance_units (id) on delete cascade,
  allocated_amount numeric(14,2) not null default 0 check (allocated_amount >= 0),
  set_by uuid references smartgov.accounts (id) on delete set null,
  set_at timestamptz not null default now(),
  note text not null default '',
  unique (period_id, unit_id)
);

alter table smartgov.budget_requests
  add column if not exists period_id uuid references smartgov.budget_periods (id) on delete restrict;

update smartgov.budget_requests
   set status = 'under_review'
 where status in ('submitted', 'pending');

alter table smartgov.budget_requests
  drop constraint if exists budget_requests_status_check;

alter table smartgov.budget_requests
  add constraint budget_requests_status_check
  check (status in ('pending', 'draft', 'under_review', 'returned', 'approved', 'rejected', 'overdue'));

alter table smartgov.budget_requests
  alter column status set default 'under_review';

create table if not exists smartgov.budget_expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  unit_id uuid not null references public.governance_units (id) on delete cascade,
  request_id uuid references smartgov.budget_requests (id) on delete set null,
  amount numeric(14,2) not null check (amount > 0),
  description text not null default '' check (length(btrim(description)) between 1 and 240),
  receipt_file text,
  recorded_by uuid not null references smartgov.accounts (id),
  recorded_at timestamptz not null default now()
);

create table if not exists smartgov.usg_expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  period_id uuid not null references smartgov.budget_periods (id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  description text not null check (length(btrim(description)) between 1 and 240),
  receipt_file text,
  recorded_by uuid not null references smartgov.accounts (id),
  recorded_at timestamptz not null default now()
);

create index if not exists budget_periods_org_idx on smartgov.budget_periods (organization_id, starts_on);
create index if not exists budget_allocations_period_idx on smartgov.budget_allocations (period_id);
create index if not exists budget_allocations_unit_idx on smartgov.budget_allocations (unit_id);
create index if not exists budget_requests_period_idx on smartgov.budget_requests (period_id);
create index if not exists budget_expenses_unit_idx on smartgov.budget_expenses (unit_id, recorded_at desc);
create index if not exists budget_expenses_request_idx on smartgov.budget_expenses (request_id);
create index if not exists usg_expenses_period_idx on smartgov.usg_expenses (period_id, recorded_at desc);

revoke all on smartgov.budget_periods from public, anon, authenticated;
revoke all on smartgov.budget_allocations from public, anon, authenticated;
revoke all on smartgov.budget_expenses from public, anon, authenticated;
revoke all on smartgov.usg_expenses from public, anon, authenticated;

insert into public.governance_units (organization_id, name, unit_type)
select o.id, 'USG', 'usg'
  from public.organizations o
 where not exists (
   select 1 from public.governance_units gu where gu.organization_id = o.id
 );

insert into smartgov.budget_periods (organization_id, label, starts_on, ends_on, status)
select o.id,
       'Default budget period',
       date_trunc('year', now())::date,
       (date_trunc('year', now()) + interval '1 year - 1 day')::date,
       'open'
  from public.organizations o
 where not exists (
   select 1 from smartgov.budget_periods bp
    where bp.organization_id = o.id and bp.label = 'Default budget period'
 );

update smartgov.budget_requests b
   set period_id = (
     select bp.id from smartgov.budget_periods bp
      where bp.organization_id = b.organization_id
        and bp.label = 'Default budget period'
     limit 1
   )
 where b.period_id is null;

update smartgov.budget_requests b
   set unit_id = coalesce(
     b.unit_id,
     (select pr.unit_id from smartgov.proposals pr where pr.id = b.proposal_id),
     (select ev.unit_id from smartgov.events ev where ev.id = b.event_id),
     (select a.unit_id from smartgov.accounts a where a.id = b.requested_by),
     (select gu.id from public.governance_units gu where gu.organization_id = b.organization_id order by gu.created_at, gu.id limit 1)
   )
 where b.unit_id is null;

update smartgov.budget_requests b
   set unit_id = (
     select gu.id from public.governance_units gu where gu.organization_id = b.organization_id order by gu.created_at, gu.id limit 1
   )
 where b.unit_id is null;

alter table smartgov.budget_requests
  alter column unit_id set not null;

alter table smartgov.budget_requests
  alter column period_id set not null;

insert into smartgov.budget_allocations (period_id, unit_id, allocated_amount, set_by, set_at, note)
select bp.id,
       gu.id,
       coalesce(sum(case when b.status = 'approved' then coalesce(b.approved_total, 0) else b.requested_total end), 0),
       (select a.id from smartgov.accounts a where a.organization_id = gu.organization_id and a.account_scope = 'owner' limit 1),
       now(),
       'Backfilled from existing budget requests'
  from public.governance_units gu
  join smartgov.budget_periods bp on bp.organization_id = gu.organization_id
  left join smartgov.budget_requests b
    on b.unit_id = gu.id and b.period_id = bp.id and b.status <> 'rejected'
 where not exists (
   select 1 from smartgov.budget_allocations ba where ba.period_id = bp.id and ba.unit_id = gu.id
 )
 group by bp.id, gu.id
on conflict (period_id, unit_id) do nothing;

notify pgrst, 'reload schema';
