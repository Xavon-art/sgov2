-- 03200 -- Resolutions.
--
-- A resolution is a formal position a unit (or the whole organisation) puts on
-- the record. An LSG officer files one for their own unit; a USG officer files
-- one org-wide, or scoped to a single unit. The USG office then moves it
-- through review: under review, approved or returned, and finally published.
--
-- Two rules from the rest of the codebase are kept exactly:
--   * No RLS policy and no table grant. Every path in is a `security definer`
--     function that resolves the caller from the session token first, and the
--     only reachable surface is the explicit `public.*` allowlist at the bottom.
--   * Identity, role, unit and organisation are derived inside SQL from the
--     session. A caller can never name another unit's row.

create table if not exists smartgov.resolutions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  unit_id         uuid,
  created_by      uuid not null references smartgov.accounts (id) on delete cascade,
  title           text not null,
  body            text not null,
  scope           text not null default 'unit' check (scope in ('unit', 'org')),
  status          text not null default 'submitted'
    check (status in ('submitted', 'under_review', 'approved', 'returned', 'published')),
  decision_remark text,
  decided_by      uuid references smartgov.accounts (id) on delete set null,
  decided_at      timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists resolutions_org_status_idx
  on smartgov.resolutions (organization_id, status);

create table if not exists smartgov.resolution_reviews (
  id            uuid primary key default gen_random_uuid(),
  resolution_id uuid not null references smartgov.resolutions (id) on delete cascade,
  reviewer_id   uuid references smartgov.accounts (id) on delete set null,
  decision      text not null,
  remark        text,
  created_at    timestamptz not null default now()
);

create index if not exists resolution_reviews_resolution_idx
  on smartgov.resolution_reviews (resolution_id, created_at);

