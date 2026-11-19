-- 03220 -- Attach a budget request to an event.
--
-- The first budget slice linked a request to a proposal or to nothing. Events
-- can also cost money, and the dashboard needs to show that ask beside the event
-- it belongs to. The link is one nullable column and one check: a request may
-- hang off a proposal, off an event, or stand alone, but never both. That keeps
-- the two funding stories from being told about the same money at once.
--
-- The write path reuses `budget_write_items`, so an event budget is validated by
-- exactly the same bounds as a proposal budget. Totals stay computed in SQL and
-- the client still never sends a subtotal.
--
-- House rule, unchanged: no grant on the table. The only way in is the security
-- definer function below, which resolves the caller from the session token.

alter table smartgov.budget_requests
  add column if not exists event_id uuid references smartgov.events (id) on delete set null;

alter table smartgov.budget_requests
  drop constraint if exists budget_requests_single_link_check;
alter table smartgov.budget_requests
  add constraint budget_requests_single_link_check
  check (proposal_id is null or event_id is null);

create index if not exists budget_requests_event_idx
  on smartgov.budget_requests (event_id);

-- ------------------------------------------------------------------- submit

-- The event has to be one the caller can already see: a USG-side caller sees
-- every event in the organization, an LSG caller sees university-wide events,
-- events addressed to its unit or unit type, and its own entries. The budget is
-- then filed against the caller's own unit, so an LSG officer cannot spend
-- another unit's allocation by naming a different event.
create or replace function smartgov.submit_event_budget(
  p_session_token text,
  p_event_id      uuid,
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
  v_account smartgov.accounts%rowtype;
  v_event   smartgov.events%rowtype;
  v_usg     boolean;
  v_unit    uuid;
  v_type    text;
  v_budget  uuid;
  v_title   text;
  v_total   numeric;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  v_title := btrim(coalesce(p_title, ''));
  if length(v_title) < 4 or length(v_title) > 140 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_title');
  end if;

  select e.* into v_event
    from smartgov.events e
   where e.id = p_event_id
     and e.organization_id = v_account.organization_id;

  if v_event.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_usg  := smartgov.is_usg_side(v_account);
  v_unit := smartgov.my_lsg_unit(v_account);
  select u.unit_type into v_type
    from public.governance_units u
   where u.id = v_unit;

  if not (
    v_usg
    or v_event.created_by = v_account.id
    or v_event.unit_id = v_unit
    or v_event.scope in ('university', 'org')
    or (v_event.scope = 'unit_type' and exists (
          select 1 from smartgov.event_scopes s
           where s.event_id = v_event.id
             and lower(s.unit_type) = lower(coalesce(v_type, ''))))
    or (v_event.scope = 'units' and exists (
          select 1 from smartgov.event_scopes s
           where s.event_id = v_event.id
             and s.unit_id = v_unit))
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- USG files against the event's own unit when it has one; an LSG files
  -- against its own unit, which is what makes the request appear on its ledger.
  if not v_usg then
    if v_unit is null then
      return jsonb_build_object('ok', false, 'reason', 'no_unit');
    end if;
  else
    v_unit := v_event.unit_id;
  end if;

  insert into smartgov.budget_requests (
    organization_id, event_id, unit_id, requested_by, title, justification
  )
  values (
    v_account.organization_id, p_event_id, v_unit, v_account.id, v_title,
    btrim(coalesce(p_justification, ''))
  )
  returning id into v_budget;

  v_total := smartgov.budget_write_items(v_budget, p_items);

  if v_total is null or v_total <= 0 then
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
    'unitId', v_unit,
    'eventId', p_event_id
  );
end;
$$;

revoke all on function smartgov.submit_event_budget(text, uuid, text, text, jsonb) from public;

-- ------------------------------------------------------------------- read

-- Same body as 02300 with the event columns added. Re-created rather than
-- patched because the row shape is the contract the panel reads.
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
        'eventId', b.event_id,
        'eventTitle', (select e.title from smartgov.events e where e.id = b.event_id),
        'eventDate', (select e.event_date from smartgov.events e where e.id = b.event_id),
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
    'eventId', v_budget.event_id,
    'eventTitle', (select e.title from smartgov.events e where e.id = v_budget.event_id),
    'eventDate', (select e.event_date from smartgov.events e where e.id = v_budget.event_id),
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

-- ------------------------------------------------------------------- public forwarder

create or replace function public.submit_event_budget(p_session_token text, p_event_id uuid, p_title text, p_justification text, p_items jsonb)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.submit_event_budget(p_session_token, p_event_id, p_title, p_justification, p_items); $$;
revoke all on function public.submit_event_budget(text, uuid, text, text, jsonb) from public;
grant execute on function public.submit_event_budget(text, uuid, text, text, jsonb) to anon, authenticated;
