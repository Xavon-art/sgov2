-- Documents that can actually be stored, and the two things that were missing:
-- a working upload path, and per-document verification.
--
-- Why the bytes live in Postgres and not in Supabase Storage: this project has no
-- Supabase Auth and no service-role key, so it cannot mint a signed upload URL --
-- storage signing moved into the Storage API service, which needs the JWT secret,
-- and this project never had it. Rather than ask for a key that would then have to
-- be kept out of every bundle, the documents go into large objects, reached only
-- through the same privileged connection the migrations already use, with every
-- read and write still gated by a `security definer` function in this schema.
--
-- The consequence worth stating plainly: a document is bytes in a database row, not
-- a file in object storage. For requirement attachments capped at 10MiB that is a
-- fair trade for having the access rules in one place. It is not the right shape for
-- a media library, and this is not one.
--
-- Upload shape, unchanged from the design the existing SQL already expects:
--   <org>/proposals/<proposalId>/v<N>/<requirementItemId>/<originalName>
-- `proposal_items_valid` compares against exactly that string, so the path a
-- document is stored under is the proof of which organization, proposal, version and
-- requirement item it belongs to. The new part is that the path must now have bytes
-- behind it: a submission can no longer name a path that was never uploaded.

-- ------------------------------------------------------- centralized reviewers
-- The bug this fixes: `is_org_reviewer` looked for a seat in a unit of type 'usg',
-- and `create_organization` writes a unit of type 'council' for a unitary
-- organization. So in a centralized org NOBODY could ever be a reviewer except the
-- owner, and every invited officer fell through to the LSG shell -- an officer of the
-- central council reviewing the council's own submissions from the wrong side of the
-- split, with no Invitations and no Access.
--
-- The rule, stated once: the reviewing office is whoever holds a seat in the
-- organization's ROOT unit. In a federated org that root is the USG board; in a
-- centralized org it is the council, which is the top of the tree precisely because
-- there is nothing above it. Same seat, same authority, different label.
--
-- Both branches are named explicitly rather than testing `parent_id is null` alone.
-- A future org with two roots should not silently make every root a reviewer, and
-- the explicit list is the place to notice that.
create or replace function smartgov.is_org_reviewer(p_account uuid, p_organization uuid)
returns boolean
language sql stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select exists (
    select 1
      from smartgov.roster r
      join smartgov.unit_memberships m
        on m.roster_id = r.id
       and m.end_date is null
      join public.governance_units u
        on u.id = m.unit_id
     where r.account_id = p_account
       and r.organization_id = p_organization
       and u.organization_id = p_organization
       and (u.unit_type = 'usg'
            or (u.unit_type = 'council' and u.parent_id is null))
  );
$$;

revoke all on function smartgov.is_org_reviewer(uuid, uuid) from public;

-- ------------------------------------------------------------ document bytes
-- One row per stored document, keyed by the path. `large_object_oid` is null until
-- the bytes have actually landed, and that null is the whole point: it is what
-- separates "the client asked for this path" from "there is a document here".
create table if not exists smartgov.document_uploads (
  storage_path      text primary key,
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  uploaded_by       uuid not null references smartgov.accounts (id),
  requirement_item  uuid not null references smartgov.requirement_items (id) on delete cascade,
  original_name     text not null check (length(original_name) between 1 and 128),
  mime_type         text not null default 'application/octet-stream',
  size_bytes        bigint not null check (size_bytes between 1 and 10485760),
  large_object_oid  bigint,
  created_at        timestamptz not null default now(),
  confirmed_at      timestamptz
);

alter table smartgov.document_uploads enable row level security;

revoke all on smartgov.document_uploads from anon, authenticated;

