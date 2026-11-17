create table if not exists smartgov.tour_progress (
  account_id      uuid primary key references smartgov.accounts (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  completed       jsonb not null default '{}'::jsonb,
  dismissed       jsonb not null default '{}'::jsonb,
  sidebar_collapsed boolean not null default false,
  updated_at      timestamptz not null default now()
);

alter table smartgov.tour_progress enable row level security;

revoke all on table smartgov.tour_progress from public, anon, authenticated;

create or replace function smartgov.get_tour_progress(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account           smartgov.accounts%rowtype;
  v_completed         jsonb;
  v_dismissed         jsonb;
  v_sidebar_collapsed boolean;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select p.completed, p.dismissed, p.sidebar_collapsed
    into v_completed, v_dismissed, v_sidebar_collapsed
    from smartgov.tour_progress p
   where p.account_id = v_account.id;

  return jsonb_build_object(
    'ok', true,
    'completed', coalesce(v_completed, '{}'::jsonb),
    'dismissed', coalesce(v_dismissed, '{}'::jsonb),
    'sidebarCollapsed', coalesce(v_sidebar_collapsed, false)
  );
end;
$$;

create or replace function smartgov.save_tour_progress(
  p_session_token     text,
  p_completed         jsonb,
  p_dismissed         jsonb,
  p_sidebar_collapsed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_count   bigint;
  v_entry   record;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if p_completed is null or jsonb_typeof(p_completed) <> 'object'
     or p_dismissed is null or jsonb_typeof(p_dismissed) <> 'object'
     or p_sidebar_collapsed is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select count(*) into v_count from jsonb_object_keys(p_completed);
  if v_count > 200 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  select count(*) into v_count from jsonb_object_keys(p_dismissed);
  if v_count > 200 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  for v_entry in
    select key, value from jsonb_each(p_completed)
    union all
    select key, value from jsonb_each(p_dismissed)
  loop
    if v_entry.key !~ '^[a-z0-9][a-z0-9-]{0,79}$'
       or jsonb_typeof(v_entry.value) <> 'string'
       or length(v_entry.value #>> '{}') > 40 then
      return jsonb_build_object('ok', false, 'reason', 'invalid_request');
    end if;
  end loop;

  insert into smartgov.tour_progress (account_id, organization_id, completed, dismissed, sidebar_collapsed)
  values (v_account.id, v_account.organization_id, p_completed, p_dismissed, p_sidebar_collapsed)
  on conflict (account_id) do update
    set completed = excluded.completed,
        dismissed = excluded.dismissed,
        sidebar_collapsed = excluded.sidebar_collapsed,
        organization_id = excluded.organization_id,
        updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.get_tour_progress(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.get_tour_progress(p_session_token); $$;

create or replace function public.save_tour_progress(
  p_session_token     text,
  p_completed         jsonb,
  p_dismissed         jsonb,
  p_sidebar_collapsed boolean
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.save_tour_progress(p_session_token, p_completed, p_dismissed, p_sidebar_collapsed); $$;

revoke execute on function smartgov.get_tour_progress(text) from public, anon, authenticated;
revoke execute on function smartgov.save_tour_progress(text, jsonb, jsonb, boolean) from public, anon, authenticated;

grant execute on function public.get_tour_progress(text) to anon, authenticated;
grant execute on function public.save_tour_progress(text, jsonb, jsonb, boolean) to anon, authenticated;
