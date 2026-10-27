-- 03130 -- Notifications, audit log, and dev outbox.

-- Notifications: per-account inbox items.
create table if not exists smartgov.notifications (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references smartgov.accounts (id) on delete cascade,
  organization_id uuid,
  kind text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_account_idx on smartgov.notifications (account_id, created_at desc);

-- Audit log: per-organization activity trail.
create table if not exists smartgov.audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  actor_id uuid references smartgov.accounts (id) on delete set null,
  action text not null,
  target_type text,
  target_id uuid,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_org_idx on smartgov.audit_log (organization_id, created_at desc);

-- Dev outbox: stores emails when SMTP is not configured (dev only).
create table if not exists smartgov.outbox (
  id uuid primary key default gen_random_uuid(),
  to_address text not null,
  subject text not null,
  html text,
  text_body text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists outbox_created_idx on smartgov.outbox (created_at desc);


-- ---------------------------------------------------------------------------
-- 1. create_notification
-- ---------------------------------------------------------------------------
create or replace function smartgov.create_notification(
  p_session_token text,
  p_account_id uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_link text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_actor smartgov.accounts%rowtype;
  v_target smartgov.accounts%rowtype;
  v_id uuid;
begin
  v_actor := smartgov.authenticate(p_session_token);
  if v_actor.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select * into v_target from smartgov.accounts where id = p_account_id;
  if v_target.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  -- same org only
  if v_target.organization_id is distinct from v_actor.organization_id then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  insert into smartgov.notifications (account_id, organization_id, kind, title, body, link)
  values (v_target.id, v_actor.organization_id, coalesce(nullif(trim(p_kind), ''), 'info'),
          trim(p_title), nullif(trim(coalesce(p_body, '')), ''), nullif(trim(coalesce(p_link, '')), ''))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'notificationId', v_id);
end;
$$;

revoke all on function smartgov.create_notification(text, uuid, text, text, text, text) from public;


-- ---------------------------------------------------------------------------
-- 2. list_notifications
-- ---------------------------------------------------------------------------
create or replace function smartgov.list_notifications(p_session_token text, p_limit integer)
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

  return jsonb_build_object(
    'ok', true,
    'notifications', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', n.id,
          'kind', n.kind,
          'title', n.title,
          'body', n.body,
          'link', n.link,
          'readAt', n.read_at,
          'createdAt', n.created_at
        ) order by n.created_at desc
      )
      from smartgov.notifications n
      where n.account_id = v_account.id
      limit greatest(1, least(coalesce(p_limit, 50), 200))
    ), '[]'::jsonb),
    'unreadCount', (select count(*) from smartgov.notifications where account_id = v_account.id and read_at is null)
  );
end;
$$;

revoke all on function smartgov.list_notifications(text, integer) from public;


-- ---------------------------------------------------------------------------
-- 3. mark_notification_read
-- ---------------------------------------------------------------------------
create or replace function smartgov.mark_notification_read(p_session_token text, p_notification_id uuid)
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

  update smartgov.notifications
     set read_at = now()
   where id = p_notification_id and account_id = v_account.id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.mark_notification_read(text, uuid) from public;


-- ---------------------------------------------------------------------------
-- 4. mark_all_notifications_read
-- ---------------------------------------------------------------------------
create or replace function smartgov.mark_all_notifications_read(p_session_token text)
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

  update smartgov.notifications set read_at = now()
   where account_id = v_account.id and read_at is null;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.mark_all_notifications_read(text) from public;


-- ---------------------------------------------------------------------------
-- 5. unread_notification_count
-- ---------------------------------------------------------------------------
create or replace function smartgov.unread_notification_count(p_session_token text)
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

  return jsonb_build_object(
    'ok', true,
    'count', (select count(*) from smartgov.notifications where account_id = v_account.id and read_at is null)
  );
end;
$$;

revoke all on function smartgov.unread_notification_count(text) from public;


-- ---------------------------------------------------------------------------
-- 6. log_audit
-- ---------------------------------------------------------------------------
create or replace function smartgov.log_audit(
  p_session_token text,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_detail jsonb
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

  insert into smartgov.audit_log (organization_id, actor_id, action, target_type, target_id, detail)
  values (v_account.organization_id, v_account.id, trim(p_action),
          nullif(trim(coalesce(p_target_type, '')), ''), p_target_id, p_detail);

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.log_audit(text, text, text, uuid, jsonb) from public;


-- ---------------------------------------------------------------------------
-- 7. list_audit_log
-- ---------------------------------------------------------------------------
create or replace function smartgov.list_audit_log(p_session_token text, p_limit integer)
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
  if v_account.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'entries', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'action', a.action,
          'targetType', a.target_type,
          'targetId', a.target_id,
          'detail', a.detail,
          'createdAt', a.created_at,
          'actorId', a.actor_id
        ) order by a.created_at desc
      )
      from smartgov.audit_log a
      where a.organization_id = v_account.organization_id
      limit greatest(1, least(coalesce(p_limit, 100), 500))
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_audit_log(text, integer) from public;


-- ---------------------------------------------------------------------------
-- 8. PostgREST forwarders.
-- ---------------------------------------------------------------------------
create or replace function public.create_notification(p_session_token text, p_account_id uuid, p_kind text, p_title text, p_body text, p_link text)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.create_notification(p_session_token, p_account_id, p_kind, p_title, p_body, p_link); $$;
revoke all on function public.create_notification(text, uuid, text, text, text, text) from public;
grant execute on function public.create_notification(text, uuid, text, text, text, text) to anon, authenticated;

create or replace function public.list_notifications(p_session_token text, p_limit integer)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_notifications(p_session_token, p_limit); $$;
revoke all on function public.list_notifications(text, integer) from public;
grant execute on function public.list_notifications(text, integer) to anon, authenticated;

create or replace function public.mark_notification_read(p_session_token text, p_notification_id uuid)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.mark_notification_read(p_session_token, p_notification_id); $$;
revoke all on function public.mark_notification_read(text, uuid) from public;
grant execute on function public.mark_notification_read(text, uuid) to anon, authenticated;

create or replace function public.mark_all_notifications_read(p_session_token text)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.mark_all_notifications_read(p_session_token); $$;
revoke all on function public.mark_all_notifications_read(text) from public;
grant execute on function public.mark_all_notifications_read(text) to anon, authenticated;

create or replace function public.unread_notification_count(p_session_token text)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.unread_notification_count(p_session_token); $$;
revoke all on function public.unread_notification_count(text) from public;
grant execute on function public.unread_notification_count(text) to anon, authenticated;

create or replace function public.log_audit(p_session_token text, p_action text, p_target_type text, p_target_id uuid, p_detail jsonb)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.log_audit(p_session_token, p_action, p_target_type, p_target_id, p_detail); $$;
revoke all on function public.log_audit(text, text, text, uuid, jsonb) from public;
grant execute on function public.log_audit(text, text, text, uuid, jsonb) to anon, authenticated;

create or replace function public.list_audit_log(p_session_token text, p_limit integer)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_audit_log(p_session_token, p_limit); $$;
revoke all on function public.list_audit_log(text, integer) from public;
grant execute on function public.list_audit_log(text, integer) to anon, authenticated;