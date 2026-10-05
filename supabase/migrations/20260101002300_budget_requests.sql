-- Budget requests: LSG asks for money, USG approves it, optionally for less.
--
-- Why the subtotal is a generated column and not a stored number: if the client
-- sends the subtotal, the client decides the total, and an LSG officer editing a
-- line in devtools could ask for anything. `generated always as ... stored` makes
-- the arithmetic a property of the row rather than of the request.
--
-- Why totals are recomputed in a function and not stored: a stored total drifts
-- the moment an item is edited. `requested_total` is kept only as the frozen
-- figure a reviewer approved against, and it is rewritten from the items inside
-- the same transaction that writes them.
--
-- House rule, unchanged: no RLS policy, no grant on either table. Every path in
-- is a `security definer` function that resolves the caller from the session
-- token and derives their unit from their own membership.
--
-- `approved_total` is deliberately allowed to be lower than `requested_total` and
-- never higher. Approving more than the ask would mean approving an event the
-- officer did not cost; that has to come back as a new line on a new proposal.

create table if not exists smartgov.budget_requests (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Null for a standalone request. Not unique: a proposal that is sent back and
  -- resubmitted keeps the earlier ask, so history is visible rather than
  -- overwritten.
  proposal_id     uuid references smartgov.proposals (id) on delete cascade,
  unit_id         uuid references public.governance_units (id) on delete set null,
  requested_by    uuid not null references smartgov.accounts (id),
  title           text not null check (length(btrim(title)) between 4 and 140),
  justification   text not null default '',
  status          text not null default 'submitted'
                  check (status in ('submitted', 'returned', 'approved', 'rejected')),
  requested_total numeric(12,2) not null default 0 check (requested_total >= 0),
  approved_total  numeric(12,2) check (approved_total is null or approved_total >= 0),
  decided_by      uuid references smartgov.accounts (id) on delete set null,
  decided_at      timestamptz,
  decision_remark text,
  created_at      timestamptz not null default now()
);

create table if not exists smartgov.budget_items (
  id                uuid primary key default gen_random_uuid(),
  budget_request_id uuid not null references smartgov.budget_requests (id) on delete cascade,
  position          int not null check (position >= 0),
  label             text not null check (length(btrim(label)) between 1 and 120),
  quantity          numeric(10,2) not null check (quantity > 0),
  unit_cost         numeric(12,2) not null check (unit_cost >= 0),
  subtotal          numeric(14,2) generated always as (round(quantity * unit_cost, 2)) stored,
  unique (budget_request_id, position)
);

create index if not exists budget_requests_unit_idx on smartgov.budget_requests (unit_id);
create index if not exists budget_requests_status_idx on smartgov.budget_requests (status);
create index if not exists budget_requests_org_idx on smartgov.budget_requests (organization_id);
create index if not exists budget_requests_proposal_idx on smartgov.budget_requests (proposal_id);

revoke all on smartgov.budget_requests from public, anon, authenticated;
revoke all on smartgov.budget_items from public, anon, authenticated;

-- ------------------------------------------------------------------- item writer

-- Replaces the line items of one request and returns the recomputed total, or
-- null when anything is out of range. Every bound is checked here rather than in
-- the route so the API and any future caller get the same answer.
--
-- The numeric strings are matched against a pattern before casting. Casting
-- 'abc' to numeric would raise and abort the transaction, which is a worse
-- failure mode than rejecting the request.
create or replace function smartgov.budget_write_items(
  p_budget_id uuid,
  p_items     jsonb
)
returns numeric
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_total numeric(14,2) := 0;
  v_item  jsonb;
  v_pos   int := 0;
  v_label text;
  v_qty   numeric;
  v_cost  numeric;
