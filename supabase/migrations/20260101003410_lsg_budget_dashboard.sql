-- 03410 -- LSG budget dashboard.
--
-- USG already has a per-unit budget summary. This is the matching view for the
-- other side of the federation: one unit, its own money, and a short monthly
-- trail. It is scoped through `lsg_unit_ids`, never through a unit id supplied
-- by the caller, so an officer cannot ask for another unit's numbers.

create or replace function smartgov.lsg_budget_dashboard(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account       smartgov.accounts%rowtype;
  v_unit_ids      uuid[];
  v_total_spent   numeric := 0;
  v_remaining     numeric := 0;
  v_periods       jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if smartgov.is_usg_side(v_account) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  v_unit_ids := smartgov.lsg_unit_ids(v_account.id, v_account.organization_id);

  select coalesce(sum(b.approved_total), 0)
    into v_total_spent
    from smartgov.budget_requests b
   where b.organization_id = v_account.organization_id
     and b.status = 'approved'
     and (b.unit_id is null or b.unit_id = any (v_unit_ids));

  select coalesce(sum(b.requested_total) - sum(coalesce(b.approved_total, 0)), 0)
    into v_remaining
    from smartgov.budget_requests b
   where b.organization_id = v_account.organization_id
     and b.status in ('submitted', 'returned')
     and (b.unit_id is null or b.unit_id = any (v_unit_ids));

  select coalesce(jsonb_agg(jsonb_build_object(
           'label', to_char(p.month, 'Mon YYYY'),
           'requested', p.requested,
           'approved', p.approved
         ) order by p.month), '[]'::jsonb)
    into v_periods
    from (
      select date_trunc('month', b.created_at)::date as month,
             sum(b.requested_total) as requested,
             sum(coalesce(b.approved_total, 0)) as approved
        from smartgov.budget_requests b
       where b.organization_id = v_account.organization_id
         and b.created_at >= date_trunc('month', now()) - interval '5 months'
         and (b.unit_id is null or b.unit_id = any (v_unit_ids))
       group by 1
    ) p;

  return jsonb_build_object(
    'ok', true,
    'totalSpent', v_total_spent,
    'requestCount', (
      select count(*) from smartgov.budget_requests b
       where b.organization_id = v_account.organization_id
         and b.status <> 'rejected'
         and (b.unit_id is null or b.unit_id = any (v_unit_ids))
    ),
    'approvedCount', (
      select count(*) from smartgov.budget_requests b
       where b.organization_id = v_account.organization_id
         and b.status = 'approved'
         and (b.unit_id is null or b.unit_id = any (v_unit_ids))
    ),
    'remaining', v_remaining,
    'periods', v_periods
  );
end;
$$;

revoke all on function smartgov.lsg_budget_dashboard(text) from public;

create or replace function public.lsg_budget_dashboard(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.lsg_budget_dashboard(p_session_token); $$;

revoke all on function public.lsg_budget_dashboard(text) from public;
grant execute on function public.lsg_budget_dashboard(text) to anon, authenticated;
