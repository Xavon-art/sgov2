-- 03110 -- Messaging (chat) between officers.
--
-- A simple conversation model: a conversation has participants (officers in
-- the same organization). Messages are sent by participants. A sender may
-- "unsend" a message (soft delete, shown as "message removed"). A participant
-- may delete a conversation for themselves only. Read state is tracked per
-- participant.

create table if not exists smartgov.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  subject text,
  created_by uuid not null references smartgov.accounts (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists smartgov.conversation_participants (
  conversation_id uuid not null references smartgov.conversations (id) on delete cascade,
  account_id uuid not null references smartgov.accounts (id) on delete cascade,
  last_read_at timestamptz,
  deleted_at timestamptz,
  primary key (conversation_id, account_id)
);

create table if not exists smartgov.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references smartgov.conversations (id) on delete cascade,
  sender_id uuid not null references smartgov.accounts (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  unsent_at timestamptz
);

create index if not exists conv_participant_account_idx on smartgov.conversation_participants (account_id);
create index if not exists messages_conv_created_idx on smartgov.messages (conversation_id, created_at);


-- ---------------------------------------------------------------------------
-- 1. create_conversation
-- ---------------------------------------------------------------------------
create or replace function smartgov.create_conversation(
  p_session_token text,
  p_participant_ids uuid[],
  p_subject text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_id uuid;
  v_pid uuid;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  insert into smartgov.conversations (organization_id, created_by, subject)
  values (v_account.organization_id, v_account.id, nullif(trim(coalesce(p_subject, '')), ''))
  returning id into v_id;

  -- creator is a participant
  insert into smartgov.conversation_participants (conversation_id, account_id)
  values (v_id, v_account.id)
  on conflict do nothing;

  if p_participant_ids is not null then
    foreach v_pid in array p_participant_ids loop
      if v_pid is null or v_pid = v_account.id then
        continue;
      end if;
      -- only accounts in the same org
      if exists (select 1 from smartgov.accounts a where a.id = v_pid and a.organization_id = v_account.organization_id) then
        insert into smartgov.conversation_participants (conversation_id, account_id)
        values (v_id, v_pid)
        on conflict do nothing;
      end if;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'conversationId', v_id);
end;
$$;

revoke all on function smartgov.create_conversation(text, uuid[], text) from public;


-- ---------------------------------------------------------------------------
-- 2. list_conversations
-- ---------------------------------------------------------------------------
create or replace function smartgov.list_conversations(p_session_token text)
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
    'conversations', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'subject', c.subject,
          'createdAt', c.created_at,
          'updatedAt', c.updated_at,
          'lastMessage', (
            select jsonb_build_object('body', m.body, 'createdAt', m.created_at, 'senderId', m.sender_id, 'unsent', (m.unsent_at is not null))
            from smartgov.messages m
            where m.conversation_id = c.id
            order by m.created_at desc
            limit 1
          ),
          'unreadCount', (
            select count(*) from smartgov.messages m
            where m.conversation_id = c.id
              and (cp.last_read_at is null or m.created_at > cp.last_read_at)
              and m.sender_id <> v_account.id
          )
        ) order by c.updated_at desc
      )
      from smartgov.conversations c
      join smartgov.conversation_participants cp on cp.conversation_id = c.id and cp.account_id = v_account.id
      where cp.deleted_at is null
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_conversations(text) from public;


-- ---------------------------------------------------------------------------
-- 3. list_messages
-- ---------------------------------------------------------------------------
create or replace function smartgov.list_messages(p_session_token text, p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_ok boolean;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select exists (
    select 1 from smartgov.conversation_participants cp
    where cp.conversation_id = p_conversation_id and cp.account_id = v_account.id and cp.deleted_at is null
  ) into v_ok;
  if not v_ok then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'messages', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'senderId', m.sender_id,
          'body', case when m.unsent_at is not null then null else m.body end,
          'createdAt', m.created_at,
          'unsent', (m.unsent_at is not null)
        ) order by m.created_at asc
      )
      from smartgov.messages m
      where m.conversation_id = p_conversation_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_messages(text, uuid) from public;