begin
  if jsonb_typeof(p_items) <> 'array' then
    return null;
  end if;

  if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 50 then
    return null;
  end if;

  delete from smartgov.budget_items where budget_request_id = p_budget_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_label := btrim(coalesce(v_item ->> 'label', ''));

    if v_label = '' or length(v_label) > 120 then
      return null;
    end if;

    if coalesce(v_item ->> 'quantity', '') !~ '^[0-9]{1,6}(\.[0-9]{1,2})?$' then
      return null;
    end if;

    if coalesce(v_item ->> 'unit_cost', '') !~ '^[0-9]{1,9}(\.[0-9]{1,2})?$' then
      return null;
    end if;

    v_qty  := (v_item ->> 'quantity')::numeric;
    v_cost := (v_item ->> 'unit_cost')::numeric;

    if v_qty <= 0 or v_qty > 100000 or v_cost > 10000000 then
      return null;
    end if;

    insert into smartgov.budget_items (budget_request_id, position, label, quantity, unit_cost)
    values (p_budget_id, v_pos, v_label, v_qty, v_cost);

    v_pos := v_pos + 1;
  end loop;

  select coalesce(sum(subtotal), 0) into v_total
    from smartgov.budget_items
   where budget_request_id = p_budget_id;

  return v_total;
end;
$$;

revoke all on function smartgov.budget_write_items(uuid, jsonb) from public;

-- ------------------------------------------------------------------- submit

create or replace function smartgov.submit_budget(
  p_session_token text,
  p_proposal_id   uuid,
  p_title         text,
  p_justification text,
  p_items         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account   smartgov.accounts%rowtype;
  v_proposal  smartgov.proposals%rowtype;
  v_unit      uuid;
  v_budget    uuid;
  v_title     text;
  v_total     numeric;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  v_title := btrim(coalesce(p_title, ''));
  if length(v_title) < 4 or length(v_title) > 140 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_title');
  end if;

  if p_proposal_id is not null then
    select pr.* into v_proposal
      from smartgov.proposals pr
     where pr.id = p_proposal_id
       and pr.organization_id = v_account.organization_id;

    if v_proposal.id is null then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;

    -- The budget belongs to the caller's own unit, or to a proposal they wrote.
    -- A proposal from another LSG must not even be visible here, let alone
    -- fundable.
    if not (
      v_proposal.created_by = v_account.id
      or (
        v_proposal.unit_id is not null
        and v_proposal.unit_id in (
          select t.u from (
            select smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) as u
          ) t
        )
      )
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;

    -- Money cannot be attached after a decision: an approved proposal with a
    -- late budget is a way to buy something the reviewer did not see.
    if v_proposal.status not in ('submitted', 'returned') then
      return jsonb_build_object('ok', false, 'reason', 'proposal_not_open');
    end if;

    v_unit := v_proposal.unit_id;
    if length(btrim(coalesce(v_title, ''))) = 0 then
      v_title := v_proposal.title;
    end if;
  else
    select t.u into v_unit
      from (select smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) as u) t
     order by t.u
     limit 1;

    if v_unit is null then
      return jsonb_build_object('ok', false, 'reason', 'no_unit');
    end if;
  end if;

  insert into smartgov.budget_requests (
    organization_id, proposal_id, unit_id, requested_by, title, justification
  )
  values (
    v_account.organization_id, p_proposal_id, v_unit, v_account.id, v_title,
    btrim(coalesce(p_justification, ''))
  )
  returning id into v_budget;

  v_total := smartgov.budget_write_items(v_budget, p_items);

  if v_total is null or v_total <= 0 then
    -- Undo rather than leave a request with no items behind it.
    delete from smartgov.budget_requests where id = v_budget;
    return jsonb_build_object('ok', false, 'reason', 'invalid_items');
  end if;

  update smartgov.budget_requests
     set requested_total = v_total
   where id = v_budget;

  return jsonb_build_object(
    'ok', true,
    'budgetId', v_budget,
    'requestedTotal', v_total,
    'unitId', v_unit
  );
end;
$$;

revoke all on function smartgov.submit_budget(text, uuid, text, text, jsonb) from public;

-- ------------------------------------------------------------------- read