-- Reserve a path and prove the caller is allowed to use it. Split from writing the
-- bytes on purpose: the route claims first, so an upload that is refused is refused
-- before anything is stored, and an upload that succeeds leaves a row that says which
-- requirement item it was for.
--
-- Everything the shape check needs is derived from the path itself rather than
-- trusted as arguments -- the org from the prefix, the version from `/v<N>/`, and the
-- requirement item from the segment after it. A caller cannot therefore claim a path
-- for a different unit than the one the path belongs to.
create or replace function smartgov.claim_document_upload(
  p_session_token  text,
  p_storage_path   text,
  p_original_name  text,
  p_mime_type      text,
  p_size_bytes     bigint
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
  -- capture is its own `substring` with exactly one capture group: Postgres returns
  -- an array when a pattern has more than one, which would silently cast to the
  -- wrong thing rather than fail. Each is tested for null before it is used, because
  -- a NULL here makes the comparison below NULL, and a NULL condition skips a reject.
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

  -- The requirement item must be one this caller could submit against: the same gate
  -- `match_requirement_item` uses, inlined so the check cannot drift from the shape
  -- check above.
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

  if array_length(v_item.allowed_extensions, 1) > 0
     and not (v_ext = any(v_item.allowed_extensions)) then
    return jsonb_build_object('ok', false, 'reason', 'unsupported_file_type');
  end if;

  -- Re-uploading the same path is refused rather than overwritten. The bytes are
  -- already written by this point in the route, so an overwrite would leak the old
  -- document's large object; refusing keeps one path to one document forever.
  if exists (select 1 from smartgov.document_uploads d where d.storage_path = p_storage_path) then
    return jsonb_build_object('ok', false, 'reason', 'already_uploaded');
  end if;

  insert into smartgov.document_uploads (
    storage_path, organization_id, uploaded_by, requirement_item,
    original_name, mime_type, size_bytes
  ) values (
    p_storage_path, v_account.organization_id, v_account.id, v_item.id,
    p_original_name, coalesce(nullif(btrim(p_mime_type), ''), 'application/octet-stream'),
    p_size_bytes
  );

  return jsonb_build_object('ok', true, 'storagePath', p_storage_path);
end;
$$;

revoke all on function smartgov.claim_document_upload(text, text, text, text, bigint) from public;

-- Attach the bytes. Separate from the claim so the row exists and is authoritative
-- before anything is stored, and so the stored size is compared against the size that
-- was promised -- a client that under-declares its size cannot slip a larger file
-- past the bucket limit by claiming a smaller number.
create or replace function smartgov.confirm_document_upload(
  p_session_token text,
  p_storage_path  text,
  p_oid           bigint,
  p_actual_bytes  bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_size    bigint;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select d.size_bytes into v_size
    from smartgov.document_uploads d
   where d.storage_path = p_storage_path
     and d.uploaded_by = v_account.id
     and d.organization_id = v_account.organization_id
     and d.large_object_oid is null
   for update;

  if v_size is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if p_oid is null or p_actual_bytes is null
     or p_actual_bytes <> v_size
     or p_actual_bytes < 1
     or p_actual_bytes > 10485760 then
    return jsonb_build_object('ok', false, 'reason', 'size_mismatch');
  end if;

  update smartgov.document_uploads
     set large_object_oid = p_oid,
         confirmed_at = now(),
         size_bytes = p_actual_bytes
   where storage_path = p_storage_path;

  return jsonb_build_object('ok', true, 'storagePath', p_storage_path);
end;
$$;

revoke all on function smartgov.confirm_document_upload(text, text, bigint, bigint) from public;

-- Give a reservation back. Used when the bytes could not be written after the claim
-- succeeded, so a failed upload does not burn the path and block the retry.
create or replace function smartgov.discard_document_upload(p_session_token text, p_storage_path text)
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

  delete from smartgov.document_uploads d
   where d.storage_path = p_storage_path
     and d.uploaded_by = v_account.id
     and d.large_object_oid is null;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.discard_document_upload(text, text) from public;

-- Read a stored document. Same scope test as `get_item_file`, and it returns the
-- large-object id rather than a URL, because there is no URL to hand out: the route
-- streams the bytes itself, and only after this has said yes.
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
    join smartgov.document_uploads d on d.storage_path = isub.storage_path
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

-- ------------------------------------------- a path is not a document until it is
-- `proposal_items_valid` now refuses a file submission whose path has no confirmed
-- bytes behind it. Before this, a client could name any well-formed path -- the shape
-- check passed -- and the requirement would be recorded as filed with nothing filed.
--
-- Everything else in this function is the original body, unchanged. The point of
-- restating it rather than layering a separate check is that there must be exactly one
-- definition of "a valid submission", and `create_proposal` and `submit_revision`
-- both call it.
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
      -- with the bytes confirmed. Without this the shape check above is satisfied by
      -- any string that looks right, which is not evidence that anything was filed.
      if not exists (
        select 1 from smartgov.document_uploads d
         where d.storage_path = v_path
           and d.organization_id = p_account.organization_id
           and d.large_object_oid is not null
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

-- ------------------------------------------------------ per-document verification
-- Reviewing a proposal approved the whole version in one action. There was no way to
-- say "the letter is fine, the budget attachment is missing the signature", which is
-- the actual work of checking paperwork.
--
-- One row per document, per reviewer decision. Kept separate from `reviews` because
-- it answers a different question: `reviews` decides the submission, this records what
-- was checked to decide it.
create table if not exists smartgov.submission_verifications (
  id             uuid primary key default gen_random_uuid(),
  submission_id  uuid not null references smartgov.item_submissions (id) on delete cascade,
  verified_by    uuid not null references smartgov.accounts (id),
  verdict        text not null check (verdict in ('verified','queried','rejected')),
  remark         text,
  created_at     timestamptz not null default now(),
  unique (submission_id, verified_by)
);

alter table smartgov.submission_verifications enable row level security;

revoke all on smartgov.submission_verifications from anon, authenticated;

create index if not exists submission_verifications_item_idx
  on smartgov.submission_verifications (submission_id);

-- Mark one document as checked. Reviewer-only, same authority as `review_proposal`,
-- and the document must belong to a proposal in the caller's own organization.
--
-- The verdict is deliberately not derived from the proposal's status: a reviewer can
-- mark a document verified while the proposal is still `submitted`, because checking
-- a document and deciding a submission are separate acts.
create or replace function smartgov.verify_submission(
  p_session_token text,
  p_submission_id uuid,
  p_verdict       text,
  p_remark        text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_org     uuid;
  v_remark  text;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if not (v_account.account_scope = 'owner'
          or smartgov.is_org_reviewer(v_account.id, v_account.organization_id)) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if p_verdict not in ('verified','queried','rejected') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if not smartgov.consume_rate_limit(
       'document:verify:' || v_account.id::text, 200, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  select p.organization_id into v_org
    from smartgov.item_submissions isub
    join smartgov.proposal_versions pv on pv.id = isub.version_id
    join smartgov.proposals p on p.id = pv.proposal_id
   where isub.id = p_submission_id;

  if v_org is null or v_org <> v_account.organization_id then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_remark := nullif(btrim(coalesce(p_remark, '')), '');

  -- A `queried` verdict without a question attached is not a question, so it is
  -- refused rather than stored as a blank remark.
  if p_verdict = 'queried' and v_remark is null then
    return jsonb_build_object('ok', false, 'reason', 'remark_required');
  end if;

  if v_remark is not null and length(v_remark) > 1000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  insert into smartgov.submission_verifications (
    submission_id, verified_by, verdict, remark
  ) values (
    p_submission_id, v_account.id, p_verdict, v_remark
  )
  on conflict (submission_id, verified_by) do update
    set verdict = excluded.verdict,
        remark = excluded.remark,
        created_at = now();

  return jsonb_build_object('ok', true, 'verdict', p_verdict);
end;
$$;

revoke all on function smartgov.verify_submission(text, uuid, text, text) from public;

-- The verification state of every document in one proposal, so the review screen can
-- show a checklist instead of making the reviewer open each file to remember.
--
-- Scoped by the same rule as `proposal_detail`: owner, reviewer, the author, or a
-- member of the unit it was filed for. Returns one row per document including the
-- ones nobody has looked at yet, which is the point -- an unverified document has to
-- be visible, not absent.
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
      select jsonb_agg(jsonb_build_object(
        'submissionId', isub.id,
        'label', ri.label,
        'itemKind', ri.item_kind,
        'submissionKind', isub.submission_kind,
        'originalName', isub.original_name,
        'linkUrl', isub.link_url,
        'hasDocument', (isub.submission_kind = 'file'
                        and exists (select 1 from smartgov.document_uploads d
                                     where d.storage_path = isub.storage_path
                                       and d.large_object_oid is not null)),
        'verdict', sv.verdict,
        'remark', sv.remark,
        'verifiedBy', (select a.display_name from smartgov.accounts a where a.id = sv.verified_by),
        'verifiedAt', sv.created_at
      ) order by isub.submitted_at)
        from smartgov.item_submissions isub
        join smartgov.proposal_versions pv on pv.id = isub.version_id
        join smartgov.requirement_items ri on ri.id = isub.requirement_item_id
        left join smartgov.submission_verifications sv
               on sv.submission_id = isub.id
              and sv.verified_by = v_account.id
       where pv.proposal_id = p_proposal_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_verifications(text, uuid) from public;

-- ------------------------------------------------------------- public forwarders

create or replace function public.claim_document_upload(text, text, text, text, bigint)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.claim_document_upload($1, $2, $3, $4, $5); $$;
revoke all on function public.claim_document_upload(text, text, text, text, bigint) from public;
grant execute on function public.claim_document_upload(text, text, text, text, bigint) to anon, authenticated;

create or replace function public.confirm_document_upload(text, text, bigint, bigint)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.confirm_document_upload($1, $2, $3, $4); $$;
revoke all on function public.confirm_document_upload(text, text, bigint, bigint) from public;
grant execute on function public.confirm_document_upload(text, text, bigint, bigint) to anon, authenticated;

create or replace function public.discard_document_upload(text, text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.discard_document_upload($1, $2); $$;
revoke all on function public.discard_document_upload(text, text) from public;
grant execute on function public.discard_document_upload(text, text) to anon, authenticated;

create or replace function public.get_document(text, uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.get_document($1, $2); $$;
revoke all on function public.get_document(text, uuid) from public;
grant execute on function public.get_document(text, uuid) to anon, authenticated;

create or replace function public.verify_submission(text, uuid, text, text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.verify_submission($1, $2, $3, $4); $$;
revoke all on function public.verify_submission(text, uuid, text, text) from public;
grant execute on function public.verify_submission(text, uuid, text, text) to anon, authenticated;

create or replace function public.list_verifications(text, uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_verifications($1, $2); $$;
revoke all on function public.list_verifications(text, uuid) from public;
grant execute on function public.list_verifications(text, uuid) to anon, authenticated;