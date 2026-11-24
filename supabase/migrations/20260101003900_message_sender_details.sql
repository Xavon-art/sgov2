-- 03900 -- Surface sender campus/email in messages and notifications.
--
-- The first notification pass only had the sender's display name, which is
-- often just their email, and the LSG workspace did not expose the inbox in the
-- sidebar. This pass:
--   1. adds sender campus/email to conversation lists and message threads;
--   2. puts campus + email in the notification title/body;
--   3. carries the message id in the link so a click opens the exact message;
--   4. backfills notifications for messages sent before the first pass.

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
      join smartgov.conversation_participants cp on cp.conversation_id = c.id and cp.account_id = v_account.id
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
          'body', case when m.unsent_at is not null then null else m.body end,
          'createdAt', m.created_at,
          'unsent', (m.unsent_at is not null)
        ) order by m.created_at asc
      )
      from smartgov.messages m
      join smartgov.accounts sa on sa.id = m.sender_id
      where m.conversation_id = p_conversation_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_messages(text, uuid) from public;


create or replace function smartgov.send_message(p_session_token text, p_conversation_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_recipient smartgov.accounts%rowtype;
  v_ok boolean;
  v_id uuid;
  v_campus text;
  v_email text;
  v_subject text;
  v_excerpt text;
  v_base_link text;
  v_link text;
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

  v_campus := coalesce(nullif(trim(v_account.campus_name), ''), 'Unnamed campus');
  v_email := coalesce(nullif(trim(v_account.email), ''), 'unknown@example.test');

  select nullif(trim(coalesce(c.subject, '')), '') into v_subject
  from smartgov.conversations c
  where c.id = p_conversation_id;
  v_excerpt := left(trim(p_body), 180);

  for v_recipient in
    select a.*
    from smartgov.conversation_participants cp
    join smartgov.accounts a on a.id = cp.account_id
    where cp.conversation_id = p_conversation_id
      and cp.deleted_at is null
      and cp.account_id <> v_account.id
  loop
    -- account_kind is now ('usg', 'lsg', 'central'); scope still separates the
    -- USG owner from invited officers on legacy 'usg' rows.
    v_base_link := case
      when v_recipient.account_kind = 'lsg' then '/lsg/messages'
      when v_recipient.account_kind = 'central' then '/usg/messages'
      when v_recipient.account_scope = 'owner' then '/usg/messages'
      else '/lsg/messages'
    end;
    v_link := v_base_link || '?c=' || p_conversation_id::text || '&m=' || v_id::text;

    insert into smartgov.notifications (account_id, organization_id, kind, title, body, link)
    values (
      v_recipient.id,
      v_recipient.organization_id,
      'message',
      'New message from ' || v_campus,
      v_email || ' — ' || coalesce(left(v_subject, 80) || ': ', '') || v_excerpt,
      v_link
    );
  end loop;

  return jsonb_build_object('ok', true, 'messageId', v_id);
end;
$$;

revoke all on function smartgov.send_message(text, uuid, text) from public;


-- Backfill older messages once. The `not exists` guard uses the new message-id
-- link, so re-running this migration never duplicates a notification.
with candidates as (
  select
    a.id as recipient_id,
    a.organization_id,
    coalesce(nullif(trim(sa.campus_name), ''), 'Unnamed campus') as sender_campus,
    coalesce(nullif(trim(sa.email), ''), 'unknown@example.test') as sender_email,
    nullif(trim(coalesce(c.subject, '')), '') as subject,
    left(trim(m.body), 180) as excerpt,
    case
      when a.account_kind = 'lsg' then '/lsg/messages'
      when a.account_kind = 'central' then '/usg/messages'
      when a.account_scope = 'owner' then '/usg/messages'
      else '/lsg/messages'
    end || '?c=' || m.conversation_id::text || '&m=' || m.id::text as link
  from smartgov.messages m
  join smartgov.accounts sa on sa.id = m.sender_id
  join smartgov.conversations c on c.id = m.conversation_id
  join smartgov.conversation_participants cp
    on cp.conversation_id = m.conversation_id
   and cp.deleted_at is null
   and cp.account_id <> m.sender_id
  join smartgov.accounts a on a.id = cp.account_id
  where m.unsent_at is null
)
insert into smartgov.notifications (account_id, organization_id, kind, title, body, link)
select
  c.recipient_id,
  c.organization_id,
  'message',
  'New message from ' || c.sender_campus,
  c.sender_email || ' — ' || coalesce(left(c.subject, 80) || ': ', '') || c.excerpt,
  c.link
from candidates c
where not exists (
  select 1
  from smartgov.notifications n
  where n.account_id = c.recipient_id
    and n.kind = 'message'
    and n.link = c.link
);

notify pgrst, 'reload schema';
