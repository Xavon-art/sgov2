-- Request module: the ownership model on document_uploads, corrected.
--
-- Two constraints on `document_uploads` were written for a world with exactly
-- two owners, and this phase adds two more. Both needed more than a widened
-- list, because one of them encoded the wrong rule to begin with.
--
--   1. `document_uploads_target_check` required
--          (requirement_item IS NULL) <> (proposal_requirement IS NULL)
--      i.e. exactly one of the two old owners. `document_uploads_owner_exclusive`
--      then said the same thing in four-column form. Keeping both meant the
--      stricter two-column one won, so every new-owner insert failed -- which is
--      how this was found: the claim path returned a check violation, not a
--      logic error.
--
--   2. More importantly, "exactly one owner" is not the right rule for this
--      table. An upload is STAGED before it is owned: the bytes are reserved,
--      written, and sealed while still belonging to nobody, and the owner is
--      stamped when the thing it belongs to is created. The personal-request
--      flow does exactly that, because a request has no id until it is filed.
--      So the rule is AT MOST one owner, from any of the four columns.
--
-- The table holds no rows, so this is a pure schema correction -- there is no
-- data to migrate and nothing that could fail on the old shape.
--
-- The exclusivity property is kept, and it is the part worth keeping: a
-- document belongs to at most one thing, so it can never be attached twice and
-- then deleted from under one of its owners.

alter table smartgov.document_uploads
  drop constraint if exists document_uploads_target_check;

alter table smartgov.document_uploads
  drop constraint if exists document_uploads_owner_exclusive;

alter table smartgov.document_uploads
  add constraint document_uploads_owner_exclusive check (
    (case when requirement_item    is null then 0 else 1 end)
  + (case when proposal_requirement is null then 0 else 1 end)
  + (case when task_requirement    is null then 0 else 1 end)
  + (case when personal_request    is null then 0 else 1 end)
  <= 1
  );

-- A staged row is one with no owner and no sealed object yet. Rows in that state
-- are the ones a resume or an abort may act on, so the index is partial and
-- small rather than covering the whole table.
create index if not exists document_uploads_staging_idx
  on smartgov.document_uploads (storage_path)
  where confirmed_at is null;

-- ----------------------------------------- the proposals claim needs the same rule
--
-- `claim_document_upload` also inserted a row with `requirement_item` set and
-- relied on the old two-column constraint. It is re-issued unchanged except for
-- one line: the owner columns are written explicitly, so the row it creates is a
-- valid at-most-one-owner row under the new rule. Nothing else about it moves.
create or replace function smartgov.claim_document_upload(
  p_session_token text,
  p_storage_path  text,
  p_original_name text,
  p_mime_type     text,
  p_size_bytes    bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_item    smartgov.requirement_items%rowtype;
  v_org     uuid;
  v_frag    uuid;
  v_version int;
  v_item_id uuid;
  v_ext     text;
  v_oid     bigint;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if not smartgov.consume_rate_limit(
       'document:upload:' || v_account.id::text, 60, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  if p_storage_path is null or p_original_name is null or p_size_bytes is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if position('/' in p_original_name) > 0
     or position('\' in p_original_name) > 0
     or length(p_original_name) not between 1 and 128
     or p_size_bytes < 1 or p_size_bytes > 10485760 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_org := nullif(split_part(p_storage_path, '/', 1), '')::uuid;
  if v_org is null or v_org <> v_account.organization_id then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  v_frag    := nullif(substring(p_storage_path from '^[^/]+/proposals/([^/]+)/v[0-9]+/'), '');
  v_version := substring(p_storage_path from '^[^/]+/proposals/[^/]+/v([0-9]+)/')::int;
  v_item_id := nullif(substring(p_storage_path from '^[^/]+/proposals/[^/]+/v[0-9]+/([^/]+)/'), '')::uuid;

  if v_frag is null or v_version is null or v_item_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if p_storage_path <> v_account.organization_id::text || '/proposals/'
                       || v_frag::text || '/v' || v_version || '/'
                       || v_item_id::text || '/' || p_original_name then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if v_version < 1 or v_version > 50 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select ri.* into v_item
    from smartgov.requirement_items ri
   where ri.id = v_item_id
     and ri.organization_id = v_account.organization_id
     and (
       v_account.account_scope = 'owner'
       or smartgov.is_org_reviewer(v_account.id, v_account.organization_id)
       or ri.program_id is null
       or exists (select 1 from smartgov.programs pr
                   where pr.id = ri.program_id
                     and pr.organization_id = ri.organization_id
                     and pr.status = 'published')
     );

  if v_item.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_item.item_kind <> 'file' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_ext := lower(substring(p_original_name from '[^.]+$'));

  if v_item.accepted_types is not null
     and jsonb_typeof(v_item.accepted_types) = 'array'
     and jsonb_array_length(v_item.accepted_types) > 0
     and not (v_item.accepted_types ? v_ext) then
    return jsonb_build_object('ok', false, 'reason', 'unsupported_file_type');
  end if;

  -- Resume an in-flight reservation for this exact path rather than making a
  -- second one, so a dropped upload continues instead of starting over.
  select du.large_object_oid into v_oid
    from smartgov.document_uploads du
   where du.storage_path = p_storage_path
     and du.confirmed_at is null
     and du.organization_id = v_account.organization_id
   limit 1;

  if v_oid is null then
    v_oid := lo_create(0);

    -- One owner column set, the rest null: a valid at-most-one-owner row.
    insert into smartgov.document_uploads
      (storage_path, organization_id, uploaded_by, requirement_item,
       original_name, mime_type, size_bytes, large_object_oid, written_bytes)
    values
      (p_storage_path, v_account.organization_id, v_account.id, v_item_id,
       p_original_name, coalesce(p_mime_type, ''), p_size_bytes, v_oid, 0);

    return jsonb_build_object('ok', true, 'storagePath', p_storage_path, 'writtenBytes', 0);
  end if;

  return jsonb_build_object(
    'ok', true,
    'storagePath', p_storage_path,
    'writtenBytes', coalesce((
      select du.written_bytes from smartgov.document_uploads du
       where du.storage_path = p_storage_path limit 1), 0),
    'resumed', true);
end;
$$;

revoke all on function smartgov.claim_document_upload(text, text, text, text, bigint) from public;

grant execute on function public.claim_document_upload(text, text, text, text, bigint) to anon, authenticated, service_role;
