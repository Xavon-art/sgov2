-- 03191 -- Per-account dashboard tile layout.
--
-- The overview is a grid of the sections a signed-in officer can reach. Until
-- now that grid was fixed: the same order for everyone, in the order the nav
-- builder happened to return. This adds a place to remember a person's own
-- arrangement -- which tiles they keep, which they hide, and which span two
-- columns -- without letting a layout name a destination the account cannot
-- open (the reader drops unknown ids against the nav it already built).
--
-- It is account-scoped, not organisation-scoped: two officers in the same
-- council may want their desks arranged differently, and neither arrangement is
-- a fact about the organisation. The row cascades away with the account.

create table if not exists smartgov.dashboard_layouts (
  account_id      uuid primary key references smartgov.accounts (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  layout          jsonb not null default '[]'::jsonb,
  updated_at      timestamptz not null default now()
);

alter table smartgov.dashboard_layouts enable row level security;

revoke all on table smartgov.dashboard_layouts from public, anon, authenticated;

-- ---------------------------------------------------------------- read

create or replace function smartgov.get_dashboard_layout(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_layout  jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select l.layout into v_layout
    from smartgov.dashboard_layouts l
   where l.account_id = v_account.id;

  -- No row is the normal first visit, not an error. An empty array lets the
  -- client render its default arrangement in nav order.
  return jsonb_build_object('ok', true, 'layout', coalesce(v_layout, '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------- write

create or replace function smartgov.save_dashboard_layout(
  p_session_token text,
  p_layout        jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_item    jsonb;
  v_clean   jsonb := '[]'::jsonb;
  v_id      text;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  -- The client is trusted to pick an arrangement, not to decide the shape. A
  -- layout is a short array of small objects; anything else is a bug or a
  -- probe, and both are answered the same way.
  if p_layout is null or jsonb_typeof(p_layout) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if jsonb_array_length(p_layout) > 40 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  for v_item in select * from jsonb_array_elements(p_layout) loop
    if jsonb_typeof(v_item) <> 'object' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_request');
    end if;

    v_id := btrim(coalesce(v_item ->> 'id', ''));
    -- Section ids are short slugs ("request", "events", ...). Refusing anything
    -- else keeps a stale or hand-made payload from smuggling a route into a
    -- tile: the client maps ids through its own nav and ignores what it cannot
    -- place, but storing nonsense would only make that silent drop permanent.
    if v_id = '' or v_id !~ '^[a-z0-9][a-z0-9-]{0,39}$' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_request');
    end if;

    v_clean := v_clean || jsonb_build_array(jsonb_build_object(
      'id',     v_id,
      'hidden', coalesce(v_item -> 'hidden', 'false'::jsonb) = 'true'::jsonb,
      'wide',   coalesce(v_item -> 'wide', 'false'::jsonb) = 'true'::jsonb
    ));
  end loop;

  insert into smartgov.dashboard_layouts (account_id, organization_id, layout)
  values (v_account.id, v_account.organization_id, v_clean)
  on conflict (account_id) do update
    set layout = excluded.layout,
        organization_id = excluded.organization_id,
        updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------- forwards

create or replace function public.get_dashboard_layout(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.get_dashboard_layout(p_session_token); $$;

create or replace function public.save_dashboard_layout(p_session_token text, p_layout jsonb)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.save_dashboard_layout(p_session_token, p_layout); $$;

-- ---------------------------------------------------------------- grants

revoke execute on function smartgov.get_dashboard_layout(text) from public, anon, authenticated;
revoke execute on function smartgov.save_dashboard_layout(text, jsonb) from public, anon, authenticated;

grant execute on function public.get_dashboard_layout(text)          to anon, authenticated;
grant execute on function public.save_dashboard_layout(text, jsonb)  to anon, authenticated;
