create table if not exists smartgov.feedback_forms (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_by      uuid not null references smartgov.accounts (id) on delete cascade,
  title           text not null check (length(btrim(title)) between 3 and 200),
  description     text check (description is null or length(description) <= 4000),
  status          text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  access_mode     text not null default 'signed_in' check (access_mode in ('signed_in', 'public_link')),
  identity_mode   text not null default 'identified' check (identity_mode in ('identified', 'anonymous')),
  public_slug     text unique,
  scope           text not null default 'unit' check (scope in ('university', 'unit_type', 'units', 'unit')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  opened_at       timestamptz,
  closed_at       timestamptz
);

create table if not exists smartgov.feedback_form_scopes (
  id        uuid primary key default gen_random_uuid(),
  form_id   uuid not null references smartgov.feedback_forms (id) on delete cascade,
  unit_type text,
  unit_id   uuid references public.governance_units (id) on delete cascade,
  check (unit_type is not null or unit_id is not null)
);

create unique index if not exists feedback_form_scopes_unique_idx
  on smartgov.feedback_form_scopes (
    form_id,
    coalesce(unit_type, ''),
    coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
create index if not exists feedback_form_scopes_unit_idx
  on smartgov.feedback_form_scopes (unit_id);

create table if not exists smartgov.feedback_questions (
  id               uuid primary key default gen_random_uuid(),
  form_id          uuid not null references smartgov.feedback_forms (id) on delete cascade,
  order_index      integer not null default 0,
  qtype            text not null check (qtype in ('short_text','long_text','multiple_choice','checkbox','dropdown','rating','linear_scale','date','time')),
  field_key        text check (field_key is null or field_key in ('full_name','email','student_number','year_level','program','section','campus')),
  title            text not null check (length(btrim(title)) between 1 and 200),
  description      text check (description is null or length(description) <= 1000),
  required         boolean not null default false,
  options          jsonb not null default '[]'::jsonb,
  scale_min        integer,
  scale_max        integer,
  scale_label_low  text check (scale_label_low is null or length(scale_label_low) <= 80),
  scale_label_high text check (scale_label_high is null or length(scale_label_high) <= 80),
  check (jsonb_typeof(options) = 'array')
);
create index if not exists feedback_questions_form_order_idx
  on smartgov.feedback_questions (form_id, order_index);

create table if not exists smartgov.feedback_responses (
  id              uuid primary key default gen_random_uuid(),
  form_id         uuid not null references smartgov.feedback_forms (id) on delete cascade,
  submitted_by    uuid references smartgov.accounts (id) on delete set null,
  respondent_name text,
  respondent_email text,
  answers         jsonb not null default '{}'::jsonb,
  status          text not null default 'new' check (status in ('new', 'acknowledged')),
  acknowledged_by uuid references smartgov.accounts (id) on delete set null,
  acknowledged_at timestamptz,
  submitted_at    timestamptz not null default now(),
  check (jsonb_typeof(answers) = 'object')
);
create index if not exists feedback_responses_form_status_idx
  on smartgov.feedback_responses (form_id, status, submitted_at desc);

alter table smartgov.feedback_forms enable row level security;
alter table smartgov.feedback_form_scopes enable row level security;
alter table smartgov.feedback_questions enable row level security;
alter table smartgov.feedback_responses enable row level security;

revoke all on smartgov.feedback_forms from public, anon, authenticated;
revoke all on smartgov.feedback_form_scopes from public, anon, authenticated;
revoke all on smartgov.feedback_questions from public, anon, authenticated;
revoke all on smartgov.feedback_responses from public, anon, authenticated;

alter table smartgov.account_permissions drop constraint if exists account_permissions_known;
alter table smartgov.account_permissions
  add constraint account_permissions_known
  check (permission in ('can_invite', 'can_target_units'));

create or replace function smartgov.grant_permission(
  p_session_token text,
  p_email         text,
  p_permission    text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_caller smartgov.accounts%rowtype;
  v_target smartgov.accounts%rowtype;
begin
  v_caller := smartgov.authenticate(p_session_token);

  if v_caller.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_caller.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if p_permission not in ('can_invite', 'can_target_units') then
    return jsonb_build_object('ok', false, 'reason', 'unknown_permission');
  end if;

  select a.* into v_target
    from smartgov.accounts a
   where lower(a.email) = lower(btrim(p_email))
     and a.organization_id = v_caller.organization_id
     and a.status = 'active';

  if v_target.id is null then
    return jsonb_build_object('ok', false, 'reason', 'account_not_found');
  end if;

  if v_target.account_scope = 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'owner_is_always_admin');
  end if;

  insert into smartgov.account_permissions (
    organization_id, account_id, permission, granted_by
  )
  values (
    v_caller.organization_id, v_target.id, p_permission, v_caller.id
  )
  on conflict (account_id, permission)
  do update set granted_by = v_caller.id, granted_at = now();

  return jsonb_build_object('ok', true, 'email', v_target.email, 'permission', p_permission);
end;
$$;

revoke all on function smartgov.grant_permission(text, text, text) from public;

create or replace function smartgov.feedback_form_can_manage(
  p_account smartgov.accounts,
  p_form    smartgov.feedback_forms
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select p_account.id is not null
     and p_form.id is not null
     and p_account.organization_id is not null
     and p_form.organization_id = p_account.organization_id
     and (
       p_account.account_scope = 'owner'
       or smartgov.is_org_reviewer(p_account.id, p_account.organization_id)
       or p_form.created_by = p_account.id
     );
$$;

revoke all on function smartgov.feedback_form_can_manage(smartgov.accounts, smartgov.feedback_forms) from public;

create or replace function smartgov.feedback_form_can_review(
  p_account smartgov.accounts,
  p_form    smartgov.feedback_forms
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select smartgov.feedback_form_can_manage(p_account, p_form);
$$;

revoke all on function smartgov.feedback_form_can_review(smartgov.accounts, smartgov.feedback_forms) from public;

create or replace function smartgov.feedback_form_matches_account(
  p_account smartgov.accounts,
  p_form    smartgov.feedback_forms
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select p_account.id is not null
     and p_form.id is not null
     and p_form.status = 'open'
     and p_form.organization_id = p_account.organization_id
     and (
       p_form.scope = 'university'
       or (
         p_form.scope = 'unit_type'
         and exists (
           select 1
             from smartgov.lsg_unit_ids(p_account.id, p_account.organization_id) u
             join public.governance_units gu
               on gu.id = u
              and gu.organization_id = p_account.organization_id
             join smartgov.feedback_form_scopes s
               on s.form_id = p_form.id
              and s.unit_type = gu.unit_type::text
         )
       )
       or (
         p_form.scope in ('units', 'unit')
         and exists (
           select 1
             from smartgov.lsg_unit_ids(p_account.id, p_account.organization_id) u
             join smartgov.feedback_form_scopes s
               on s.form_id = p_form.id
              and s.unit_id = u
         )
       )
     );
$$;

revoke all on function smartgov.feedback_form_matches_account(smartgov.accounts, smartgov.feedback_forms) from public;

create or replace function smartgov.feedback_form_is_locked(p_form_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select exists (
    select 1
      from smartgov.feedback_responses r
     where r.form_id = p_form_id
  );
$$;

revoke all on function smartgov.feedback_form_is_locked(uuid) from public;

create or replace function smartgov.validate_feedback_form_audience(
  p_account    smartgov.accounts,
  p_scope      text,
  p_unit_ids   uuid[],
  p_unit_types text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_scope text := lower(btrim(coalesce(p_scope, '')));
  v_ids   uuid[] := array(
    select distinct u
      from unnest(coalesce(p_unit_ids, '{}'::uuid[])) u
     where u is not null
  );
  v_types text[] := array(
    select distinct lower(btrim(t))
      from unnest(coalesce(p_unit_types, '{}'::text[])) t
     where nullif(btrim(t), '') is not null
  );
  v_is_usg boolean;
begin
  if p_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if p_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  v_is_usg := p_account.account_scope = 'owner'
              or smartgov.is_org_reviewer(p_account.id, p_account.organization_id);

  if v_scope not in ('university', 'unit_type', 'units', 'unit') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_audience');
  end if;

  if v_scope in ('university', 'unit_type') and not v_is_usg then
    return jsonb_build_object('ok', false, 'reason', 'invalid_audience');
  end if;

  if v_scope = 'university' then
    return jsonb_build_object('ok', true);
  end if;

  if v_scope = 'unit_type' then
    if coalesce(array_length(v_ids, 1), 0) <> 0
       or coalesce(array_length(v_types, 1), 0) = 0 then
      return jsonb_build_object('ok', false, 'reason', 'invalid_audience');
    end if;
    if exists (
      select 1
        from unnest(v_types) t
       where not exists (
         select 1
           from public.governance_units gu
          where gu.organization_id = p_account.organization_id
            and gu.unit_type::text = t
       )
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_audience');
    end if;
    return jsonb_build_object('ok', true);
  end if;

  if coalesce(array_length(v_types, 1), 0) <> 0
     or coalesce(array_length(v_ids, 1), 0) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_audience');
  end if;
  if v_scope = 'unit' and array_length(v_ids, 1) <> 1 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_audience');
  end if;
  if exists (
    select 1
      from unnest(v_ids) u
     where not exists (
       select 1
         from public.governance_units gu
        where gu.id = u
          and gu.organization_id = p_account.organization_id
     )
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_audience');
  end if;

  if not v_is_usg
     and not ('can_target_units' = any (smartgov.permissions_for(p_account)))
     and exists (
       select 1
         from unnest(v_ids) u
        where not exists (
          select 1
            from smartgov.lsg_unit_ids(p_account.id, p_account.organization_id) own
           where own = u
        )
     ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_audience');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.validate_feedback_form_audience(smartgov.accounts, text, uuid[], text[]) from public;

create or replace function smartgov.list_feedback_forms(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_usg     boolean;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  v_usg := v_account.account_scope = 'owner'
           or smartgov.is_org_reviewer(v_account.id, v_account.organization_id);

  return jsonb_build_object(
    'ok', true,
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', f.id,
          'title', f.title,
          'description', f.description,
          'status', f.status,
          'scope', f.scope,
          'accessMode', f.access_mode,
          'identityMode', f.identity_mode,
          'audienceSummary', case f.scope
            when 'university' then 'University-wide'
            when 'unit_type' then coalesce(
              'Unit type: ' || (
                select string_agg(distinct s.unit_type, ', ')
                  from smartgov.feedback_form_scopes s
                 where s.form_id = f.id
              ),
              'Unit type'
            )
            when 'units' then (
              select count(*)::text || ' selected units'
                from smartgov.feedback_form_scopes s
               where s.form_id = f.id
                 and s.unit_id is not null
            )
            else 'Single unit'
          end,
          'responseCount', (
            select count(*)
              from smartgov.feedback_responses r
             where r.form_id = f.id
          ),
          'questionCount', (
            select count(*)
              from smartgov.feedback_questions q
             where q.form_id = f.id
          ),
          'canManage', v_usg or f.created_by = v_account.id,
          'canReview', v_usg or f.created_by = v_account.id,
          'publicPath', case
            when (v_usg or f.created_by = v_account.id)
             and f.public_slug is not null
            then '/feedback/f/' || f.public_slug
            else null
          end,
          'createdAt', f.created_at,
          'openedAt', f.opened_at,
          'closedAt', f.closed_at
        )
        order by f.created_at desc, f.id desc
      )
      from smartgov.feedback_forms f
      where f.organization_id = v_account.organization_id
        and (v_usg or f.created_by = v_account.id)
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_feedback_forms(text) from public;

create or replace function smartgov.get_feedback_form(
  p_session_token text,
  p_form_id       uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_form    smartgov.feedback_forms%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  select f.* into v_form
    from smartgov.feedback_forms f
   where f.id = p_form_id;

  if v_form.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_form.organization_id <> v_account.organization_id then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not smartgov.feedback_form_can_manage(v_account, v_form) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'form', jsonb_build_object(
      'id', v_form.id,
      'title', v_form.title,
      'description', v_form.description,
      'status', v_form.status,
      'scope', v_form.scope,
      'accessMode', v_form.access_mode,
      'identityMode', v_form.identity_mode,
      'createdAt', v_form.created_at,
      'updatedAt', v_form.updated_at,
      'openedAt', v_form.opened_at,
      'closedAt', v_form.closed_at,
      'responseCount', (
        select count(*)
          from smartgov.feedback_responses r
         where r.form_id = v_form.id
      ),
      'questionCount', (
        select count(*)
          from smartgov.feedback_questions q
         where q.form_id = v_form.id
      ),
      'questionsLocked', smartgov.feedback_form_is_locked(v_form.id),
      'canManage', true,
      'canReview', smartgov.feedback_form_can_review(v_account, v_form),
      'publicPath', case
        when v_form.public_slug is not null
        then '/feedback/f/' || v_form.public_slug
        else null
      end
    ),
    'scopes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'unitType', s.unit_type,
          'unitId', s.unit_id
        )
        order by s.unit_type nulls last, s.unit_id
      )
        from smartgov.feedback_form_scopes s
       where s.form_id = v_form.id
    ), '[]'::jsonb),
    'questions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', q.id,
          'orderIndex', q.order_index,
          'qtype', q.qtype,
          'fieldKey', q.field_key,
          'title', q.title,
          'description', q.description,
          'required', q.required,
          'options', q.options,
          'scaleMin', q.scale_min,
          'scaleMax', q.scale_max,
          'scaleLabelLow', q.scale_label_low,
          'scaleLabelHigh', q.scale_label_high
        )
        order by q.order_index, q.id
      )
        from smartgov.feedback_questions q
       where q.form_id = v_form.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.get_feedback_form(text, uuid) from public;

create or replace function smartgov.create_feedback_form(
  p_session_token text,
  p_title         text,
  p_description   text,
  p_scope         text,
  p_unit_ids      uuid[],
  p_unit_types    text[],
  p_access_mode   text,
  p_identity_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account  smartgov.accounts%rowtype;
  v_usg      boolean;
  v_scope    text := lower(btrim(coalesce(p_scope, 'unit')));
  v_access   text := lower(btrim(coalesce(p_access_mode, 'signed_in')));
  v_identity text := lower(btrim(coalesce(p_identity_mode, 'identified')));
  v_title    text := btrim(coalesce(p_title, ''));
  v_desc     text := nullif(btrim(coalesce(p_description, '')), '');
  v_ids      uuid[] := array(
    select distinct u
      from unnest(coalesce(p_unit_ids, '{}'::uuid[])) u
     where u is not null
  );
  v_types    text[] := array(
    select distinct lower(btrim(t))
      from unnest(coalesce(p_unit_types, '{}'::text[])) t
     where nullif(btrim(t), '') is not null
  );
  v_check    jsonb;
  v_form_id  uuid;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  if length(v_title) < 3 or length(v_title) > 200 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_form_title');
  end if;
  if v_desc is not null and length(v_desc) > 4000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_form_description');
  end if;
  if v_access not in ('signed_in', 'public_link')
     or v_identity not in ('identified', 'anonymous') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_usg := v_account.account_scope = 'owner'
           or smartgov.is_org_reviewer(v_account.id, v_account.organization_id);

  if not v_usg then
    if not exists (
      select 1
        from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    if v_scope in ('unit', 'units')
       and coalesce(array_length(v_ids, 1), 0) = 0 then
      v_ids := array(
        select u
          from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u
         order by u
      );
    end if;
    if v_scope = 'unit' and coalesce(array_length(v_ids, 1), 0) <> 1 then
      v_scope := 'units';
    end if;
  end if;

  v_check := smartgov.validate_feedback_form_audience(
    v_account, v_scope, v_ids, v_types
  );
  if not (v_check->>'ok')::boolean then
    return jsonb_build_object(
      'ok', false,
      'reason', coalesce(v_check->>'reason', 'invalid_audience')
    );
  end if;

  insert into smartgov.feedback_forms (
    organization_id, created_by, title, description, status,
    access_mode, identity_mode, scope
  )
  values (
    v_account.organization_id, v_account.id, v_title, v_desc, 'draft',
    v_access, v_identity, v_scope
  )
  returning id into v_form_id;

  if v_scope = 'unit_type' then
    insert into smartgov.feedback_form_scopes (form_id, unit_type)
    select v_form_id, t from unnest(v_types) t;
  elsif v_scope in ('unit', 'units') then
    insert into smartgov.feedback_form_scopes (form_id, unit_id)
    select v_form_id, u from unnest(v_ids) u;
  end if;

  perform smartgov.log_audit(
    p_session_token, 'feedback_form_create', 'feedback_form', v_form_id, '{}'::jsonb
  );

  return jsonb_build_object('ok', true, 'formId', v_form_id);
end;
$$;

revoke all on function smartgov.create_feedback_form(text, text, text, text, uuid[], text[], text, text) from public;

create or replace function smartgov.update_feedback_form(
  p_session_token text,
  p_form_id       uuid,
  p_title         text,
  p_description   text,
  p_scope         text,
  p_unit_ids      uuid[],
  p_unit_types    text[],
  p_access_mode   text,
  p_identity_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account       smartgov.accounts%rowtype;
  v_form          smartgov.feedback_forms%rowtype;
  v_usg           boolean;
  v_scope         text;
  v_access        text;
  v_identity      text;
  v_title         text := btrim(coalesce(p_title, ''));
  v_desc          text := nullif(btrim(coalesce(p_description, '')), '');
  v_ids           uuid[];
  v_types         text[];
  v_current_ids   uuid[];
  v_current_types text[];
  v_check         jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  select f.* into v_form
    from smartgov.feedback_forms f
   where f.id = p_form_id;

  if v_form.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_form.organization_id <> v_account.organization_id then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not smartgov.feedback_form_can_manage(v_account, v_form) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if length(v_title) < 3 or length(v_title) > 200 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_form_title');
  end if;
  if v_desc is not null and length(v_desc) > 4000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_form_description');
  end if;

  v_scope := lower(btrim(coalesce(nullif(p_scope, ''), v_form.scope)));
  v_access := lower(btrim(coalesce(nullif(p_access_mode, ''), v_form.access_mode)));
  v_identity := lower(btrim(coalesce(nullif(p_identity_mode, ''), v_form.identity_mode)));
  if v_access not in ('signed_in', 'public_link')
     or v_identity not in ('identified', 'anonymous') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_ids := array(
    select distinct u
      from unnest(coalesce(p_unit_ids, '{}'::uuid[])) u
     where u is not null
  );
  v_types := array(
    select distinct lower(btrim(t))
      from unnest(coalesce(p_unit_types, '{}'::text[])) t
     where nullif(btrim(t), '') is not null
  );
  v_current_ids := array(
    select s.unit_id
      from smartgov.feedback_form_scopes s
     where s.form_id = v_form.id
       and s.unit_id is not null
     order by s.unit_id
  );
  v_current_types := array(
    select s.unit_type
      from smartgov.feedback_form_scopes s
     where s.form_id = v_form.id
       and s.unit_type is not null
     order by s.unit_type
  );

  if coalesce(array_length(v_ids, 1), 0) = 0
     and coalesce(array_length(v_types, 1), 0) = 0
     and v_scope = v_form.scope then
    v_ids := v_current_ids;
    v_types := v_current_types;
  end if;

  v_usg := v_account.account_scope = 'owner'
           or smartgov.is_org_reviewer(v_account.id, v_account.organization_id);

  if not v_usg
     and v_scope in ('unit', 'units')
     and coalesce(array_length(v_ids, 1), 0) = 0 then
    v_ids := array(
      select u
        from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u
       order by u
    );
  end if;

  if not v_usg
     and v_scope = 'unit'
     and coalesce(array_length(v_ids, 1), 0) <> 1 then
    v_scope := 'units';
  end if;

  v_ids := array(select u from unnest(v_ids) u order by u);
  v_types := array(select t from unnest(v_types) t order by t);

  if v_form.status <> 'draft' then
    if v_scope <> v_form.scope
       or v_access <> v_form.access_mode
       or v_identity <> v_form.identity_mode
       or (
         v_scope = 'unit_type'
         and v_types is distinct from v_current_types
       )
       or (
         v_scope in ('unit', 'units')
         and v_ids is distinct from v_current_ids
       ) then
      return jsonb_build_object('ok', false, 'reason', 'form_locked');
    end if;
  end if;

  v_check := smartgov.validate_feedback_form_audience(
    v_account, v_scope, v_ids, v_types
  );
  if not (v_check->>'ok')::boolean then
    return jsonb_build_object(
      'ok', false,
      'reason', coalesce(v_check->>'reason', 'invalid_audience')
    );
  end if;

  update smartgov.feedback_forms
     set title = v_title,
         description = v_desc,
         scope = v_scope,
         access_mode = v_access,
         identity_mode = v_identity,
         updated_at = now()
   where id = v_form.id;

  if v_form.status = 'draft' then
    delete from smartgov.feedback_form_scopes s
     where s.form_id = v_form.id;

    if v_scope = 'unit_type' then
      insert into smartgov.feedback_form_scopes (form_id, unit_type)
      select v_form.id, t from unnest(v_types) t;
    elsif v_scope in ('unit', 'units') then
      insert into smartgov.feedback_form_scopes (form_id, unit_id)
      select v_form.id, u from unnest(v_ids) u;
    end if;
  end if;

  perform smartgov.log_audit(
    p_session_token, 'feedback_form_update', 'feedback_form', v_form.id, '{}'::jsonb
  );

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.update_feedback_form(text, uuid, text, text, text, uuid[], text[], text, text) from public;

create or replace function public.list_feedback_forms(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_feedback_forms(p_session_token); $$;
revoke all on function public.list_feedback_forms(text) from public;
grant execute on function public.list_feedback_forms(text) to anon, authenticated;

create or replace function public.get_feedback_form(p_session_token text, p_form_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.get_feedback_form(p_session_token, p_form_id); $$;
revoke all on function public.get_feedback_form(text, uuid) from public;
grant execute on function public.get_feedback_form(text, uuid) to anon, authenticated;

create or replace function public.create_feedback_form(
  p_session_token text,
  p_title         text,
  p_description   text,
  p_scope         text,
  p_unit_ids      uuid[],
  p_unit_types    text[],
  p_access_mode   text,
  p_identity_mode text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select smartgov.create_feedback_form(
    p_session_token, p_title, p_description, p_scope,
    p_unit_ids, p_unit_types, p_access_mode, p_identity_mode
  );
$$;
revoke all on function public.create_feedback_form(text, text, text, text, uuid[], text[], text, text) from public;
grant execute on function public.create_feedback_form(text, text, text, text, uuid[], text[], text, text) to anon, authenticated;

create or replace function public.update_feedback_form(
  p_session_token text,
  p_form_id       uuid,
  p_title         text,
  p_description   text,
  p_scope         text,
  p_unit_ids      uuid[],
  p_unit_types    text[],
  p_access_mode   text,
  p_identity_mode text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select smartgov.update_feedback_form(
    p_session_token, p_form_id, p_title, p_description, p_scope,
    p_unit_ids, p_unit_types, p_access_mode, p_identity_mode
  );
$$;
revoke all on function public.update_feedback_form(text, uuid, text, text, text, uuid[], text[], text, text) from public;
grant execute on function public.update_feedback_form(text, uuid, text, text, text, uuid[], text[], text, text) to anon, authenticated;

create or replace function smartgov.save_feedback_questions(
  p_session_token text,
  p_form_id       uuid,
  p_questions     jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account     smartgov.accounts%rowtype;
  v_form        smartgov.feedback_forms%rowtype;
  v_item        jsonb;
  v_qtype       text;
  v_field       text;
  v_title       text;
  v_desc        text;
  v_required    boolean;
  v_options     jsonb;
  v_opt_text    text[];
  v_low         text;
  v_high        text;
  v_min_text    text;
  v_max_text    text;
  v_min         integer;
  v_max         integer;
  v_index       integer := 0;
  v_count       integer;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  select f.* into v_form
    from smartgov.feedback_forms f
   where f.id = p_form_id;

  if v_form.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_form.organization_id <> v_account.organization_id then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not smartgov.feedback_form_can_manage(v_account, v_form) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if smartgov.feedback_form_is_locked(v_form.id) then
    return jsonb_build_object('ok', false, 'reason', 'questions_locked');
  end if;

  if p_questions is null or jsonb_typeof(p_questions) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_questions');
  end if;
  v_count := jsonb_array_length(p_questions);
  if v_count > 50 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_questions');
  end if;

  for v_item in select value from jsonb_array_elements(p_questions) loop
    v_qtype := lower(btrim(coalesce(v_item->>'qtype', '')));
    v_field := nullif(lower(btrim(coalesce(v_item->>'fieldKey', ''))), '');
    v_title := btrim(coalesce(v_item->>'title', ''));
    v_desc := nullif(btrim(coalesce(v_item->>'description', '')), '');

    if v_qtype not in (
      'short_text', 'long_text', 'multiple_choice', 'checkbox',
      'dropdown', 'rating', 'linear_scale', 'date', 'time'
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_questions');
    end if;
    if v_field is not null and v_field not in (
      'full_name', 'email', 'student_number', 'year_level',
      'program', 'section', 'campus'
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_questions');
    end if;
    if length(v_title) < 1 or length(v_title) > 200 then
      return jsonb_build_object('ok', false, 'reason', 'invalid_questions');
    end if;
    if v_desc is not null and length(v_desc) > 1000 then
      return jsonb_build_object('ok', false, 'reason', 'invalid_questions');
    end if;

    if v_item ? 'required' and jsonb_typeof(v_item->'required') <> 'boolean' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_questions');
    end if;
    v_required := coalesce((v_item->>'required')::boolean, false);

    if v_item ? 'options' and jsonb_typeof(v_item->'options') <> 'array' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_questions');
    end if;
    v_options := coalesce(v_item->'options', '[]'::jsonb);
    if exists (
      select 1
        from jsonb_array_elements(v_options) e
       where jsonb_typeof(e) <> 'string'
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_questions');
    end if;
    v_opt_text := array(
      select btrim(e)
        from jsonb_array_elements_text(v_options) e
    );
    if exists (
      select 1
        from unnest(v_opt_text) opt
       where length(opt) < 1 or length(opt) > 120
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_questions');
    end if;
    if (select count(*) from unnest(v_opt_text) opt)
       <> (select count(distinct opt) from unnest(v_opt_text) opt) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_questions');
    end if;

    v_low := nullif(btrim(coalesce(v_item->>'scaleLabelLow', '')), '');
    v_high := nullif(btrim(coalesce(v_item->>'scaleLabelHigh', '')), '');
    if (v_low is not null and length(v_low) > 80)
       or (v_high is not null and length(v_high) > 80) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_questions');
    end if;

    v_min_text := nullif(btrim(coalesce(v_item->>'scaleMin', '')), '');
    v_max_text := nullif(btrim(coalesce(v_item->>'scaleMax', '')), '');
    v_min := null;
    v_max := null;
    if v_min_text is not null then
      if v_min_text !~ '^[0-9]+$' then
        return jsonb_build_object('ok', false, 'reason', 'invalid_questions');
      end if;
      v_min := v_min_text::integer;
      if v_min < 1 or v_min > 10 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_questions');
      end if;
    end if;
    if v_max_text is not null then
      if v_max_text !~ '^[0-9]+$' then
        return jsonb_build_object('ok', false, 'reason', 'invalid_questions');
      end if;
      v_max := v_max_text::integer;
      if v_max < 1 or v_max > 10 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_questions');
      end if;
    end if;

    if v_qtype in ('multiple_choice', 'checkbox', 'dropdown') then
      if array_length(v_opt_text, 1) is null
         or array_length(v_opt_text, 1) < 2
         or array_length(v_opt_text, 1) > 20 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_questions');
      end if;
      if v_min is not null or v_max is not null
         or v_low is not null or v_high is not null then
        return jsonb_build_object('ok', false, 'reason', 'invalid_questions');
      end if;
    elsif v_qtype = 'linear_scale' then
      if v_min is null or v_max is null or v_min >= v_max then
        return jsonb_build_object('ok', false, 'reason', 'invalid_questions');
      end if;
      if array_length(v_opt_text, 1) is not null then
        return jsonb_build_object('ok', false, 'reason', 'invalid_questions');
      end if;
    else
      if array_length(v_opt_text, 1) is not null
         or v_min is not null or v_max is not null
         or v_low is not null or v_high is not null then
        return jsonb_build_object('ok', false, 'reason', 'invalid_questions');
      end if;
    end if;
  end loop;

  delete from smartgov.feedback_questions q
   where q.form_id = v_form.id;

  for v_item in select value from jsonb_array_elements(p_questions) loop
    v_qtype := lower(btrim(coalesce(v_item->>'qtype', '')));
    v_field := nullif(lower(btrim(coalesce(v_item->>'fieldKey', ''))), '');
    v_title := btrim(coalesce(v_item->>'title', ''));
    v_desc := nullif(btrim(coalesce(v_item->>'description', '')), '');
    v_required := coalesce((v_item->>'required')::boolean, false);
    v_options := coalesce(v_item->'options', '[]'::jsonb);
    v_opt_text := array(
      select btrim(e)
        from jsonb_array_elements_text(v_options) e
    );
    v_low := nullif(btrim(coalesce(v_item->>'scaleLabelLow', '')), '');
    v_high := nullif(btrim(coalesce(v_item->>'scaleLabelHigh', '')), '');
    v_min := nullif(btrim(coalesce(v_item->>'scaleMin', '')), '')::integer;
    v_max := nullif(btrim(coalesce(v_item->>'scaleMax', '')), '')::integer;

    insert into smartgov.feedback_questions (
      form_id, order_index, qtype, field_key, title, description,
      required, options, scale_min, scale_max, scale_label_low, scale_label_high
    )
    values (
      v_form.id, v_index, v_qtype, v_field, v_title, v_desc,
      v_required, to_jsonb(v_opt_text), v_min, v_max, v_low, v_high
    );

    v_index := v_index + 1;
  end loop;

  perform smartgov.log_audit(
    p_session_token, 'feedback_questions_save', 'feedback_form', v_form.id,
    jsonb_build_object('count', v_count)
  );

  return jsonb_build_object('ok', true, 'count', v_count);
end;
$$;

revoke all on function smartgov.save_feedback_questions(text, uuid, jsonb) from public;

create or replace function smartgov.set_feedback_form_status(
  p_session_token text,
  p_form_id       uuid,
  p_status        text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_form    smartgov.feedback_forms%rowtype;
  v_status  text := lower(btrim(coalesce(p_status, '')));
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  select f.* into v_form
    from smartgov.feedback_forms f
   where f.id = p_form_id;

  if v_form.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_form.organization_id <> v_account.organization_id then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not smartgov.feedback_form_can_manage(v_account, v_form) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_status not in ('open', 'closed') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if not (
    (v_form.status = 'draft' and v_status = 'open')
    or (v_form.status = 'open' and v_status = 'closed')
    or (v_form.status = 'closed' and v_status = 'open')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'form_not_open');
  end if;

  if v_status = 'open' then
    if not exists (
      select 1
        from smartgov.feedback_questions q
       where q.form_id = v_form.id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'no_questions');
    end if;
    if v_form.access_mode = 'public_link' and v_form.public_slug is null then
      update smartgov.feedback_forms
         set public_slug = replace(replace(replace(
               encode(gen_random_bytes(24), 'base64'), '+', '-'), '/', '_'), '=', ''),
             opened_at = now(),
             closed_at = null,
             updated_at = now()
       where id = v_form.id
       returning * into v_form;
    else
      update smartgov.feedback_forms
         set opened_at = now(),
             closed_at = null,
             updated_at = now()
       where id = v_form.id
       returning * into v_form;
    end if;
  else
    update smartgov.feedback_forms
       set closed_at = now(),
           updated_at = now()
     where id = v_form.id
     returning * into v_form;
  end if;

  perform smartgov.log_audit(
    p_session_token,
    case when v_status = 'open' then 'feedback_form_open' else 'feedback_form_close' end,
    'feedback_form',
    v_form.id,
    '{}'::jsonb
  );

  return jsonb_build_object(
    'ok', true,
    'status', v_status,
    'publicPath', case
      when v_form.public_slug is not null
      then '/feedback/f/' || v_form.public_slug
      else null
    end
  );
end;
$$;

revoke all on function smartgov.set_feedback_form_status(text, uuid, text) from public;

create or replace function smartgov.regenerate_feedback_link(
  p_session_token text,
  p_form_id       uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_form    smartgov.feedback_forms%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  select f.* into v_form
    from smartgov.feedback_forms f
   where f.id = p_form_id;

  if v_form.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_form.organization_id <> v_account.organization_id then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not smartgov.feedback_form_can_manage(v_account, v_form) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_form.status <> 'open' or v_form.access_mode <> 'public_link' then
    return jsonb_build_object('ok', false, 'reason', 'form_not_open');
  end if;

  update smartgov.feedback_forms
     set public_slug = replace(replace(replace(
           encode(gen_random_bytes(24), 'base64'), '+', '-'), '/', '_'), '=', ''),
         updated_at = now()
   where id = v_form.id
   returning * into v_form;

  perform smartgov.log_audit(
    p_session_token, 'feedback_form_link_regenerate', 'feedback_form', v_form.id, '{}'::jsonb
  );

  return jsonb_build_object(
    'ok', true,
    'publicPath', '/feedback/f/' || v_form.public_slug
  );
end;
$$;

revoke all on function smartgov.regenerate_feedback_link(text, uuid) from public;

create or replace function smartgov.delete_feedback_form(
  p_session_token text,
  p_form_id       uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_form    smartgov.feedback_forms%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  select f.* into v_form
    from smartgov.feedback_forms f
   where f.id = p_form_id;

  if v_form.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_form.organization_id <> v_account.organization_id then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not smartgov.feedback_form_can_manage(v_account, v_form) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if smartgov.feedback_form_is_locked(v_form.id) then
    return jsonb_build_object('ok', false, 'reason', 'responses_exist');
  end if;

  delete from smartgov.feedback_forms f
   where f.id = v_form.id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.delete_feedback_form(text, uuid) from public;

create or replace function public.save_feedback_questions(
  p_session_token text,
  p_form_id       uuid,
  p_questions     jsonb
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.save_feedback_questions(p_session_token, p_form_id, p_questions); $$;
revoke all on function public.save_feedback_questions(text, uuid, jsonb) from public;
grant execute on function public.save_feedback_questions(text, uuid, jsonb) to anon, authenticated;

create or replace function public.set_feedback_form_status(
  p_session_token text,
  p_form_id       uuid,
  p_status        text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.set_feedback_form_status(p_session_token, p_form_id, p_status); $$;
revoke all on function public.set_feedback_form_status(text, uuid, text) from public;
grant execute on function public.set_feedback_form_status(text, uuid, text) to anon, authenticated;

create or replace function public.regenerate_feedback_link(
  p_session_token text,
  p_form_id       uuid
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.regenerate_feedback_link(p_session_token, p_form_id); $$;
revoke all on function public.regenerate_feedback_link(text, uuid) from public;
grant execute on function public.regenerate_feedback_link(text, uuid) to anon, authenticated;

create or replace function public.delete_feedback_form(
  p_session_token text,
  p_form_id       uuid
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.delete_feedback_form(p_session_token, p_form_id); $$;
revoke all on function public.delete_feedback_form(text, uuid) from public;
grant execute on function public.delete_feedback_form(text, uuid) to anon, authenticated;

create or replace function smartgov.feedback_questions_json(p_form_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id,
    'orderIndex', q.order_index,
    'qtype', q.qtype,
    'fieldKey', q.field_key,
    'title', q.title,
    'description', q.description,
    'required', q.required,
    'options', q.options,
    'scaleMin', q.scale_min,
    'scaleMax', q.scale_max,
    'scaleLabelLow', q.scale_label_low,
    'scaleLabelHigh', q.scale_label_high
  ) order by q.order_index, q.id), '[]'::jsonb)
    from smartgov.feedback_questions q
   where q.form_id = p_form_id;
$$;

revoke all on function smartgov.feedback_questions_json(uuid) from public;

create or replace function smartgov.list_available_feedback_forms(p_session_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_forms   jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', f.id,
           'title', f.title,
           'description', f.description,
           'scope', f.access_mode,
           'questionCount', (
             select count(*)
               from smartgov.feedback_questions q
              where q.form_id = f.id
           ),
           'createdAt', f.created_at
         ) order by f.created_at desc, f.id), '[]'::jsonb)
    into v_forms
    from smartgov.feedback_forms f
   where f.organization_id = v_account.organization_id
     and f.status = 'open'
     and f.access_mode = 'signed_in'
     and smartgov.feedback_form_matches_account(v_account, f);

  return jsonb_build_object('ok', true, 'forms', v_forms);
end;
$$;

revoke all on function smartgov.list_available_feedback_forms(text) from public;

create or replace function smartgov.get_feedback_form_for_response(
  p_session_token text,
  p_form_id       uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_form    smartgov.feedback_forms%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  select f.* into v_form
    from smartgov.feedback_forms f
   where f.id = p_form_id;

  if v_form.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_form.organization_id <> v_account.organization_id then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_form.status <> 'open' then
    return jsonb_build_object('ok', false, 'reason', 'form_not_open');
  end if;
  if v_form.access_mode <> 'signed_in'
     or not smartgov.feedback_form_matches_account(v_account, v_form) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'form', jsonb_build_object(
      'id', v_form.id,
      'title', v_form.title,
      'description', v_form.description,
      'scope', v_form.access_mode,
      'identityMode', v_form.identity_mode,
      'questionCount', (
        select count(*)
          from smartgov.feedback_questions q
         where q.form_id = v_form.id
      ),
      'createdAt', v_form.created_at,
      'questions', smartgov.feedback_questions_json(v_form.id)
    )
  );
end;
$$;

revoke all on function smartgov.get_feedback_form_for_response(text, uuid) from public;

create or replace function smartgov.validate_feedback_answers(
  p_form_id uuid,
  p_answers jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_q          record;
  v_value      jsonb;
  v_text       text;
  v_checked    text[];
  v_num        numeric;
  v_present    boolean;
  v_normalized jsonb := '{}'::jsonb;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
  end if;
  if length(p_answers::text) > 100000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
  end if;

  if exists (
    select 1
      from jsonb_object_keys(p_answers) k
     where not exists (
       select 1
         from smartgov.feedback_questions q
        where q.form_id = p_form_id
          and q.id::text = k
     )
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
  end if;

  for v_q in
    select *
      from smartgov.feedback_questions q
     where q.form_id = p_form_id
     order by q.order_index, q.id
  loop
    v_present := p_answers ? v_q.id::text;
    v_value := p_answers -> (v_q.id::text);

    if not v_present or v_value is null or jsonb_typeof(v_value) = 'null' then
      if v_q.required then
        return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
      end if;
      continue;
    end if;

    if v_q.qtype in ('short_text', 'long_text') then
      if jsonb_typeof(v_value) <> 'string' then
        return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
      end if;
      v_text := btrim(v_value #>> '{}');
      if length(v_text) < 1 then
        if v_q.required then
          return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
        end if;
        continue;
      end if;
      if (v_q.qtype = 'short_text' and length(v_text) > 500)
         or (v_q.qtype = 'long_text' and length(v_text) > 5000) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
      end if;
      v_normalized := v_normalized || jsonb_build_object(v_q.id::text, v_text);

    elsif v_q.qtype in ('multiple_choice', 'dropdown') then
      if jsonb_typeof(v_value) <> 'string' then
        return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
      end if;
      v_text := btrim(v_value #>> '{}');
      if length(v_text) < 1 then
        if v_q.required then
          return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
        end if;
        continue;
      end if;
      if not exists (
        select 1
          from jsonb_array_elements_text(v_q.options) o
         where o = v_text
      ) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
      end if;
      v_normalized := v_normalized || jsonb_build_object(v_q.id::text, v_text);

    elsif v_q.qtype = 'checkbox' then
      if jsonb_typeof(v_value) <> 'array' then
        return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
      end if;
      if jsonb_array_length(v_value) > 50 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
      end if;
      if exists (
        select 1
          from jsonb_array_elements(v_value) e
         where jsonb_typeof(e) <> 'string'
      ) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
      end if;
      v_checked := array(
        select btrim(e)
          from jsonb_array_elements_text(v_value) e
      );
      if coalesce(array_length(v_checked, 1), 0) = 0 then
        if v_q.required then
          return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
        end if;
        continue;
      end if;
      if exists (
        select 1
          from unnest(v_checked) c
         where length(c) < 1
      ) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
      end if;
      if (select count(*) from unnest(v_checked) c)
         <> (select count(distinct c) from unnest(v_checked) c) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
      end if;
      if exists (
        select 1
          from unnest(v_checked) c
         where not exists (
           select 1
             from jsonb_array_elements_text(v_q.options) o
            where o = c
         )
      ) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
      end if;
      v_normalized := v_normalized || jsonb_build_object(v_q.id::text, to_jsonb(v_checked));

    elsif v_q.qtype = 'rating' then
      if jsonb_typeof(v_value) <> 'number' then
        return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
      end if;
      v_text := v_value #>> '{}';
      if v_text !~ '^[1-5]$' then
        return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
      end if;
      v_normalized := v_normalized || jsonb_build_object(v_q.id::text, v_text::integer);

    elsif v_q.qtype = 'linear_scale' then
      if jsonb_typeof(v_value) <> 'number' then
        return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
      end if;
      v_text := v_value #>> '{}';
      if v_text !~ '^[0-9]+$' then
        return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
      end if;
      v_num := v_text::numeric;
      if v_q.scale_min is null or v_q.scale_max is null
         or v_num < v_q.scale_min or v_num > v_q.scale_max then
        return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
      end if;
      v_normalized := v_normalized || jsonb_build_object(v_q.id::text, v_num::integer);

    elsif v_q.qtype = 'date' then
      if jsonb_typeof(v_value) <> 'string' then
        return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
      end if;
      v_text := btrim(v_value #>> '{}');
      if length(v_text) < 1 then
        if v_q.required then
          return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
        end if;
        continue;
      end if;
      if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
      end if;
      begin
        perform v_text::date;
      exception when others then
        return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
      end;
      v_normalized := v_normalized || jsonb_build_object(v_q.id::text, v_text);

    elsif v_q.qtype = 'time' then
      if jsonb_typeof(v_value) <> 'string' then
        return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
      end if;
      v_text := btrim(v_value #>> '{}');
      if length(v_text) < 1 then
        if v_q.required then
          return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
        end if;
        continue;
      end if;
      if v_text !~ '^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$' then
        return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
      end if;
      begin
        perform v_text::time;
      exception when others then
        return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
      end;
      v_normalized := v_normalized || jsonb_build_object(v_q.id::text, v_text);

    else
      return jsonb_build_object('ok', false, 'reason', 'invalid_answers');
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'answers', v_normalized);
end;
$$;

revoke all on function smartgov.validate_feedback_answers(uuid, jsonb) from public;

create or replace function smartgov.submit_feedback_response(
  p_session_token   text,
  p_form_id         uuid,
  p_answers         jsonb,
  p_respondent_name text,
  p_respondent_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account         smartgov.accounts%rowtype;
  v_form            smartgov.feedback_forms%rowtype;
  v_valid           jsonb;
  v_answers         jsonb;
  v_response_id     uuid;
  v_submitted_by    uuid;
  v_respondent_name text;
  v_respondent_email text;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  select f.* into v_form
    from smartgov.feedback_forms f
   where f.id = p_form_id;

  if v_form.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_form.organization_id <> v_account.organization_id then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_form.status <> 'open' then
    return jsonb_build_object('ok', false, 'reason', 'form_not_open');
  end if;
  if v_form.access_mode <> 'signed_in'
     or not smartgov.feedback_form_matches_account(v_account, v_form) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if not smartgov.consume_rate_limit(
       'feedback:submit:' || v_account.id::text || ':' || v_form.id::text,
       10, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  v_valid := smartgov.validate_feedback_answers(v_form.id, p_answers);
  if not (v_valid->>'ok')::boolean then
    return v_valid;
  end if;
  v_answers := v_valid->'answers';

  if v_form.identity_mode = 'anonymous' then
    v_submitted_by := null;
    v_respondent_name := null;
    v_respondent_email := null;
  else
    v_submitted_by := v_account.id;
    v_respondent_name := v_account.display_name;
    v_respondent_email := v_account.email;
  end if;

  insert into smartgov.feedback_responses (
    form_id, submitted_by, respondent_name, respondent_email, answers
  )
  values (
    v_form.id, v_submitted_by, v_respondent_name, v_respondent_email, v_answers
  )
  returning id into v_response_id;

  if v_form.identity_mode = 'anonymous' then
    insert into smartgov.audit_log (
      organization_id, actor_id, action, target_type, target_id, detail
    )
    values (
      v_form.organization_id, null, 'feedback_response_submit',
      'feedback_form', v_form.id, jsonb_build_object('formId', v_form.id)
    );
  else
    perform smartgov.log_audit(
      p_session_token, 'feedback_response_submit', 'feedback_form', v_form.id,
      jsonb_build_object('formId', v_form.id)
    );
  end if;

  return jsonb_build_object('ok', true, 'responseId', v_response_id);
end;
$$;

revoke all on function smartgov.submit_feedback_response(text, uuid, jsonb, text, text) from public;

create or replace function smartgov.get_public_feedback_form(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_slug text := btrim(coalesce(p_slug, ''));
  v_form smartgov.feedback_forms%rowtype;
begin
  if v_slug !~ '^[A-Za-z0-9_-]{32}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_slug');
  end if;

  select f.* into v_form
    from smartgov.feedback_forms f
   where f.public_slug = v_slug
     and f.status = 'open'
     and f.access_mode = 'public_link';

  if v_form.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'form', jsonb_build_object(
      'title', v_form.title,
      'description', v_form.description,
      'identityMode', v_form.identity_mode,
      'questions', smartgov.feedback_questions_json(v_form.id)
    )
  );
end;
$$;

revoke all on function smartgov.get_public_feedback_form(text) from public;

create or replace function smartgov.submit_public_feedback_response(
  p_slug             text,
  p_answers          jsonb,
  p_respondent_name  text,
  p_respondent_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_slug             text := btrim(coalesce(p_slug, ''));
  v_form             smartgov.feedback_forms%rowtype;
  v_valid            jsonb;
  v_answers          jsonb;
  v_response_id      uuid;
  v_submitted_by     uuid;
  v_respondent_name  text;
  v_respondent_email text;
begin
  if v_slug !~ '^[A-Za-z0-9_-]{32}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_slug');
  end if;

  select f.* into v_form
    from smartgov.feedback_forms f
   where f.public_slug = v_slug
     and f.status = 'open'
     and f.access_mode = 'public_link';

  if v_form.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if not smartgov.consume_rate_limit(
       'feedback:public:' || v_slug, 120, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  v_valid := smartgov.validate_feedback_answers(v_form.id, p_answers);
  if not (v_valid->>'ok')::boolean then
    return v_valid;
  end if;
  v_answers := v_valid->'answers';

  v_submitted_by := null;

  if v_form.identity_mode = 'identified' then
    v_respondent_name := nullif(btrim(coalesce(p_respondent_name, '')), '');
    v_respondent_email := nullif(lower(btrim(coalesce(p_respondent_email, ''))), '');
    if v_respondent_name is null
       or length(v_respondent_name) not between 2 and 120
       or v_respondent_email is null
       or length(v_respondent_email) > 200
       or v_respondent_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_respondent');
    end if;
  else
    v_respondent_name := null;
    v_respondent_email := null;
  end if;

  insert into smartgov.feedback_responses (
    form_id, submitted_by, respondent_name, respondent_email, answers
  )
  values (
    v_form.id, v_submitted_by, v_respondent_name, v_respondent_email, v_answers
  )
  returning id into v_response_id;

  insert into smartgov.audit_log (
    organization_id, actor_id, action, target_type, target_id, detail
  )
  values (
    v_form.organization_id, null, 'feedback_response_submit',
    'feedback_form', v_form.id, jsonb_build_object('formId', v_form.id)
  );

  return jsonb_build_object('ok', true, 'responseId', v_response_id);
end;
$$;

revoke all on function smartgov.submit_public_feedback_response(text, jsonb, text, text) from public;

create or replace function public.list_available_feedback_forms(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_available_feedback_forms(p_session_token); $$;
revoke all on function public.list_available_feedback_forms(text) from public;
grant execute on function public.list_available_feedback_forms(text) to anon, authenticated;

create or replace function public.get_feedback_form_for_response(
  p_session_token text,
  p_form_id       uuid
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.get_feedback_form_for_response(p_session_token, p_form_id); $$;
revoke all on function public.get_feedback_form_for_response(text, uuid) from public;
grant execute on function public.get_feedback_form_for_response(text, uuid) to anon, authenticated;

create or replace function public.submit_feedback_response(
  p_session_token    text,
  p_form_id          uuid,
  p_answers          jsonb,
  p_respondent_name  text,
  p_respondent_email text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.submit_feedback_response(p_session_token, p_form_id, p_answers, p_respondent_name, p_respondent_email); $$;
revoke all on function public.submit_feedback_response(text, uuid, jsonb, text, text) from public;
grant execute on function public.submit_feedback_response(text, uuid, jsonb, text, text) to anon, authenticated;

create or replace function public.get_public_feedback_form(p_slug text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.get_public_feedback_form(p_slug); $$;
revoke all on function public.get_public_feedback_form(text) from public;
grant execute on function public.get_public_feedback_form(text) to anon, authenticated;

create or replace function public.submit_public_feedback_response(
  p_slug             text,
  p_answers          jsonb,
  p_respondent_name  text,
  p_respondent_email text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.submit_public_feedback_response(p_slug, p_answers, p_respondent_name, p_respondent_email); $$;
revoke all on function public.submit_public_feedback_response(text, jsonb, text, text) from public;
grant execute on function public.submit_public_feedback_response(text, jsonb, text, text) to anon, authenticated;

create or replace function smartgov.list_feedback_responses(
  p_session_token text,
  p_form_id       uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account   smartgov.accounts%rowtype;
  v_form      smartgov.feedback_forms%rowtype;
  v_responses jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  select f.* into v_form
    from smartgov.feedback_forms f
   where f.id = p_form_id;

  if v_form.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_form.organization_id <> v_account.organization_id then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not smartgov.feedback_form_can_review(v_account, v_form) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'status', r.status,
           'submittedAt', r.submitted_at,
           'acknowledgedAt', r.acknowledged_at,
           'answers', r.answers,
           'submittedBy', case when v_form.identity_mode = 'anonymous' then null else r.submitted_by end,
           'respondentName', case when v_form.identity_mode = 'anonymous' then null else r.respondent_name end,
           'respondentEmail', case when v_form.identity_mode = 'anonymous' then null else r.respondent_email end
         ) order by r.submitted_at desc, r.id), '[]'::jsonb)
    into v_responses
    from smartgov.feedback_responses r
   where r.form_id = v_form.id;

  return jsonb_build_object(
    'ok', true,
    'form', jsonb_build_object(
      'id', v_form.id,
      'title', v_form.title,
      'status', v_form.status,
      'identityMode', v_form.identity_mode,
      'responseCount', (
        select count(*)
          from smartgov.feedback_responses r
         where r.form_id = v_form.id
      )
    ),
    'questions', smartgov.feedback_questions_json(v_form.id),
    'responses', v_responses
  );
end;
$$;

revoke all on function smartgov.list_feedback_responses(text, uuid) from public;

create or replace function smartgov.acknowledge_feedback_response(
  p_session_token text,
  p_response_id   uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account  smartgov.accounts%rowtype;
  v_form     smartgov.feedback_forms%rowtype;
  v_response smartgov.feedback_responses%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  select r.* into v_response
    from smartgov.feedback_responses r
   where r.id = p_response_id;

  if v_response.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select f.* into v_form
    from smartgov.feedback_forms f
   where f.id = v_response.form_id;

  if v_form.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_form.organization_id <> v_account.organization_id then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not smartgov.feedback_form_can_review(v_account, v_form) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_response.status <> 'acknowledged' then
    update smartgov.feedback_responses
       set status = 'acknowledged',
           acknowledged_by = v_account.id,
           acknowledged_at = now()
     where id = v_response.id
     returning * into v_response;

    perform smartgov.log_audit(
      p_session_token, 'feedback_response_acknowledge', 'feedback_form', v_form.id,
      jsonb_build_object('formId', v_form.id)
    );
  end if;

  return jsonb_build_object('ok', true, 'status', 'acknowledged');
end;
$$;

revoke all on function smartgov.acknowledge_feedback_response(text, uuid) from public;

create or replace function public.list_feedback_responses(
  p_session_token text,
  p_form_id       uuid
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_feedback_responses(p_session_token, p_form_id); $$;
revoke all on function public.list_feedback_responses(text, uuid) from public;
grant execute on function public.list_feedback_responses(text, uuid) to anon, authenticated;

create or replace function public.acknowledge_feedback_response(
  p_session_token text,
  p_response_id   uuid
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.acknowledge_feedback_response(p_session_token, p_response_id); $$;
revoke all on function public.acknowledge_feedback_response(text, uuid) from public;
grant execute on function public.acknowledge_feedback_response(text, uuid) to anon, authenticated;
