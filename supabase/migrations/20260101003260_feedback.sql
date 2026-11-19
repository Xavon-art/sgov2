create table if not exists smartgov.feedback_entries (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  submitted_by    uuid references smartgov.accounts (id) on delete set null,
  subject         text not null check (length(btrim(subject)) between 3 and 160),
  message         text not null check (length(btrim(message)) between 10 and 8000),
  source          text not null default 'in_app' check (source = 'in_app'),
  status          text not null default 'new' check (status in ('new', 'acknowledged')),
  acknowledged_by uuid references smartgov.accounts (id) on delete set null,
  acknowledged_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists feedback_entries_org_status_created_idx
  on smartgov.feedback_entries (organization_id, status, created_at desc);

alter table smartgov.feedback_entries enable row level security;
revoke all on smartgov.feedback_entries from public, anon, authenticated;

create or replace function smartgov.create_feedback(
  p_session_token text,
  p_subject text,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_subject text := btrim(coalesce(p_subject, ''));
  v_message text := btrim(coalesce(p_message, ''));
  v_id uuid;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;
  if length(v_subject) < 3 or length(v_subject) > 160 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_feedback_subject');
  end if;
  if length(v_message) < 10 or length(v_message) > 8000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_message');
  end if;

  insert into smartgov.feedback_entries
    (organization_id, submitted_by, subject, message, source)
  values
    (v_account.organization_id, v_account.id, v_subject, v_message, 'in_app')
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function smartgov.create_feedback(text, text, text) from public;

create or replace function smartgov.list_feedback(
  p_session_token text
)
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
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;
  if not smartgov.is_usg_side(v_account) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'rows', coalesce((
      select jsonb_agg(row order by row ->> 'createdAt' desc, row ->> 'id' desc)
      from (
        select jsonb_build_object(
          'id', f.id,
          'subject', f.subject,
          'message', f.message,
          'status', f.status,
          'createdAt', f.created_at,
          'acknowledgedAt', f.acknowledged_at,
          'acknowledgedBy', f.acknowledged_by
        ) as row
        from smartgov.feedback_entries f
        where f.organization_id = v_account.organization_id
      ) s
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_feedback(text) from public;

create or replace function smartgov.get_feedback(
  p_session_token text,
  p_feedback_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_row smartgov.feedback_entries%rowtype;
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

  select f.* into v_row
  from smartgov.feedback_entries f
  where f.id = p_feedback_id
    and f.organization_id = v_account.organization_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'item', jsonb_build_object(
      'id', v_row.id,
      'subject', v_row.subject,
      'message', v_row.message,
      'status', v_row.status,
      'createdAt', v_row.created_at,
      'acknowledgedAt', v_row.acknowledged_at,
      'acknowledgedBy', v_row.acknowledged_by
    )
  );
end;
$$;

revoke all on function smartgov.get_feedback(text, uuid) from public;

create or replace function smartgov.acknowledge_feedback(
  p_session_token text,
  p_feedback_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_found boolean;
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

  select true into v_found
  from smartgov.feedback_entries f
  where f.id = p_feedback_id
    and f.organization_id = v_account.organization_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  update smartgov.feedback_entries
     set status = 'acknowledged',
         acknowledged_by = v_account.id,
         acknowledged_at = now(),
         updated_at = now()
   where id = p_feedback_id
     and organization_id = v_account.organization_id;

  return jsonb_build_object('ok', true, 'id', p_feedback_id, 'status', 'acknowledged');
end;
$$;

revoke all on function smartgov.acknowledge_feedback(text, uuid) from public;

create or replace function public.create_feedback(
  p_session_token text,
  p_subject text,
  p_message text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.create_feedback(p_session_token, p_subject, p_message); $$;
revoke all on function public.create_feedback(text, text, text) from public;
grant execute on function public.create_feedback(text, text, text) to anon, authenticated;

create or replace function public.list_feedback(
  p_session_token text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_feedback(p_session_token); $$;
revoke all on function public.list_feedback(text) from public;
grant execute on function public.list_feedback(text) to anon, authenticated;

create or replace function public.get_feedback(
  p_session_token text,
  p_feedback_id uuid
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.get_feedback(p_session_token, p_feedback_id); $$;
revoke all on function public.get_feedback(text, uuid) from public;
grant execute on function public.get_feedback(text, uuid) to anon, authenticated;

create or replace function public.acknowledge_feedback(
  p_session_token text,
  p_feedback_id uuid
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.acknowledge_feedback(p_session_token, p_feedback_id); $$;
revoke all on function public.acknowledge_feedback(text, uuid) from public;
grant execute on function public.acknowledge_feedback(text, uuid) to anon, authenticated;
