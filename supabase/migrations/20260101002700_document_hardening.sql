-- 027000 -- hardening for the document + verification work in 026000
--
-- 026000 shipped the shape of the feature and passed its probes. This migration
-- closes three gaps the probes did not cover, all of which are visible from the
-- reviewer side or from an ops cleanup rather than from the happy path.
--
--   1. `list_verifications` joined the verdict table on the *caller*, so an LSG
--      author -- the person who most needs to know whether USG has read their
--      document -- saw `verdict: null` for a document USG had already ruled on.
--      The checklist has to carry the organisation's verdict, not the reader's.
--   2. `proposal_items_valid` proved a path had bytes behind it but never tied
--      that row to the requirement item, the filename, or the size the client
--      declared. A stored document for item A could be filed as the attachment
--      for item B, or a 12-byte row could be filed under a size of 12 MB.
--   3. Nothing ever removed a large object, and nothing tied a document to the
--      proposal it was filed under -- the path's proposal fragment is chosen before
--      `create_proposal` mints the real id, so it never matched. Deleting a proposal
--      left both the row and the bytes behind, and there was no way to find a
--      proposal's documents by proposal.
--   4. A reservation that had bytes half-written looked finished. `document_uploads`
--      had one column for the promised size and one for the attached object, so a
--      partial write could be submitted as a whole document. `written_bytes` makes
--      the progress observable and `confirm_document_upload` can insist that the
--      bytes that landed are exactly the bytes that were promised -- which is also
--      what lets the browser send a file in pieces.

-- ------------------------------------------------- 1. the verdict the org has given

-- Same scope rules as 026000, so this only changes what the caller is shown.
--
-- `verdict`/`remark`/`verifiedBy`/`verifiedAt` are now the *latest* opinion from
-- any reviewer in the organisation -- the state the document is actually in.
-- `myVerdict` is the caller's own opinion, which is what a reviewer needs in
-- order to see "I already approved this" and what an author needs in order to
-- see "I never got a say, and neither did anyone else".
create or replace function smartgov.list_verifications(p_session_token text, p_proposal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_unit    uuid;
  v_author  uuid;
  v_scope   boolean := false;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select p.unit_id, p.created_by into v_unit, v_author
    from smartgov.proposals p
   where p.id = p_proposal_id
     and p.organization_id = v_account.organization_id;

  if v_unit is null and v_author is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_scope := v_account.account_scope = 'owner'
          or smartgov.is_org_reviewer(v_account.id, v_account.organization_id)
          or v_author = v_account.id
          or (v_unit is not null and v_unit in (
                select u from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u
              ));

  if not v_scope then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'submissionId', isub.id,
          'label', ri.label,
          'itemKind', ri.item_kind,
          'submissionKind', isub.submission_kind,
          'originalName', isub.original_name,
          'linkUrl', isub.link_url,
          'hasDocument', (isub.submission_kind = 'file'
                          and exists (select 1 from smartgov.document_uploads d
                                       where d.storage_path = isub.storage_path
                                         and d.large_object_oid is not null
                                         and d.confirmed_at is not null
                                         and d.written_bytes = d.size_bytes)),
          -- the organisation's current opinion
          'verdict', sv.verdict,
          'remark', sv.remark,
          'verifiedBy', (select a.display_name from smartgov.accounts a where a.id = sv.verified_by),
          'verifiedAt', sv.created_at,
          -- and the reader's own, which is a different question
          'myVerdict', mine.verdict,
          'myRemark', mine.remark,
          'reviewerCount', (select count(*)::int
                              from smartgov.submission_verifications c
                             where c.submission_id = isub.id)
        ) order by isub.submitted_at, isub.id)
        from smartgov.item_submissions isub
        join smartgov.proposal_versions pv on pv.id = isub.version_id
        join smartgov.requirement_items ri on ri.id = isub.requirement_item_id
        -- latest opinion from anyone, so the author sees the ruling
        left join lateral (
          select v.verdict, v.remark, v.verified_by, v.created_at
            from smartgov.submission_verifications v
           where v.submission_id = isub.id
           order by v.created_at desc, v.verified_by desc
           limit 1
        ) sv on true
        -- this reader's own opinion
        left join lateral (
          select v.verdict, v.remark
            from smartgov.submission_verifications v
           where v.submission_id = isub.id
             and v.verified_by = v_account.id
           limit 1
        ) mine on true
       where pv.proposal_id = p_proposal_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_verifications(text, uuid) from public;

