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
         set status = v_status,
             public_slug = replace(replace(replace(
               encode(gen_random_bytes(24), 'base64'), '+', '-'), '/', '_'), '=', ''),
             opened_at = now(),
             closed_at = null,
             updated_at = now()
       where id = v_form.id
       returning * into v_form;
    else
      update smartgov.feedback_forms
         set status = v_status,
             opened_at = now(),
             closed_at = null,
             updated_at = now()
       where id = v_form.id
       returning * into v_form;
    end if;
  else
    update smartgov.feedback_forms
       set status = v_status,
           closed_at = now(),
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
