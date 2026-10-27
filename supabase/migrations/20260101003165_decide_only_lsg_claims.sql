-- 03165 -- a decision applies only to an LSG claim, never a USG event.

create or replace function smartgov.decide_event(
  p_session_token text,
  p_event_id uuid,
  p_decision text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account  smartgov.accounts%rowtype;
  v_event    smartgov.events%rowtype;
  v_decision text := lower(trim(coalesce(p_decision, '')));
  v_note     text := btrim(coalesce(p_note, ''));
  v_target   uuid;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if not smartgov.is_usg_side(v_account) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_decision = 'rejected' then v_decision := 'not_honored'; end if;
  if v_decision not in ('honored', 'not_honored') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if v_decision = 'not_honored' and length(v_note) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;

  select * into v_event from smartgov.events
   where id = p_event_id and organization_id = v_account.organization_id;
  if v_event.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  -- Only an LSG claim is a decision. A USG-published event is already
  -- honoured by the office that published it.
  if v_event.source <> 'lsg' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  update smartgov.events
     set status = case when v_decision = 'honored' then 'honored' else 'rejected' end,
         honor_status = v_decision,
         honor_reason = case when v_decision = 'not_honored' then v_note else null end,
         decision_note = nullif(v_note, ''),
         decided_by = v_account.id,
         decided_at = now(),
         updated_at = now()
   where id = v_event.id;

  insert into smartgov.notifications (account_id, organization_id, kind, title, body, link)
  values (
    v_event.created_by, v_account.organization_id,
    case when v_decision = 'honored' then 'event_honored' else 'event_not_honored' end,
    case when v_decision = 'honored' then 'Event honoured' else 'Event not honoured' end,
    v_event.title || case when v_decision = 'not_honored' then ': ' || v_note else ' was honoured.' end,
    '/lsg/events'
  );

  insert into smartgov.audit_log (organization_id, actor_id, action, target_type, target_id, detail)
  values (v_account.organization_id, v_account.id,
          case when v_decision = 'honored' then 'event.honored' else 'event.not_honored' end,
          'event', v_event.id, jsonb_build_object('title', v_event.title, 'reason', v_note));

  return jsonb_build_object('ok', true, 'honorStatus', v_decision);
end;
$$;
