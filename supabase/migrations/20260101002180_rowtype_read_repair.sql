-- Repair continuation. The shipped 002000 reads a subset of proposal columns
-- with `into v_proposal` where v_proposal is a %rowtype -- and a rowtype target
-- assigns positionally, not by name. review_proposal's 4-column select put
-- pr.status ("submitted") into v_proposal.unit_id (a uuid) and died with
-- 22P02; submit_revision's 6-column select would have done the same at its
-- sixth slot. Both re-declare here with explicit field targets.
create or replace function smartgov.jsonb_text_array(p_value jsonb)
returns text[]
language sql stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select coalesce(
    (select array_agg(elem) from jsonb_array_elements_text(p_value) elem),
    '{}'::text[]
  );
$$;

revoke all on function smartgov.jsonb_text_array(jsonb) from public;

create or replace function smartgov.submit_revision(
  p_session_token text,
  p_proposal_id   uuid,
  p_items         jsonb,
  p_note          text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account   smartgov.accounts%rowtype;
  v_proposal  smartgov.proposals%rowtype;
  v_template  jsonb;
  v_check     jsonb;
  v_next      int;
  v_version_id uuid;
  v_i         int;
  v_e         int;
  v_tid       uuid;
  v_entry     jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if not smartgov.consume_rate_limit(
       'proposal:revise:' || v_account.id::text, 20, interval '5 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  select pr.id, pr.organization_id, pr.program_id, pr.unit_id, pr.created_by,
         pr.status
    into v_proposal.id, v_proposal.organization_id, v_proposal.program_id,
         v_proposal.unit_id, v_proposal.created_by, v_proposal.status
    from smartgov.proposals pr
   where pr.id = p_proposal_id
     and pr.organization_id = v_account.organization_id
   for update;

  if v_proposal.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_proposal');
  end if;

  if v_proposal.created_by <> v_account.id then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_proposal.status <> 'returned' then
    return jsonb_build_object('ok', false, 'reason', 'not_returned');
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if v_proposal.program_id is not null then
    select jsonb_agg(jsonb_build_object(
      'id', ri.id, 'itemKind', ri.item_kind,
      'allowedExtensions', ri.allowed_extensions, 'position', ri.position)
      order by ri.position)
      into v_template
      from smartgov.requirement_items ri
     where ri.program_id = v_proposal.program_id;
  else
    select jsonb_agg(jsonb_build_object(
      'id', ri.id, 'itemKind', ri.item_kind,
      'allowedExtensions', ri.allowed_extensions, 'position', ri.position)
      order by ri.position)
      into v_template
      from smartgov.requirement_items ri
     where ri.program_id is null
       and ri.organization_id = v_account.organization_id;
  end if;

  if v_template is null or jsonb_array_length(v_template) < 1 then
    return jsonb_build_object('ok', false, 'reason', 'incomplete_submission');
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next
    from smartgov.proposal_versions pv
   where pv.proposal_id = v_proposal.id;

  v_check := smartgov.proposal_items_valid(v_account, v_template, p_items, v_next);
  if not (v_check->>'ok')::boolean then
    return v_check;
  end if;

  insert into smartgov.proposal_versions (
    proposal_id, version_number, submitted_by, submission_note
  ) values (
    v_proposal.id, v_next, v_account.id, btrim(coalesce(p_note, ''))
  ) returning id into v_version_id;

  for v_i in 0 .. jsonb_array_length(v_template) - 1 loop
    v_tid := (v_template->v_i->>'id')::uuid;
    for v_e in 0 .. jsonb_array_length(p_items) - 1 loop
      v_entry := p_items->v_e;
      if (v_entry->>'requirement_item_id')::uuid = v_tid then
        if (v_entry->>'kind') = 'file' then
          insert into smartgov.item_submissions (
            version_id, requirement_item_id, submission_kind,
            storage_path, original_name, mime_type, size_bytes
          ) values (
            v_version_id, v_tid, 'file',
            v_entry->>'storagePath', v_entry->>'originalName',
            v_entry->>'mimeType', (v_entry->>'sizeBytes')::bigint
          );
        else
          insert into smartgov.item_submissions (
            version_id, requirement_item_id, submission_kind, link_url
          ) values (
            v_version_id, v_tid, 'link', btrim(v_entry->>'linkUrl')
          );
        end if;
        exit;
      end if;
    end loop;
  end loop;

  update smartgov.proposals
     set status = 'submitted'
   where id = v_proposal.id;

  return jsonb_build_object(
    'ok', true, 'proposalId', v_proposal.id, 'status', 'submitted', 'version', v_next
  );
end;
$$;

revoke all on function smartgov.submit_revision(text, uuid, jsonb, text) from public;

create or replace function smartgov.review_proposal(
  p_session_token text,
  p_proposal_id   uuid,
  p_decision      text,
  p_remark        text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_proposal smartgov.proposals%rowtype;
  v_ver_id  uuid;
  v_ver     int;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.account_scope <> 'owner'
     and not smartgov.is_org_reviewer(v_account.id, v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if p_decision not in ('approved','returned','rejected') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if p_decision in ('returned','rejected')
     and length(btrim(coalesce(p_remark, ''))) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if not smartgov.consume_rate_limit(
       'proposal:review:' || v_account.id::text, 40, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  select pr.id, pr.organization_id, pr.created_by, pr.status
    into v_proposal.id, v_proposal.organization_id,
         v_proposal.created_by, v_proposal.status
    from smartgov.proposals pr
   where pr.id = p_proposal_id
     and pr.organization_id = v_account.organization_id
   for update;

  if v_proposal.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_proposal');
  end if;

  select pv.id, pv.version_number into v_ver_id, v_ver
    from smartgov.proposal_versions pv
   where pv.proposal_id = v_proposal.id
   order by pv.version_number desc
   limit 1;

  if exists (
    select 1 from smartgov.reviews rev
     where rev.proposal_id = v_proposal.id
       and rev.version_id = v_ver_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'already_reviewed');
  end if;

  insert into smartgov.reviews (
    proposal_id, version_id, decided_by, decision, remark
  ) values (
    v_proposal.id, v_ver_id, v_account.id, p_decision,
    case when p_decision = 'approved' then null else btrim(p_remark) end
  );

  update smartgov.proposals
     set status = p_decision
   where id = v_proposal.id;

  return jsonb_build_object(
    'ok', true, 'proposalId', v_proposal.id, 'status', p_decision, 'version', v_ver
  );
end;
$$;

revoke all on function smartgov.review_proposal(text, uuid, text, text) from public;

-- Forwarders unchanged in shape; grants survive the body replacements but are
-- re-declared for the migration audit.
create or replace function public.submit_revision(p_session_token text, p_proposal_id uuid, p_items jsonb, p_note text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.submit_revision(p_session_token, p_proposal_id, p_items, p_note); $$;
revoke all on function public.submit_revision(text, uuid, jsonb, text) from public;
grant execute on function public.submit_revision(text, uuid, jsonb, text) to anon, authenticated;

create or replace function public.review_proposal(p_session_token text, p_proposal_id uuid, p_decision text, p_remark text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.review_proposal(p_session_token, p_proposal_id, p_decision, p_remark); $$;
revoke all on function public.review_proposal(text, uuid, text, text) from public;
grant execute on function public.review_proposal(text, uuid, text, text) to anon, authenticated;