alter table smartgov.dashboard_layouts
  add column if not exists widgets jsonb not null default '["stats","reports","task-chart","request-chart","flow"]'::jsonb;

create or replace function smartgov.get_dashboard_preferences(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_layout  jsonb;
  v_widgets jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select l.layout, l.widgets into v_layout, v_widgets
    from smartgov.dashboard_layouts l
   where l.account_id = v_account.id;

  return jsonb_build_object(
    'ok', true,
    'layout', coalesce(v_layout, '[]'::jsonb),
    'widgets', coalesce(v_widgets, '["stats","reports","task-chart","request-chart","flow"]'::jsonb)
  );
end;
$$;

create or replace function smartgov.save_dashboard_preferences(
  p_session_token text,
  p_layout        jsonb,
  p_widgets       jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_saved   jsonb;
  v_widget  jsonb;
  v_id      text;
  v_clean   jsonb := '[]'::jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  v_saved := smartgov.save_dashboard_layout(p_session_token, p_layout);
  if coalesce((v_saved ->> 'ok')::boolean, false) = false then
    return v_saved;
  end if;

  if p_widgets is null or jsonb_typeof(p_widgets) <> 'array' or jsonb_array_length(p_widgets) > 20 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  for v_widget in select * from jsonb_array_elements(p_widgets) loop
    if jsonb_typeof(v_widget) <> 'string' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_request');
    end if;
    v_id := btrim(v_widget #>> '{}');
    if v_id not in ('stats', 'reports', 'task-chart', 'request-chart', 'flow') then
      return jsonb_build_object('ok', false, 'reason', 'invalid_request');
    end if;
    if not (v_clean ? v_id) then
      v_clean := v_clean || to_jsonb(v_id);
    end if;
  end loop;

  update smartgov.dashboard_layouts
     set widgets = v_clean,
         updated_at = now()
   where account_id = v_account.id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.get_dashboard_preferences(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.get_dashboard_preferences(p_session_token); $$;

create or replace function public.save_dashboard_preferences(p_session_token text, p_layout jsonb, p_widgets jsonb)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.save_dashboard_preferences(p_session_token, p_layout, p_widgets); $$;

revoke all on function smartgov.get_dashboard_preferences(text) from public, anon, authenticated;
revoke all on function smartgov.save_dashboard_preferences(text, jsonb, jsonb) from public, anon, authenticated;

grant execute on function public.get_dashboard_preferences(text) to anon, authenticated;
grant execute on function public.save_dashboard_preferences(text, jsonb, jsonb) to anon, authenticated;