-- ---------------------------------------------------------------------------
-- 1. create_resolution
-- ---------------------------------------------------------------------------
create or replace function smartgov.create_resolution(
  p_session_token text,
  p_title text,
  p_body text,
  p_unit_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_usg     boolean;
  v_scope   text := 'unit';
  v_unit_id uuid;
  v_id      uuid;
  v_title   text := trim(coalesce(p_title, ''));
  v_body    text := trim(coalesce(p_body, ''));
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  if length(v_title) < 4 or length(v_title) > 160 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_title');
  end if;
  if length(v_body) < 10 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_body');
  end if;

  v_usg := smartgov.is_usg_side(v_account);

  if v_usg then
    -- A USG officer may scope a resolution to one unit of their organisation,
    -- or leave it org-wide. A unit id that is not theirs is refused rather than
    -- silently widened.
    if p_unit_id is not null then
      if not exists (
        select 1 from public.governance_units u
        where u.id = p_unit_id
          and u.organization_id = v_account.organization_id
      ) then
        return jsonb_build_object('ok', false, 'reason', 'not_found');
      end if;
      v_scope := 'unit';
      v_unit_id := p_unit_id;
    else
      v_scope := 'org';
      v_unit_id := null;
    end if;
  else
    -- An LSG officer files only for the unit they sit in, resolved from the
    -- session. Any client-supplied unit id is ignored.
    v_unit_id := smartgov.my_lsg_unit(v_account);
    if v_unit_id is null then
      return jsonb_build_object('ok', false, 'reason', 'no_unit');
    end if;
    v_scope := 'unit';
  end if;

  insert into smartgov.resolutions
    (organization_id, unit_id, created_by, title, body, scope)
  values
    (v_account.organization_id, v_unit_id, v_account.id, v_title, v_body, v_scope)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function smartgov.create_resolution(text, text, text, uuid) from public;

-- ---------------------------------------------------------------------------
-- 2. list_resolutions
-- ---------------------------------------------------------------------------
create or replace function smartgov.list_resolutions(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_usg     boolean;
  v_unit_id uuid;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  v_usg := smartgov.is_usg_side(v_account);
  v_unit_id := smartgov.my_lsg_unit(v_account);

  return jsonb_build_object(
    'ok', true,
    'canReview', v_usg,
    'rows', coalesce((
      select jsonb_agg(row order by row->>'createdAt' desc)
      from (
        select jsonb_build_object(
          'id', r.id,
          'title', r.title,
          'status', r.status,
          'scope', r.scope,
          'unitId', r.unit_id,
          'unitName', u.name,
          'createdAt', r.created_at,
          'decidedAt', r.decided_at,
          'decisionRemark', r.decision_remark
        ) as row
        from smartgov.resolutions r
        left join public.governance_units u on u.id = r.unit_id
        where r.organization_id = v_account.organization_id
          and (
            v_usg
            or r.unit_id = v_unit_id
            or (r.scope = 'org' and r.status in ('approved', 'published'))
          )
      ) s
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_resolutions(text) from public;

-- ---------------------------------------------------------------------------
-- 3. get_resolution
-- ---------------------------------------------------------------------------
create or replace function smartgov.get_resolution(
  p_session_token text,
  p_resolution_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_usg     boolean;
  v_unit_id uuid;
  v_row     smartgov.resolutions%rowtype;
  v_name    text;
  v_visible boolean;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  v_usg := smartgov.is_usg_side(v_account);
  v_unit_id := smartgov.my_lsg_unit(v_account);

  select r.* into v_row
  from smartgov.resolutions r
  where r.id = p_resolution_id
    and r.organization_id = v_account.organization_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_visible := v_usg
    or v_row.unit_id = v_unit_id
    or (v_row.scope = 'org' and v_row.status in ('approved', 'published'));

  if not v_visible then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select u.name into v_name
  from public.governance_units u
  where u.id = v_row.unit_id;

  return jsonb_build_object(
    'ok', true,
    'canReview', v_usg,
    'item', jsonb_build_object(
      'id', v_row.id,
      'title', v_row.title,
      'body', v_row.body,
      'status', v_row.status,
      'scope', v_row.scope,
      'unitId', v_row.unit_id,
      'unitName', v_name,
      'createdAt', v_row.created_at,
      'decidedAt', v_row.decided_at,
      'decisionRemark', v_row.decision_remark,
      'timeline', coalesce((
        select jsonb_agg(jsonb_build_object(
          'decision', rr.decision,
          'remark', rr.remark,
          'reviewerName', a.display_name,
          'createdAt', rr.created_at
        ) order by rr.created_at asc)
        from smartgov.resolution_reviews rr
        left join smartgov.accounts a on a.id = rr.reviewer_id
        where rr.resolution_id = v_row.id
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function smartgov.get_resolution(text, uuid) from public;

-- ---------------------------------------------------------------------------
-- 4. review_resolution (USG only)
-- ---------------------------------------------------------------------------
create or replace function smartgov.review_resolution(
  p_session_token text,
  p_resolution_id uuid,
  p_decision text,
  p_remark text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account  smartgov.accounts%rowtype;
  v_row      smartgov.resolutions%rowtype;
  v_decision text := lower(trim(coalesce(p_decision, '')));
  v_remark   text := nullif(trim(coalesce(p_remark, '')), '');
  v_final    boolean;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  if not smartgov.is_usg_side(v_account) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_decision not in ('under_review', 'approved', 'returned', 'published') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if v_decision = 'returned' and v_remark is null then
    return jsonb_build_object('ok', false, 'reason', 'remark_required');
  end if;

  select r.* into v_row
  from smartgov.resolutions r
  where r.id = p_resolution_id
    and r.organization_id = v_account.organization_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  insert into smartgov.resolution_reviews (resolution_id, reviewer_id, decision, remark)
  values (v_row.id, v_account.id, v_decision, v_remark);

  v_final := v_decision in ('approved', 'returned', 'published');

  update smartgov.resolutions
     set status = v_decision,
         decision_remark = case when v_final then v_remark else decision_remark end,
         decided_by = case when v_final then v_account.id else decided_by end,
         decided_at = case when v_final then now() else decided_at end
   where id = v_row.id;

  return jsonb_build_object('ok', true, 'id', v_row.id, 'status', v_decision);
end;
$$;

revoke all on function smartgov.review_resolution(text, uuid, text, text) from public;

-- ---------------------------------------------------------------------------
-- 5. PostgREST forwarders.
-- ---------------------------------------------------------------------------
create or replace function public.create_resolution(p_session_token text, p_title text, p_body text, p_unit_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.create_resolution(p_session_token, p_title, p_body, p_unit_id); $$;
revoke all on function public.create_resolution(text, text, text, uuid) from public;
grant execute on function public.create_resolution(text, text, text, uuid) to anon, authenticated;

create or replace function public.list_resolutions(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_resolutions(p_session_token); $$;
revoke all on function public.list_resolutions(text) from public;
grant execute on function public.list_resolutions(text) to anon, authenticated;

create or replace function public.get_resolution(p_session_token text, p_resolution_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.get_resolution(p_session_token, p_resolution_id); $$;
revoke all on function public.get_resolution(text, uuid) from public;
grant execute on function public.get_resolution(text, uuid) to anon, authenticated;

create or replace function public.review_resolution(p_session_token text, p_resolution_id uuid, p_decision text, p_remark text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.review_resolution(p_session_token, p_resolution_id, p_decision, p_remark); $$;
revoke all on function public.review_resolution(text, uuid, text, text) from public;
grant execute on function public.review_resolution(text, uuid, text, text) to anon, authenticated;
