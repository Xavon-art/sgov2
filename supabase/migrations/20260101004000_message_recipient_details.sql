-- 04000 -- Show the other participant's credential and harden message unsend.
--
-- A message row knows its sender, but the inbox is a conversation with the
-- other officer. The earlier pass labelled the bubble with the sender, which
-- is wrong when the user asks "who did I message?" -- the answer is the other
-- participant. This pass:
--   1. adds the other participant's campus/email to conversation lists;
--   2. adds the other participant's campus/email plus `canUnsend` to threads;
--   3. gives the sender check a distinct refusal reason so the UI can say why.

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
          -- "with" is the officer on the other end of this conversation.
          'withName', coalesce(nullif(trim(other.display_name), ''), other.email),
          'withEmail', other.email,
          'withCampus', coalesce(nullif(trim(other.campus_name), ''), 'Unnamed campus'),
          'withKind', other.account_kind::text,
          'lastMessage', (
            select jsonb_build_object(
              'body', m.body,
              'createdAt', m.created_at,
              'senderId', m.sender_id,
              'senderName', coalesce(nullif(trim(sa.display_name), ''), sa.email),
              'senderEmail', sa.email,
              'senderCampus', coalesce(nullif(trim(sa.campus_name), ''), 'Unnamed campus'),
              'unsent', (m.unsent_at is not null)
            )
            from smartgov.messages m
            join smartgov.accounts sa on sa.id = m.sender_id
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
      join smartgov.conversation_participants cp
        on cp.conversation_id = c.id and cp.account_id = v_account.id
      left join lateral (
        select oa.display_name, oa.email, oa.campus_name, oa.account_kind
        from smartgov.conversation_participants op
        join smartgov.accounts oa on oa.id = op.account_id
        where op.conversation_id = c.id
          and op.account_id <> v_account.id
          and op.deleted_at is null
        order by oa.email
        limit 1
      ) other on true
      where cp.deleted_at is null
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_conversations(text) from public;


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
          'senderName', coalesce(nullif(trim(sa.display_name), ''), sa.email),
          'senderEmail', sa.email,
          'senderCampus', coalesce(nullif(trim(sa.campus_name), ''), 'Unnamed campus'),
          'senderKind', sa.account_kind::text,
          -- The credential the reader should recognise is the officer on the
          -- other end of the conversation, i.e. the person this was sent to.
          'recipientName', coalesce(nullif(trim(other.display_name), ''), other.email),
          'recipientEmail', other.email,
          'recipientCampus', coalesce(nullif(trim(other.campus_name), ''), 'Unnamed campus'),
          'recipientKind', other.account_kind::text,
          'body', case when m.unsent_at is not null then null else m.body end,
          'createdAt', m.created_at,
          'unsent', (m.unsent_at is not null),
          'canUnsend', (m.sender_id = v_account.id and m.unsent_at is null)
        ) order by m.created_at asc
      )
      from smartgov.messages m
      join smartgov.accounts sa on sa.id = m.sender_id
      left join lateral (
        select oa.display_name, oa.email, oa.campus_name, oa.account_kind
        from smartgov.conversation_participants op
        join smartgov.accounts oa on oa.id = op.account_id
        where op.conversation_id = p_conversation_id
          and op.account_id <> v_account.id
          and op.deleted_at is null
        order by oa.email
        limit 1
      ) other on true
      where m.conversation_id = p_conversation_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_messages(text, uuid) from public;


-- The original sender check was already correct; keep it correct and make the
-- refusal specific. A non-author clicking Unsend cannot mutate anything.
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
    return jsonb_build_object('ok', false, 'reason', 'not_your_message');
  end if;

  if v_msg.unsent_at is null then
    update smartgov.messages set unsent_at = now() where id = v_msg.id;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.unsend_message(text, uuid) from public;

notify pgrst, 'reload schema';