-- ---------------------------------------------------------------------------
-- 4. send_message
-- ---------------------------------------------------------------------------
create or replace function smartgov.send_message(p_session_token text, p_conversation_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_ok boolean;
  v_id uuid;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if p_body is null or length(trim(p_body)) < 1 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select exists (
    select 1 from smartgov.conversation_participants cp
    where cp.conversation_id = p_conversation_id and cp.account_id = v_account.id and cp.deleted_at is null
  ) into v_ok;
  if not v_ok then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  insert into smartgov.messages (conversation_id, sender_id, body)
  values (p_conversation_id, v_account.id, trim(p_body))
  returning id into v_id;

  update smartgov.conversations set updated_at = now() where id = p_conversation_id;

  return jsonb_build_object('ok', true, 'messageId', v_id);
end;
$$;

revoke all on function smartgov.send_message(text, uuid, text) from public;


-- ---------------------------------------------------------------------------
-- 5. unsend_message (sender only)
-- ---------------------------------------------------------------------------
create or replace function smartgov.unsend_message(p_session_token text, p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_msg smartgov.messages%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select * into v_msg from smartgov.messages where id = p_message_id;
  if v_msg.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_msg.sender_id <> v_account.id then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  update smartgov.messages set unsent_at = now() where id = v_msg.id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.unsend_message(text, uuid) from public;


-- ---------------------------------------------------------------------------
-- 6. delete_conversation_for_self
-- ---------------------------------------------------------------------------
create or replace function smartgov.delete_conversation_for_self(p_session_token text, p_conversation_id uuid)
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

  update smartgov.conversation_participants
     set deleted_at = now()
   where conversation_id = p_conversation_id and account_id = v_account.id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.delete_conversation_for_self(text, uuid) from public;


-- ---------------------------------------------------------------------------
-- 7. mark_read
-- ---------------------------------------------------------------------------
create or replace function smartgov.mark_conversation_read(p_session_token text, p_conversation_id uuid)
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

  update smartgov.conversation_participants
     set last_read_at = now()
   where conversation_id = p_conversation_id and account_id = v_account.id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.mark_conversation_read(text, uuid) from public;


-- ---------------------------------------------------------------------------
-- 8. PostgREST forwarders.
-- ---------------------------------------------------------------------------
create or replace function public.create_conversation(p_session_token text, p_participant_ids uuid[], p_subject text)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.create_conversation(p_session_token, p_participant_ids, p_subject); $$;
revoke all on function public.create_conversation(text, uuid[], text) from public;
grant execute on function public.create_conversation(text, uuid[], text) to anon, authenticated;

create or replace function public.list_conversations(p_session_token text)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_conversations(p_session_token); $$;
revoke all on function public.list_conversations(text) from public;
grant execute on function public.list_conversations(text) to anon, authenticated;

create or replace function public.list_messages(p_session_token text, p_conversation_id uuid)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_messages(p_session_token, p_conversation_id); $$;
revoke all on function public.list_messages(text, uuid) from public;
grant execute on function public.list_messages(text, uuid) to anon, authenticated;

create or replace function public.send_message(p_session_token text, p_conversation_id uuid, p_body text)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.send_message(p_session_token, p_conversation_id, p_body); $$;
revoke all on function public.send_message(text, uuid, text) from public;
grant execute on function public.send_message(text, uuid, text) to anon, authenticated;

create or replace function public.unsend_message(p_session_token text, p_message_id uuid)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.unsend_message(p_session_token, p_message_id); $$;
revoke all on function public.unsend_message(text, uuid) from public;
grant execute on function public.unsend_message(text, uuid) to anon, authenticated;

create or replace function public.delete_conversation_for_self(p_session_token text, p_conversation_id uuid)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.delete_conversation_for_self(p_session_token, p_conversation_id); $$;
revoke all on function public.delete_conversation_for_self(text, uuid) from public;
grant execute on function public.delete_conversation_for_self(text, uuid) to anon, authenticated;

create or replace function public.mark_conversation_read(p_session_token text, p_conversation_id uuid)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.mark_conversation_read(p_session_token, p_conversation_id); $$;
revoke all on function public.mark_conversation_read(text, uuid) from public;
grant execute on function public.mark_conversation_read(text, uuid) to anon, authenticated;