-- --------------------------------------- 2. bind the stored document to the claim

-- Same validation as 026000, with the stored row's identity checked instead of
-- just its existence. `d.requirement_item = v_tid` stops a document uploaded
-- against one requirement from being filed as another requirement's attachment;
-- the name and size comparisons stop the submission record from describing
-- something other than the bytes that are actually stored.
create or replace function smartgov.proposal_items_valid(
  p_account  smartgov.accounts,
  p_template jsonb,
  p_items    jsonb,
  p_version  int
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_i      int;
  v_e      int;
  v_t      jsonb;
  v_tid    uuid;
  v_entry  jsonb;
  v_ext    text;
  v_name   text;
  v_path   text;
  v_link   text;
  v_size   bigint;
  v_frag   text;
  v_found  boolean;
begin
  -- Every template item must map to exactly one client entry.
  for v_i in 0 .. jsonb_array_length(p_template) - 1 loop
    v_t    := p_template->v_i;
    v_tid  := (v_t->>'id')::uuid;
    v_found := false;

    for v_e in 0 .. jsonb_array_length(p_items) - 1 loop
      v_entry := p_items->v_e;
      if (v_entry->>'requirement_item_id')::uuid = v_tid then
        v_found := true;
        exit;
      end if;
    end loop;

    if not v_found then
      return jsonb_build_object('ok', false, 'reason', 'incomplete_submission');
    end if;

    if v_entry->>'kind' <> v_t->>'itemKind' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_request');
    end if;

    if v_t->>'itemKind' = 'file' then
      v_name := v_entry->>'originalName';
      v_path := v_entry->>'storagePath';
      v_size := coalesce((v_entry->>'sizeBytes')::bigint, 0);
      if v_name is null or position('/' in v_name) > 0
         or position('\' in v_name) > 0 or length(v_name) > 128
         or v_path is null or v_size < 1 or v_size > 10485760 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_request');
      end if;
      v_ext := lower(substring(v_name from '[^.]+$'));
      if not (v_ext = any(smartgov.jsonb_text_array(v_t->'allowedExtensions'))) then
        return jsonb_build_object('ok', false, 'reason', 'unsupported_file_type');
      end if;
      -- The path must be the exact shape the upload route mints:
      -- <org>/proposals/<uuid>/v<N>/<item>/<name>. Comparing against the capture is
      -- also a NULL guard: if the pattern is absent the capture is null, the whole
      -- comparison collapses to NULL, and a NULL condition skips the reject -- so the
      -- capture is tested for null first.
      v_frag := substring(v_path from 'proposals/([^/]+)/');
      if v_frag is null
         or v_path <> p_account.organization_id::text || '/proposals/'
              || v_frag || '/v' || p_version || '/'
              || v_tid || '/' || v_name then
        return jsonb_build_object('ok', false, 'reason', 'invalid_request');
      end if;
      -- ...and it must be a document that was actually stored, by this organization,
      -- for this requirement item, under this name, at this size, and fully written.
      -- Existence alone is satisfied by any row that happens to sit at that path; an
      -- attached object alone is satisfied by an upload that stopped halfway.
      if not exists (
        select 1 from smartgov.document_uploads d
         where d.storage_path = v_path
           and d.organization_id = p_account.organization_id
           and d.large_object_oid is not null
           and d.confirmed_at is not null
           and d.written_bytes = d.size_bytes
           and d.requirement_item = v_tid
           and d.original_name = v_name
           and d.size_bytes = v_size
      ) then
        return jsonb_build_object('ok', false, 'reason', 'missing_document');
      end if;
    else
      v_link := btrim(v_entry->>'linkUrl');
      if v_link !~ '^https?://' or length(v_link) > 2048 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_request');
      end if;
    end if;
  end loop;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.proposal_items_valid(smartgov.accounts, jsonb, jsonb, int) from public;

-- --------------------------------------------------- 3. bind documents to proposals

-- `create_proposal` mints the proposal id itself, so the `<uuid>` in a storage path is
-- chosen by the upload route before the proposal exists and never matches it. That
-- made the path's proposal fragment decorative: there was no stored link between a
-- document and the proposal it was filed under, so nothing could cascade and nothing
-- could be found by proposal.
--
-- The link is made where it can be trusted -- from the submission row, which is
-- written by `create_proposal` and `submit_revision` inside the database. The client
-- never supplies it, so a client cannot point a document at somebody else's proposal.
alter table smartgov.document_uploads
  add column if not exists proposal_id uuid
  references smartgov.proposals(id) on delete cascade;

create or replace function smartgov.bind_document_to_proposal()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_proposal uuid;
begin
  if new.submission_kind <> 'file' or new.storage_path is null then
    return new;
  end if;

  select pv.proposal_id into v_proposal
    from smartgov.proposal_versions pv
   where pv.id = new.version_id;

  -- `proposal_id is null` keeps the first binding: a revision's submission points at
  -- the same document path space, and re-binding must not move a document between
  -- proposals if a path is ever reused.
  update smartgov.document_uploads d
     set proposal_id = v_proposal
   where d.storage_path = new.storage_path
     and d.proposal_id is null;

  return new;
end;
$$;

drop trigger if exists item_submissions_bind_document on smartgov.item_submissions;
create trigger item_submissions_bind_document
  after insert on smartgov.item_submissions
  for each row execute function smartgov.bind_document_to_proposal();

-- Deleting a proposal now takes its documents with it through the foreign key, and
-- each of those row deletes fires `document_uploads_release_object`, so the bytes go
-- with the row. No string matching on the path is involved anywhere in the chain.

-- `lo_unlink` inside a trigger is allowed (it is not a transaction control
-- function), and running it as the definer means the trigger works regardless of
-- who issued the delete. The exception is swallowed on purpose: if the object is
-- already gone, the row still has to disappear -- a row that cannot be cleaned up
-- because its bytes vanished would be worse than the leftover it describes.
create or replace function smartgov.release_document_object()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
begin
  if old.large_object_oid is not null then
    begin
      perform lo_unlink(old.large_object_oid);
    exception when others then
      null;
    end;
  end if;
  return old;
end;
$$;

drop trigger if exists document_uploads_release_object on smartgov.document_uploads;
create trigger document_uploads_release_object
  after delete on smartgov.document_uploads
  for each row execute function smartgov.release_document_object();

-- 026000 shipped a proposal-level trigger that matched documents by string prefix on
-- the storage path. It is replaced by the foreign key above and dropped here so the
-- two mechanisms are never both live.
drop trigger if exists proposals_release_documents on smartgov.proposals;
drop function if exists smartgov.release_proposal_documents();

-- ------------------------------------------------ 4. write a document in pieces

-- The hosting edge caps a single request body well below the 10 MiB the product
-- allows, so the browser sends the file in chunks and the route appends each one.
-- The alternative -- quietly lowering the product's cap to whatever the edge allows
-- -- would make the limit a property of the deployment.
--
-- `written_bytes` is the reason this is safe. 026000 attached the object in one step
-- at confirm time, so there was no way to tell a finished document from one whose
-- upload stopped halfway; now progress is a stored number, the validator refuses any
-- row where it does not equal the promised size, and `confirm_document_upload` will
-- not close an upload that is short.
alter table smartgov.document_uploads
  add column if not exists written_bytes bigint not null default 0;

-- Appends one chunk at exactly the offset the row says is next. Offsets are not
-- advisory: a chunk that arrives out of order is refused rather than written, so a
-- retried or duplicated request cannot interleave two different files' bytes into
-- one object. `for update` serialises two concurrent chunks for the same path.
create or replace function smartgov.write_document_chunk(
  p_session_token text,
  p_storage_path  text,
  p_offset        bigint,
  p_chunk         bytea,
  p_total_bytes   bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_oid     oid;
  v_written bigint;
  v_size    bigint;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if p_chunk is null or octet_length(p_chunk) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select d.large_object_oid, d.written_bytes, d.size_bytes
    into v_oid, v_written, v_size
    from smartgov.document_uploads d
   where d.storage_path = p_storage_path
     and d.uploaded_by = v_account.id
     and d.organization_id = v_account.organization_id
     and d.confirmed_at is null
   for update;

  if v_size is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if p_total_bytes <> v_size
     or v_size < 1 or v_size > 10485760 then
    return jsonb_build_object('ok', false, 'reason', 'size_mismatch');
  end if;

  -- A closed upload is not reopened: its bytes are already the record's bytes.
  if v_oid is not null and v_written = v_size then
    return jsonb_build_object('ok', false, 'reason', 'already_uploaded');
  end if;

  if coalesce(v_written, 0) <> coalesce(p_offset, -1) then
    return jsonb_build_object(
      'ok', false, 'reason', 'offset_mismatch', 'writtenBytes', coalesce(v_written, 0)
    );
  end if;

  if coalesce(v_written, 0) + octet_length(p_chunk) > v_size then
    return jsonb_build_object('ok', false, 'reason', 'size_mismatch');
  end if;

  if v_oid is null then
    v_oid := lo_from_bytea(0, p_chunk);
  else
    -- `lo_put` writes at an offset; the cursor-based `lowrite` is the legacy
    -- interface and is not what takes a bigint offset.
    perform lo_put(v_oid, coalesce(v_written, 0), p_chunk);
  end if;

  update smartgov.document_uploads
     set large_object_oid = v_oid,
         written_bytes = coalesce(v_written, 0) + octet_length(p_chunk)
   where storage_path = p_storage_path;

  return jsonb_build_object(
    'ok', true,
    'writtenBytes', coalesce(v_written, 0) + octet_length(p_chunk),
    'complete', coalesce(v_written, 0) + octet_length(p_chunk) = v_size
  );
end;
$$;

revoke all on function smartgov.write_document_chunk(text, text, bigint, bytea, bigint) from public;

create or replace function public.write_document_chunk(text, text, bigint, bytea, bigint)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.write_document_chunk($1, $2, $3, $4, $5); $$;
revoke all on function public.write_document_chunk(text, text, bigint, bytea, bigint) from public;
grant execute on function public.write_document_chunk(text, text, bigint, bytea, bigint) to anon, authenticated;

-- Closing an upload changes shape: the object is attached by the chunk writes now,
-- so the oid is no longer an input. The two-argument-oid version is dropped rather
-- than left beside the new one, where a stale signature would keep looking callable.
drop function if exists public.confirm_document_upload(text, text, bigint, bigint);
drop function if exists smartgov.confirm_document_upload(text, text, bigint, bigint);

create or replace function smartgov.confirm_document_upload(
  p_session_token text,
  p_storage_path  text,
  p_actual_bytes  bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account  smartgov.accounts%rowtype;
  v_oid      oid;
  v_written  bigint;
  v_size     bigint;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select d.large_object_oid, d.written_bytes, d.size_bytes
    into v_oid, v_written, v_size
    from smartgov.document_uploads d
   where d.storage_path = p_storage_path
     and d.uploaded_by = v_account.id
     and d.organization_id = v_account.organization_id
     and d.confirmed_at is null
   for update;

  if v_size is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- The bytes that landed must be exactly the bytes that were promised. This is the
  -- line a truncated upload stops at: it can be retried, never submitted.
  if v_oid is null or v_written is null or v_written <> v_size then
    return jsonb_build_object(
      'ok', false, 'reason', 'incomplete_upload',
      'writtenBytes', coalesce(v_written, 0), 'expectedBytes', v_size
    );
  end if;

  if p_actual_bytes is null or p_actual_bytes <> v_size
     or v_size < 1 or v_size > 10485760 then
    return jsonb_build_object('ok', false, 'reason', 'size_mismatch');
  end if;

  update smartgov.document_uploads
     set confirmed_at = now()
   where storage_path = p_storage_path;

  return jsonb_build_object('ok', true, 'storagePath', p_storage_path);
end;
$$;

revoke all on function smartgov.confirm_document_upload(text, text, bigint) from public;

create or replace function public.confirm_document_upload(text, text, bigint)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.confirm_document_upload($1, $2, $3); $$;
revoke all on function public.confirm_document_upload(text, text, bigint) from public;
grant execute on function public.confirm_document_upload(text, text, bigint) to anon, authenticated;
-- --------------------------------------------------- 5. reading a finished document

-- Reading gets the same completeness rule as submitting. A half-written upload is
-- not something to hand to a reviewer even if some path managed to name it.
create or replace function smartgov.get_document(p_session_token text, p_submission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_row     record;
  v_scope   boolean := false;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select isub.storage_path, isub.original_name, isub.mime_type, isub.size_bytes,
         d.large_object_oid, p.created_by, p.unit_id
    into v_row
    from smartgov.item_submissions isub
    join smartgov.proposal_versions pv on pv.id = isub.version_id
    join smartgov.proposals p on p.id = pv.proposal_id
    join smartgov.document_uploads d
      on d.storage_path = isub.storage_path
     and d.large_object_oid is not null
     and d.confirmed_at is not null
     and d.written_bytes = d.size_bytes
   where isub.id = p_submission_id
     and p.organization_id = v_account.organization_id;

  if v_row.storage_path is null or v_row.large_object_oid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_scope := v_account.account_scope = 'owner'
          or smartgov.is_org_reviewer(v_account.id, v_account.organization_id)
          or v_row.created_by = v_account.id
          or (v_row.unit_id is not null and v_row.unit_id in (
                select u from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u
              ));

  if not v_scope then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'oid', v_row.large_object_oid,
    'originalName', v_row.original_name,
    'mimeType', v_row.mime_type,
    'sizeBytes', v_row.size_bytes
  );
end;
$$;

revoke all on function smartgov.get_document(text, uuid) from public;


-- ------------------------------------------------------- 6. resume, do not restart

-- A browser that loses its connection mid-upload has already spent the bytes, and
-- the offset protocol exists so it does not have to send them again. So a second
-- claim on the same path, by the same account, while the reservation is still open,
-- is not a conflict -- it is the client asking where it got to. A closed document is
-- still a conflict: its bytes are the record's bytes.
--
-- Everything else is 026000's validation, unchanged. The resume branch is the only
-- addition; it does not relax the shape check, the extension check, or the cap,
-- because a resumed path still has to be a path this caller could have claimed.
create or replace function smartgov.claim_document_upload(
  p_session_token text,
  p_storage_path  text,
  p_original_name text,
  p_mime_type    text,
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
  v_open    record;
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

  -- The path must begin with the caller's own organization. This is the line that
  -- stops a document landing in another organization's namespace.
  v_org := nullif(split_part(p_storage_path, '/', 1), '')::uuid;

  if v_org is null or v_org <> v_account.organization_id then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- ...and must be exactly the shape the rest of the system reasons about. Each
  -- capture is its own `substring` with exactly one capture group, and each is tested
  -- for null before use, because a NULL here makes the comparison below NULL and a
  -- NULL condition skips a reject.
  v_frag    := nullif(substring(p_storage_path from '^[^/]+/proposals/([^/]+)/v[0-9]+/'), '')::uuid;
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

  -- The requirement item must be one this caller could submit against: the same gate
  -- `match_requirement_item` uses, inlined so it cannot drift from the shape check.
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

  v_ext := lower(substring(p_original_name from '[^.]+$'));

  if array_length(v_item.allowed_extensions, 1) > 0
     and not (v_ext = any(v_item.allowed_extensions)) then
    return jsonb_build_object('ok', false, 'reason', 'unsupported_file_type');
  end if;

  -- An existing row decides the outcome before anything is written. Checked here,
  -- after the shape rules, so a resumed path still has to be a path this caller
  -- could have claimed in the first place.
  select d.uploaded_by, d.confirmed_at, d.written_bytes, d.size_bytes, d.large_object_oid
    into v_open
    from smartgov.document_uploads d
   where d.storage_path = p_storage_path;

  if v_open.uploaded_by is not null then
    if v_open.confirmed_at is not null or v_open.uploaded_by <> v_account.id then
      return jsonb_build_object('ok', false, 'reason', 'already_uploaded');
    end if;

    if v_open.size_bytes <> p_size_bytes then
      -- The file changed between attempts, so the partial bytes belong to a document
      -- that no longer exists. Drop them and start over rather than splice two files
      -- into one object.
      begin
        perform lo_unlink(v_open.large_object_oid);
      exception when others then
        null;
      end;
      delete from smartgov.document_uploads where storage_path = p_storage_path;
    else
      return jsonb_build_object(
        'ok', true,
        'storagePath', p_storage_path,
        'writtenBytes', coalesce(v_open.written_bytes, 0),
        'resumed', true
      );
    end if;
  end if;

  insert into smartgov.document_uploads (
    storage_path, organization_id, uploaded_by, requirement_item,
    original_name, mime_type, size_bytes
  ) values (
    p_storage_path, v_account.organization_id, v_account.id, v_item_id,
    p_original_name, coalesce(nullif(btrim(p_mime_type), ''), 'application/octet-stream'),
    p_size_bytes
  );

  return jsonb_build_object(
    'ok', true,
    'storagePath', p_storage_path,
    'writtenBytes', 0,
    'resumed', false
  );
end;
$$;

revoke all on function smartgov.claim_document_upload(text, text, text, text, bigint) from public;

create or replace function public.claim_document_upload(text, text, text, text, bigint)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.claim_document_upload($1, $2, $3, $4, $5); $$;
revoke all on function public.claim_document_upload(text, text, text, text, bigint) from public;
grant execute on function public.claim_document_upload(text, text, text, text, bigint) to anon, authenticated;
-- An earlier draft of this migration added a `p_version` argument. The version is
-- already in the path, and the database reads it from there, so that overload was
-- never needed. It was published and granted, and a caller who found it would have
-- reached the same function by a second route. Postgres resolves an overloaded name
-- by argument types, and both signatures are all-text-plus-bigint, so leaving it
-- behind makes which one runs depend on how the function was called.
drop function if exists public.claim_document_upload(text, text, text, text, bigint, integer);
drop function if exists smartgov.claim_document_upload(text, text, text, text, bigint, integer);
-- ------------------------------------------------- 7. forwarders the app can call

-- Every forwarder above was written without parameter names. That is valid SQL and it
-- is what `psql` wants for a positional call, but PostgREST resolves an `/rpc` call
-- by matching the names in the request body against the names in its cached schema.
-- With unnamed parameters there is no name to match, so PostgREST reports a function
-- that plainly exists as "could not find ... in the schema cache". The rest of the app
-- already declares its forwarders with names; these were the odd ones out, which is
-- why the SQL probe could call them and the browser could not.
--
-- `create or replace` cannot rename a parameter, so each one is dropped first. The
-- body is unchanged -- still a bare call into the private schema, still security
-- definer with a pinned search path, still revoked from the world and granted only to
-- the two roles the app signs in as.
drop function if exists public.claim_document_upload(text, text, text, text, bigint);
drop function if exists public.write_document_chunk(text, text, bigint, bytea, bigint);
drop function if exists public.confirm_document_upload(text, text, bigint);
drop function if exists public.discard_document_upload(text, text);
drop function if exists public.get_document(text, uuid);
drop function if exists public.verify_submission(text, uuid, text, text);
drop function if exists public.list_verifications(text, uuid);

create function public.claim_document_upload(
  p_session_token text, p_storage_path text, p_original_name text,
  p_mime_type text, p_size_bytes bigint
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.claim_document_upload($1, $2, $3, $4, $5); $$;

create function public.write_document_chunk(
  p_session_token text, p_storage_path text, p_offset bigint,
  p_chunk bytea, p_total_bytes bigint
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.write_document_chunk($1, $2, $3, $4, $5); $$;

create function public.confirm_document_upload(
  p_session_token text, p_storage_path text, p_actual_bytes bigint
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.confirm_document_upload($1, $2, $3); $$;

create function public.discard_document_upload(p_session_token text, p_storage_path text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.discard_document_upload($1, $2); $$;

create function public.get_document(p_session_token text, p_submission_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.get_document($1, $2); $$;

create function public.verify_submission(
  p_session_token text, p_submission_id uuid, p_verdict text, p_remark text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.verify_submission($1, $2, $3, $4); $$;

create function public.list_verifications(p_session_token text, p_proposal_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_verifications($1, $2); $$;

revoke all on function public.claim_document_upload(text, text, text, text, bigint) from public;
revoke all on function public.write_document_chunk(text, text, bigint, bytea, bigint) from public;
revoke all on function public.confirm_document_upload(text, text, bigint) from public;
revoke all on function public.discard_document_upload(text, text) from public;
revoke all on function public.get_document(text, uuid) from public;
revoke all on function public.verify_submission(text, uuid, text, text) from public;
revoke all on function public.list_verifications(text, uuid) from public;

grant execute on function public.claim_document_upload(text, text, text, text, bigint) to anon, authenticated;
grant execute on function public.write_document_chunk(text, text, bigint, bytea, bigint) to anon, authenticated;
grant execute on function public.confirm_document_upload(text, text, bigint) to anon, authenticated;
grant execute on function public.discard_document_upload(text, text) to anon, authenticated;
grant execute on function public.get_document(text, uuid) to anon, authenticated;
grant execute on function public.verify_submission(text, uuid, text, text) to anon, authenticated;
grant execute on function public.list_verifications(text, uuid) to anon, authenticated;