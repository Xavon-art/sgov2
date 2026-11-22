alter table smartgov.personal_requests
  drop constraint if exists personal_requests_status_check;
alter table smartgov.personal_requests
  add constraint personal_requests_status_check
  check (status in ('submitted', 'granted', 'declined', 'needs_revision', 'submission_required', 'withdrawn', 'expired'));

create or replace function smartgov.decide_personal_request(
  p_session_token text,
  p_request_id    uuid,
  p_decision      text,
  p_note          text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_req     smartgov.personal_requests%rowtype;
  v_usg     boolean;
  v_units   uuid[];
  v_note    text;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select r.* into v_req
    from smartgov.personal_requests r
   where r.id = p_request_id and r.organization_id = v_account.organization_id;

  if v_req.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_usg := smartgov.is_usg(v_account.id, v_account.organization_id);

  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  v_note := btrim(coalesce(p_note, ''));
  if length(v_note) > 2000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if p_decision = 'withdrawn' then
    if not (v_req.unit_id = any (v_units)) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    if v_req.status <> 'submitted' then
      return jsonb_build_object('ok', false, 'reason', 'already_decided');
    end if;

    update smartgov.personal_requests
       set status = 'withdrawn', decision_note = v_note,
           decided_by = v_account.id, decided_at = now()
     where id = p_request_id;

    return jsonb_build_object('ok', true, 'status', 'withdrawn');
  end if;

  if p_decision not in ('granted', 'declined', 'needs_revision', 'submission_required') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if not v_usg then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_req.status <> 'submitted' then
    return jsonb_build_object('ok', false, 'reason', 'already_decided');
  end if;

  if p_decision in ('declined', 'needs_revision', 'submission_required') and length(v_note) < 2 then
    return jsonb_build_object('ok', false, 'reason', 'note_required');
  end if;

  update smartgov.personal_requests
     set status = p_decision, decision_note = v_note,
         decided_by = v_account.id, decided_at = now()
   where id = p_request_id;

  return jsonb_build_object('ok', true, 'status', p_decision);
end;
$$;

revoke all on function smartgov.decide_personal_request(text, uuid, text, text) from public;

create or replace function smartgov.resubmit_personal_request(
  p_session_token text,
  p_request_id    uuid,
  p_note          text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account  smartgov.accounts%rowtype;
  v_req      smartgov.personal_requests%rowtype;
  v_units    uuid[];
  v_note     text;
  v_combined text;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select r.* into v_req
    from smartgov.personal_requests r
   where r.id = p_request_id and r.organization_id = v_account.organization_id;

  if v_req.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  if not (v_req.unit_id = any (v_units)) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_req.status not in ('needs_revision', 'submission_required') then
    return jsonb_build_object('ok', false, 'reason', 'already_decided');
  end if;

  v_note := btrim(coalesce(p_note, ''));
  if length(v_note) > 2000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_combined := btrim(coalesce(v_req.decision_note, ''));
  if v_note <> '' then
    if v_combined <> '' then
      v_combined := v_combined || E'\n\nLSG response: ' || v_note;
    else
      v_combined := v_note;
    end if;
  end if;

  update smartgov.personal_requests
     set status = 'submitted', decision_note = nullif(v_combined, ''),
         decided_by = null, decided_at = null
   where id = p_request_id;

  return jsonb_build_object('ok', true, 'status', 'submitted');
end;
$$;

revoke all on function smartgov.resubmit_personal_request(text, uuid, text) from public;

create or replace function public.resubmit_personal_request(p_session_token text, p_request_id uuid, p_note text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.resubmit_personal_request(p_session_token, p_request_id, p_note); $$;

revoke all on function public.resubmit_personal_request(text, uuid, text) from public;
grant execute on function public.resubmit_personal_request(text, uuid, text) to anon, authenticated, service_role;