-- Same shape of rule as `list_proposals`: the USG side reads the whole
-- organization, and everybody else reads only their own unit.
create or replace function smartgov.list_budgets(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_is_usg  boolean;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  v_is_usg := v_account.account_scope = 'owner'
              or smartgov.is_org_reviewer(v_account.id, v_account.organization_id);

  return jsonb_build_object(
    'ok', true,
    'scope', case when v_is_usg then 'organization' else 'unit' end,
    'budgets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id,
        'proposalId', b.proposal_id,
        'proposalTitle', (select pr.title from smartgov.proposals pr where pr.id = b.proposal_id),
        'title', b.title,
        'status', b.status,
        'unitId', b.unit_id,
        'unitName', (select gu.name from public.governance_units gu where gu.id = b.unit_id),
        'requestedTotal', b.requested_total,
        'approvedTotal', b.approved_total,
        'decisionRemark', b.decision_remark,
        'itemCount', (select count(*) from smartgov.budget_items bi where bi.budget_request_id = b.id),
        'createdAt', b.created_at
      ) order by b.created_at desc)
        from smartgov.budget_requests b
       where b.organization_id = v_account.organization_id
         and (
           v_is_usg
           or b.requested_by = v_account.id
           or (b.unit_id is not null and b.unit_id in (
                 select t.u from (
                   select smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) as u
                 ) t
               ))
         )
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_budgets(text) from public;

create or replace function smartgov.budget_detail(
  p_session_token text,
  p_budget_id     uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_budget  smartgov.budget_requests%rowtype;
  v_is_usg  boolean;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select b.* into v_budget
    from smartgov.budget_requests b
   where b.id = p_budget_id
     and b.organization_id = v_account.organization_id;

  if v_budget.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_is_usg := v_account.account_scope = 'owner'
              or smartgov.is_org_reviewer(v_account.id, v_account.organization_id);

  if not (
    v_is_usg
    or v_budget.requested_by = v_account.id
    or (v_budget.unit_id is not null and v_budget.unit_id in (
          select t.u from (
            select smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) as u
          ) t
        ))
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_budget.id,
    'proposalId', v_budget.proposal_id,
    'title', v_budget.title,
    'justification', v_budget.justification,
    'status', v_budget.status,
    'unitId', v_budget.unit_id,
    'unitName', (select gu.name from public.governance_units gu where gu.id = v_budget.unit_id),
    'requestedTotal', v_budget.requested_total,
    'approvedTotal', v_budget.approved_total,
    'decisionRemark', v_budget.decision_remark,
    'decidedAt', v_budget.decided_at,
    'createdAt', v_budget.created_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', bi.id,
        'label', bi.label,
        'quantity', bi.quantity,
        'unitCost', bi.unit_cost,
        'subtotal', bi.subtotal
      ) order by bi.position)
        from smartgov.budget_items bi
       where bi.budget_request_id = v_budget.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.budget_detail(text, uuid) from public;

-- ------------------------------------------------------------------- decide

