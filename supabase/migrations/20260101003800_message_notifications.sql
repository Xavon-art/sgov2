-- 03800 -- Notify message recipients and deep-link them to the thread.
--
-- `send_message` used to only persist the row and bump the conversation's
-- `updated_at`, so an LSG officer could message the USG owner and nothing ever
-- appeared in the owner's notification bell. Recreate the function with a
-- per-participant notification insert. The link carries the conversation id so
-- the MessagesPanel can open that exact thread when the notification is clicked.

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
  v_sender text;
  v_subject text;
  v_excerpt text;
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

  -- The public wrapper's signature is unchanged; only this private function
  -- gains the notification side effect.
  v_sender := nullif(trim(coalesce(v_account.display_name, '')), '');
  if v_sender is null then
    v_sender := nullif(trim(coalesce(v_account.email, '')), '');
  end if;
  v_sender := coalesce(v_sender, 'An officer');

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
    -- account_kind is 'usg' for both the owner and invited LSG officers, so
    -- account_scope is what separates the two workspaces.
    v_link := case
      when v_recipient.account_kind = 'central' then '/usg/messages?c=' || p_conversation_id::text
      when v_recipient.account_scope = 'owner' then '/usg/messages?c=' || p_conversation_id::text
      else '/lsg/messages?c=' || p_conversation_id::text
    end;

    insert into smartgov.notifications (account_id, organization_id, kind, title, body, link)
    values (
      v_recipient.id,
      v_recipient.organization_id,
      'message',
      'New message from ' || v_sender,
      case
        when v_subject is null then v_excerpt
        else left(v_subject, 80) || ': ' || v_excerpt
      end,
      v_link
    );
  end loop;

  return jsonb_build_object('ok', true, 'messageId', v_id);
end;
$$;

revoke all on function smartgov.send_message(text, uuid, text) from public;

notify pgrst, 'reload schema';