-- `p_approved_total` null means "approve exactly what was asked". A number means
-- approve in full up to that figure, which is the "approved with an adjusted
-- amount" case the brief asks for. The remark is mandatory on anything other than
-- a clean approval, exactly as it is for proposals: an LSG officer who is told no
-- deserves to be told why.
create or replace function smartgov.review_budget(
  p_session_token  text,
  p_budget_id      uuid,
  p_decision       text,
  p_approved_total numeric,
  p_remark         text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_budget  smartgov.budget_requests%rowtype;
  v_remark  text;
  v_amount  numeric;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if not (
    v_account.account_scope = 'owner'
    or smartgov.is_org_reviewer(v_account.id, v_account.organization_id)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if p_decision not in ('approved', 'returned', 'rejected') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_remark := btrim(coalesce(p_remark, ''));

  if p_decision <> 'approved' and v_remark = '' then
    return jsonb_build_object('ok', false, 'reason', 'remark_required');
  end if;

  select b.* into v_budget
    from smartgov.budget_requests b
   where b.id = p_budget_id
     and b.organization_id = v_account.organization_id;

  if v_budget.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_budget.status not in ('submitted', 'returned') then
    return jsonb_build_object('ok', false, 'reason', 'already_decided');
  end if;

  if p_decision = 'approved' then
    v_amount := coalesce(p_approved_total, v_budget.requested_total);

    if v_amount < 0 or v_amount > v_budget.requested_total then
      return jsonb_build_object('ok', false, 'reason', 'invalid_amount');
    end if;
  else
    v_amount := null;
  end if;

  update smartgov.budget_requests
     set status = p_decision,
         approved_total = v_amount,
         decided_by = v_account.id,
         decided_at = now(),
         decision_remark = nullif(v_remark, '')
   where id = v_budget.id;

  return jsonb_build_object(
    'ok', true,
    'id', v_budget.id,
    'status', p_decision,
    'approvedTotal', v_amount,
    'requestedTotal', v_budget.requested_total
  );
end;
$$;

revoke all on function smartgov.review_budget(text, uuid, text, numeric, text) from public;

-- ------------------------------------------------------------------- summary

-- Requested against approved, per unit and for the university. USG only: the
-- university-wide view is how a question gets answered, and per-unit numbers are
-- not an LSG officer's business.
create or replace function smartgov.budget_summary(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if not (
    v_account.account_scope = 'owner'
    or smartgov.is_org_reviewer(v_account.id, v_account.organization_id)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'units', coalesce((
      select jsonb_agg(jsonb_build_object(
        'unitId', u.unit_id,
        'unitName', coalesce(u.unit_name, 'Unassigned'),
        'requested', u.requested,
        'approved', u.approved,
        'remaining', u.requested - u.approved,
        'openCount', u.open_count
      ) order by u.requested desc)
        from (
          select b.unit_id,
                 (select gu.name from public.governance_units gu where gu.id = b.unit_id) as unit_name,
                 sum(b.requested_total) as requested,
                 sum(coalesce(b.approved_total, 0)) as approved,
                 count(*) filter (where b.status in ('submitted', 'returned')) as open_count
            from smartgov.budget_requests b
           where b.organization_id = v_account.organization_id
             and b.status <> 'rejected'
           group by b.unit_id
        ) u
    ), '[]'::jsonb),
    'totals', jsonb_build_object(
      'requested', coalesce((select sum(b.requested_total) from smartgov.budget_requests b
                              where b.organization_id = v_account.organization_id
                                and b.status <> 'rejected'), 0),
      'approved', coalesce((select sum(coalesce(b.approved_total, 0)) from smartgov.budget_requests b
                              where b.organization_id = v_account.organization_id
                                and b.status <> 'rejected'), 0),
      'remaining', coalesce((select sum(b.requested_total) - sum(coalesce(b.approved_total, 0))
                                from smartgov.budget_requests b
                               where b.organization_id = v_account.organization_id
                                 and b.status <> 'rejected'), 0)
    )
  );
end;
$$;

revoke all on function smartgov.budget_summary(text) from public;

-- ------------------------------------------------------------------- public forwarders

create or replace function public.submit_budget(p_session_token text, p_proposal_id uuid, p_title text, p_justification text, p_items jsonb)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.submit_budget(p_session_token, p_proposal_id, p_title, p_justification, p_items); $$;
revoke all on function public.submit_budget(text, uuid, text, text, jsonb) from public;
grant execute on function public.submit_budget(text, uuid, text, text, jsonb) to anon, authenticated;

create or replace function public.list_budgets(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_budgets(p_session_token); $$;
revoke all on function public.list_budgets(text) from public;
grant execute on function public.list_budgets(text) to anon, authenticated;

create or replace function public.budget_detail(p_session_token text, p_budget_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.budget_detail(p_session_token, p_budget_id); $$;
revoke all on function public.budget_detail(text, uuid) from public;
grant execute on function public.budget_detail(text, uuid) to anon, authenticated;

create or replace function public.review_budget(p_session_token text, p_budget_id uuid, p_decision text, p_approved_total numeric, p_remark text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.review_budget(p_session_token, p_budget_id, p_decision, p_approved_total, p_remark); $$;
revoke all on function public.review_budget(text, uuid, text, numeric, text) from public;
grant execute on function public.review_budget(text, uuid, text, numeric, text) to anon, authenticated;

create or replace function public.budget_summary(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.budget_summary(p_session_token); $$;
revoke all on function public.budget_summary(text) from public;
grant execute on function public.budget_summary(text) to anon, authenticated;