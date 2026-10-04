-- LSG requirement submission and review.
--
-- A USG opens PROGRAMS, each with a requirements template (requirement_items).
-- Requirement items with PROVISION `program_id IS NULL` form the standalone
-- default template, used when an LSG files an activity proposal unattached to
-- a program. An LSG officer submits PROPOSALS against a program or the
-- standalone template; every submit creates a PROPOSAL_VERSION and the
-- ITEM_SUBMISSIONS for it. The USG REVIEWS the latest version (approve /
-- return-with-remarks / reject-with-remarks); a returned proposal is resubmitted
-- as a new version. USG-authored proposals write directly as PUBLISHED and skip
-- the review loop, because the USG is the top of the hierarchy.
--
-- FILES: real bytes live in the private `proposal-documents` bucket. The
-- browser only ever touches signed URLs minted by the server. item_submissions
-- carries the storage_path of the confirmed object; the owning side downloads
-- through a re-checked, freshly signed URL, never the raw path.
--
-- Security mirrors every other migration here: RLS on, zero policies, only the
-- pinned definer functions below (and their thin `public` forwarders) can touch
-- the tables.

create table if not exists smartgov.programs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_by      uuid not null references smartgov.accounts (id),
  name            text not null check (length(btrim(name)) between 4 and 140),
  description     text not null default '',
  icon            text not null default 'academic'
                  check (icon in ('sports','culture','academic','community','wellness','special')),
  status          text not null default 'published'
                  check (status in ('draft','published')),
  created_at      timestamptz not null default now()
);

create table if not exists smartgov.requirement_items (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  program_id         uuid references smartgov.programs (id) on delete cascade,
  label              text not null check (length(btrim(label)) between 2 and 140),
  item_kind          text not null check (item_kind in ('file','link')),
  allowed_extensions text[] not null default '{}',
  position           int not null default 0,
  created_at         timestamptz not null default now()
);

create table if not exists smartgov.proposals (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  program_id      uuid references smartgov.programs (id) on delete set null,
  unit_id         uuid references public.governance_units (id) on delete set null,
  author_kind     text not null check (author_kind in ('lsg','usg')),
  created_by      uuid not null references smartgov.accounts (id),
  title           text not null check (length(btrim(title)) between 4 and 140),
  description     text not null default '',
  activity_type   text not null default 'academic'
                  check (activity_type in ('sports','culture','academic','community','wellness','special')),
  event_date      date,
  venue           text,
  status          text not null default 'submitted'
                  check (status in ('submitted','returned','approved','rejected','published')),
  created_at      timestamptz not null default now()
);

create table if not exists smartgov.proposal_versions (
  id              uuid primary key default gen_random_uuid(),
  proposal_id     uuid not null references smartgov.proposals (id) on delete cascade,
  version_number  int not null check (version_number >= 1),
  submitted_by    uuid not null references smartgov.accounts (id),
  submission_note text,
  submitted_at    timestamptz not null default now(),
  unique (proposal_id, version_number)
);

create table if not exists smartgov.item_submissions (
  id                  uuid primary key default gen_random_uuid(),
  version_id          uuid not null references smartgov.proposal_versions (id) on delete cascade,
  requirement_item_id uuid not null references smartgov.requirement_items (id) on delete cascade,
  submission_kind     text not null check (submission_kind in ('file','link')),
  storage_path        text,
  original_name       text,
  mime_type           text,
  size_bytes          bigint,
  link_url            text,
  submitted_at        timestamptz not null default now(),
  check (
    (submission_kind = 'file'  and storage_path is not null and link_url is null)
    or (submission_kind = 'link' and link_url is not null and storage_path is null)
  )
);

create table if not exists smartgov.reviews (
  id         uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references smartgov.proposals (id) on delete cascade,
  version_id uuid not null references smartgov.proposal_versions (id) on delete cascade,
  decided_by uuid not null references smartgov.accounts (id),
  decision   text not null check (decision in ('approved','returned','rejected')),
  remark     text,
  created_at timestamptz not null default now(),
  unique (proposal_id, version_id)
);

alter table smartgov.programs          enable row level security;
alter table smartgov.requirement_items enable row level security;
alter table smartgov.proposals         enable row level security;
alter table smartgov.proposal_versions enable row level security;
alter table smartgov.item_submissions  enable row level security;
alter table smartgov.reviews           enable row level security;

revoke all on all tables in schema smartgov from anon, authenticated;

-- --------------------------------------------------------------- storage

-- Private bucket for proposal documents. `file_size_limit` enforces the 10 MiB
-- cap at the storage layer even if the server minted a bad URL; `allowed_mime_types`
-- doubles the extension gate. `on conflict do nothing` keeps this idempotent for
-- `supabase db push` and for operators who created the bucket in the dashboard.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types, avif_autodetection)
values (
  'proposal-documents',
  'proposal-documents',
  false,
  10485760,
  '{application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/zip}',
  false
)
on conflict (id) do nothing;

-- Belt and suspenders: even if a later policy is added to the storage schema,
-- the browser-facing roles have no privileges here to begin with. The service
-- client (used only on the server) is unaffected.
revoke all on table storage.objects from anon, authenticated;

-- --------------------------------------------------------------- helpers

-- The units an account is an active member of, org-scoped. This is the LSG
-- scope: proposal reads and writes for invited officers are bounded by it in
-- SQL, never in TypeScript.
create or replace function smartgov.lsg_unit_ids(p_account uuid, p_organization uuid)
returns setof uuid
language sql stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select m.unit_id
    from smartgov.roster r
    join smartgov.unit_memberships m
      on m.roster_id = r.id
     and m.end_date is null
   where r.account_id = p_account
     and r.organization_id = p_organization;
$$;

revoke all on function smartgov.lsg_unit_ids(uuid, uuid) from public;

-- Whether an account is a USG reviewer: the owner, or an invited officer
-- holding a current seat in the org's top (unit_type = 'usg') unit â€” the USG
-- board. LSG officers sit in descendant units, so they never pass this.
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
       and u.unit_type = 'usg'
  );
$$;

revoke all on function smartgov.is_org_reviewer(uuid, uuid) from public;

-- Convenience RPC for the dashboard shell: "is my account a reviewer", so the
-- USG shell (review inbox) is shown to the board as well as the owner.
create or replace function smartgov.am_i_reviewer(p_session_token text)
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
    'reviewer', v_account.account_scope = 'owner'
             or smartgov.is_org_reviewer(v_account.id, v_account.organization_id)
  );
end;
$$;

revoke all on function smartgov.am_i_reviewer(text) from public;

-- ------------------------------------------------- programs: create & reads

-- jsonb has no `::text[]` cast on every supported Postgres (42846 on recent
-- servers), so template writers fold allowed_extensions through this helper:
-- an empty array aggregates to NULL and the coalesce turns that into '{}',
-- the same empty text[] a fresh template is created with.
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

create or replace function smartgov.create_program(
  p_session_token text,
  p_name          text,
  p_description   text,
  p_icon          text,
  p_items         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account    smartgov.accounts%rowtype;
  v_program_id uuid;
  v_label      text;
  v_kind       text;
  v_i          int;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if length(btrim(p_name)) < 4 or length(btrim(p_name)) > 140
     or p_icon not in ('sports','culture','academic','community','wellness','special')
     or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if not smartgov.consume_rate_limit(
       'program:create:' || v_account.id::text, 20, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  -- Validate the whole template before any write so a bad item cannot leave a
  -- half-created program behind.
  for v_i in 0 .. jsonb_array_length(p_items) - 1 loop
    v_label := btrim(p_items->v_i->>'label');
    v_kind  := p_items->v_i->>'item_kind';
    if length(v_label) < 2 or length(v_label) > 140
       or v_kind not in ('file','link')
       or (v_kind = 'file' and jsonb_array_length(coalesce(p_items->v_i->'allowed_extensions', jsonb '[]')) < 1) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_request');
    end if;
  end loop;

  insert into smartgov.programs (
    organization_id, created_by, name, description, icon, status
  ) values (
    v_account.organization_id, v_account.id, btrim(p_name),
    btrim(coalesce(p_description, '')), p_icon, 'published'
  ) returning id into v_program_id;

  for v_i in 0 .. jsonb_array_length(p_items) - 1 loop
    insert into smartgov.requirement_items (
      organization_id, program_id, label, item_kind, allowed_extensions, position
    ) values (
      v_account.organization_id, v_program_id,
      btrim(p_items->v_i->>'label'),
      p_items->v_i->>'item_kind',
      smartgov.jsonb_text_array(coalesce(p_items->v_i->'allowed_extensions', jsonb '[]')),
      coalesce((p_items->v_i->>'position')::int, v_i)
    );
  end loop;

  return jsonb_build_object('ok', true, 'programId', v_program_id, 'name', btrim(p_name));
end;
$$;

revoke all on function smartgov.create_program(text, text, text, text, jsonb) from public;

create or replace function smartgov.list_programs(p_session_token text)
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

  -- `organizationId` rides along so the /api/uploads presign route can mint
  -- storage paths under the caller's own org folder without a second query.
  return jsonb_build_object(
    'ok', true,
    'organizationId', v_account.organization_id,
    'programs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pr.id,
        'name', pr.name,
        'description', pr.description,
        'icon', pr.icon,
        'status', pr.status,
        'createdAt', pr.created_at,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', ri.id,
            'label', ri.label,
            'itemKind', ri.item_kind,
            'allowedExtensions', ri.allowed_extensions,
            'position', ri.position
          ) order by ri.position)
          from smartgov.requirement_items ri
          where ri.program_id = pr.id
        ), jsonb '[]')
      ) order by pr.created_at desc)
      from smartgov.programs pr
      where pr.organization_id = v_account.organization_id
        and (v_account.account_scope = 'owner' or pr.status = 'published')
    ), jsonb '[]')
  );
end;
$$;

revoke all on function smartgov.list_programs(text) from public;

-- The standalone default template (the item set an unattached activity proposal
-- must satisfy). Both the owner (editing it) and invited officers (drafting
-- against it) need this.
create or replace function smartgov.list_default_requirements(p_session_token text)
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
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ri.id,
        'label', ri.label,
        'itemKind', ri.item_kind,
        'allowedExtensions', ri.allowed_extensions,
        'position', ri.position
      ) order by ri.position)
      from smartgov.requirement_items ri
      where ri.program_id is null
        and ri.organization_id = v_account.organization_id
    ), jsonb '[]')
  );
end;
$$;

revoke all on function smartgov.list_default_requirements(text) from public;

create or replace function smartgov.set_default_requirements(
  p_session_token text,
  p_items         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_label   text;
  v_kind    text;
  v_i       int;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if not smartgov.consume_rate_limit(
       'requirements:set:' || v_account.id::text, 20, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  for v_i in 0 .. jsonb_array_length(p_items) - 1 loop
    v_label := btrim(p_items->v_i->>'label');
    v_kind  := p_items->v_i->>'item_kind';
    if length(v_label) < 2 or length(v_label) > 140
       or v_kind not in ('file','link')
       or (v_kind = 'file' and jsonb_array_length(coalesce(p_items->v_i->'allowed_extensions', jsonb '[]')) < 1) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_request');
    end if;
  end loop;

  -- Replace semantics for the org's own default template. Design decision: a
  -- template may not be edited after submissions exist, so drop + recreate is
  -- the sanctioned edit path and the cascade cleans up after it.
  delete from smartgov.requirement_items
   where program_id is null
     and organization_id = v_account.organization_id;

  for v_i in 0 .. jsonb_array_length(p_items) - 1 loop
    insert into smartgov.requirement_items (
      organization_id, program_id, label, item_kind, allowed_extensions, position
    ) values (
      v_account.organization_id, null,
      btrim(p_items->v_i->>'label'),
      p_items->v_i->>'item_kind',
      smartgov.jsonb_text_array(coalesce(p_items->v_i->'allowed_extensions', jsonb '[]')),
      coalesce((p_items->v_i->>'position')::int, v_i)
    );
  end loop;

  return jsonb_build_object('ok', true, 'count', jsonb_array_length(p_items));
end;
$$;

revoke all on function smartgov.set_default_requirements(text, jsonb) from public;

-- Scoped resolution of a single requirement item, for the upload presign gate.
-- Cross-org ids and (for invited officers) items on non-published programs
-- answer not_found, so the presign route can mint a URL only for a template the
-- caller is genuinely allowed to submit against.
create or replace function smartgov.match_requirement_item(
  p_session_token text,
  p_item_id       uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_item    smartgov.requirement_items%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select ri.id, ri.organization_id, ri.program_id, ri.label, ri.item_kind,
         ri.allowed_extensions, ri.position
    into v_item.id, v_item.organization_id, v_item.program_id, v_item.label,
         v_item.item_kind, v_item.allowed_extensions, v_item.position
    from smartgov.requirement_items ri
   where ri.id = p_item_id
     and ri.organization_id = v_account.organization_id
     and (
       v_account.account_scope = 'owner'
       or smartgov.is_org_reviewer(v_account.id, v_account.organization_id)
       or ri.program_id is null
       or exists (
         select 1 from smartgov.programs pr
          where pr.id = ri.program_id
            and pr.organization_id = v_account.organization_id
            and pr.status = 'published'
       )
     );

  if v_item.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'item', jsonb_build_object(
      'id', v_item.id,
      'label', v_item.label,
      'itemKind', v_item.item_kind,
      'allowedExtensions', v_item.allowed_extensions,
      'programId', v_item.program_id
    )
  );
end;
$$;

revoke all on function smartgov.match_requirement_item(text, uuid) from public;

-- ----------------------------------------------------------- proposal flow

-- Shared per-item validation used verbatim by create_proposal and submit_revision.
-- `p_items` entries: {"requirement_item_id": uuid, "kind": "file"|"link",
-- "storagePath", "originalName", "mimeType", "sizeBytes"} (file) or
-- {"requirement_item_id": uuid, "kind": "link", "linkUrl"} (link).
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
      -- The path must be the exact shape the presign route mints:
      -- <org>/proposals/<uuid>/v<N>/<item>/<name>. Comparing against the
      -- capture is also a NULL guard: if the pattern is absent the capture is
      -- null, the whole comparison collapses to NULL, and a NULL condition skips
      -- the reject -- so the capture is tested for null first.
      v_frag := substring(v_path from 'proposals/([^/]+)/');
      if v_frag is null
         or v_path <> p_account.organization_id::text || '/proposals/'
              || v_frag || '/v' || p_version || '/'
              || v_tid || '/' || v_name then
        return jsonb_build_object('ok', false, 'reason', 'invalid_request');
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

revoke all on function smartgov.proposal_items_valid(
  smartgov.accounts, jsonb, jsonb, int) from public;

create or replace function smartgov.create_proposal(
  p_session_token text,
  p_program_id    uuid,
  p_title         text,
  p_description   text,
  p_activity_type text,
  p_event_date    date,
  p_venue         text,
  p_unit_id       uuid,
  p_items         jsonb,
  p_note          text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account      smartgov.accounts%rowtype;
  v_author_kind  text;
  v_status       text;
  v_prog_status  text;
  v_template     jsonb;
  v_check        jsonb;
  v_proposal_id  uuid;
  v_version_id   uuid;
  v_unit_id      uuid;
  v_i            int;
  v_tid          uuid;
  v_entry        jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if length(btrim(p_title)) < 4 or length(btrim(p_title)) > 140
     or p_activity_type not in ('sports','culture','academic','community','wellness','special')
     or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if not smartgov.consume_rate_limit(
       'proposal:create:' || v_account.id::text, 20, interval '5 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  if v_account.account_scope = 'owner' then
    v_author_kind := 'usg';
    v_status      := 'published';
    v_unit_id     := null;
  else
    v_author_kind := 'lsg';
    v_status      := 'submitted';
    if not exists (
      select 1 from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u
       where u = p_unit_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'not_in_unit');
    end if;
    v_unit_id := p_unit_id;
  end if;

  -- Resolve and lock the template.
  if p_program_id is not null then
    select pr.status into v_prog_status
      from smartgov.programs pr
     where pr.id = p_program_id
       and pr.organization_id = v_account.organization_id
     for update;

    if v_prog_status is null then
      return jsonb_build_object('ok', false, 'reason', 'no_program');
    end if;

    if v_account.account_scope <> 'owner' and v_prog_status <> 'published' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_request');
    end if;

    select jsonb_agg(jsonb_build_object(
      'id', ri.id, 'itemKind', ri.item_kind,
      'allowedExtensions', ri.allowed_extensions, 'position', ri.position)
      order by ri.position)
      into v_template
      from smartgov.requirement_items ri
     where ri.program_id = p_program_id;
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

  v_check := smartgov.proposal_items_valid(v_account, v_template, p_items, 1);
  if not (v_check->>'ok')::boolean then
    return v_check;
  end if;

  insert into smartgov.proposals (
    organization_id, program_id, unit_id, author_kind, created_by,
    title, description, activity_type, event_date, venue, status
  ) values (
    v_account.organization_id, p_program_id, v_unit_id, v_author_kind, v_account.id,
    btrim(p_title), btrim(coalesce(p_description, '')), p_activity_type,
    p_event_date, btrim(coalesce(p_venue, '')), v_status
  ) returning id into v_proposal_id;

  insert into smartgov.proposal_versions (
    proposal_id, version_number, submitted_by, submission_note
  ) values (
    v_proposal_id, 1, v_account.id, btrim(coalesce(p_note, ''))
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

  return jsonb_build_object(
    'ok', true, 'proposalId', v_proposal_id, 'status', v_status, 'version', 1
  );
end;
$$;

revoke all on function smartgov.create_proposal(
  text, uuid, text, text, text, date, text, uuid, jsonb, text) from public;

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

create or replace function smartgov.list_proposals(p_session_token text)
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
    'proposals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'title', p.title,
        'status', p.status,
        'authorKind', p.author_kind,
        'activityType', p.activity_type,
        'eventDate', p.event_date,
        'createdAt', p.created_at,
        'programName', (select pr.name from smartgov.programs pr where pr.id = p.program_id),
        'unitName', (select u.name from public.governance_units u where u.id = p.unit_id),
        'version', v.maxver,
        'latestDecision', rv.decision,
        'latestRemark', rv.remark
      ) order by p.created_at desc)
      from smartgov.proposals p
      join lateral (
        select max(pv.version_number) as maxver
          from smartgov.proposal_versions pv
         where pv.proposal_id = p.id
      ) v on true
      left join lateral (
        select rev.decision, rev.remark
          from smartgov.reviews rev
          join smartgov.proposal_versions pv2
            on pv2.id = rev.version_id
         where pv2.proposal_id = p.id
           and pv2.version_number = v.maxver
      ) rv on true
      where p.organization_id = v_account.organization_id
        and (
          v_account.account_scope = 'owner'
          or smartgov.is_org_reviewer(v_account.id, v_account.organization_id)
          or p.created_by = v_account.id
          or (p.unit_id is not null and p.unit_id in (
                select u from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u
              ))
        )
    ), jsonb '[]')
  );
end;
$$;

revoke all on function smartgov.list_proposals(text) from public;

create or replace function smartgov.proposal_detail(
  p_session_token text,
  p_proposal_id   uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_proposal smartgov.proposals%rowtype;
  v_ok boolean;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select pr.id, pr.organization_id, pr.program_id, pr.unit_id, pr.author_kind,
         pr.created_by, pr.title, pr.description, pr.activity_type,
         pr.event_date, pr.venue, pr.status, pr.created_at
    into v_proposal
    from smartgov.proposals pr
   where pr.id = p_proposal_id
     and pr.organization_id = v_account.organization_id;

  if v_proposal.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_proposal');
  end if;

  v_ok := v_account.account_scope = 'owner'
       or smartgov.is_org_reviewer(v_account.id, v_account.organization_id)
       or v_proposal.created_by = v_account.id
       or (v_proposal.unit_id is not null and v_proposal.unit_id in (
             select u from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u
           ));

  if not v_ok then
    -- Foreign scope is indistinguishable from a missing row.
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'proposal', jsonb_build_object(
      'id', v_proposal.id,
      'title', v_proposal.title,
      'description', v_proposal.description,
      'status', v_proposal.status,
      'authorKind', v_proposal.author_kind,
      'activityType', v_proposal.activity_type,
      'eventDate', v_proposal.event_date,
      'venue', v_proposal.venue,
      'createdAt', v_proposal.created_at,
      'programId', v_proposal.program_id,
      'programName', (select pr.name from smartgov.programs pr where pr.id = v_proposal.program_id),
      'unitId', v_proposal.unit_id,
      'unitName', (select u.name from public.governance_units u where u.id = v_proposal.unit_id),
      'versions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', pv.id,
          'versionNumber', pv.version_number,
          'submittedBy', (select a.display_name from smartgov.accounts a where a.id = pv.submitted_by),
          'submissionNote', pv.submission_note,
          'submittedAt', pv.submitted_at,
          'items', coalesce((
            select jsonb_agg(jsonb_build_object(
              'itemId', isub.requirement_item_id,
              'label', (select ri.label from smartgov.requirement_items ri where ri.id = isub.requirement_item_id),
              'itemKind', (select ri.item_kind from smartgov.requirement_items ri where ri.id = isub.requirement_item_id),
              'submissionKind', isub.submission_kind,
              'storagePath', isub.storage_path,
              'originalName', isub.original_name,
              'mimeType', isub.mime_type,
              'sizeBytes', isub.size_bytes,
              'linkUrl', isub.link_url
            ))
            from smartgov.item_submissions isub
            where isub.version_id = pv.id
          ), jsonb '[]')
        ) order by pv.version_number desc)
        from smartgov.proposal_versions pv
        where pv.proposal_id = v_proposal.id
      ), jsonb '[]'),
      'reviews', coalesce((
        select jsonb_agg(jsonb_build_object(
          'versionNumber', pv2.version_number,
          'decision', rev.decision,
          'remark', rev.remark,
          'decidedBy', (select a2.display_name from smartgov.accounts a2 where a2.id = rev.decided_by),
          'createdAt', rev.created_at
        ) order by rev.created_at desc)
        from smartgov.reviews rev
        join smartgov.proposal_versions pv2 on pv2.id = rev.version_id
        where rev.proposal_id = v_proposal.id
      ), jsonb '[]')
    )
  );
end;
$$;

revoke all on function smartgov.proposal_detail(text, uuid) from public;

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

  -- The owner and the USG board (is_org_reviewer) review; nobody else.
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

create or replace function smartgov.get_item_file(
  p_session_token  text,
  p_submission_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_path text;
  v_name text;
  v_mime text;
  v_size bigint;
  v_owner uuid;
  v_author uuid;
  v_unit  uuid;
  v_kind  text;
  v_scope boolean := false;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select isub.storage_path, isub.original_name, isub.mime_type, isub.size_bytes,
         p.created_by, p.unit_id, p.author_kind
    into v_path, v_name, v_mime, v_size, v_author, v_unit, v_kind
    from smartgov.item_submissions isub
    join smartgov.proposal_versions pv on pv.id = isub.version_id
    join smartgov.proposals p on p.id = pv.proposal_id
   where isub.id = p_submission_id
     and p.organization_id = v_account.organization_id;

  if v_path is null then
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
    'storagePath', v_path,
    'originalName', v_name,
    'mimeType', v_mime,
    'sizeBytes', v_size
  );
end;
$$;

revoke all on function smartgov.get_item_file(text, uuid) from public;

-- ------------------------------------------------------ PostgREST surface

-- Thin `security definer` forwarders so the browser-facing roles can only hit
-- the pinned entry points above, one per RPC, and nothing else in smartgov.

create or replace function public.create_program(p_session_token text, p_name text, p_description text, p_icon text, p_items jsonb)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.create_program(p_session_token, p_name, p_description, p_icon, p_items); $$;
revoke all on function public.create_program(text, text, text, text, jsonb) from public;
grant execute on function public.create_program(text, text, text, text, jsonb) to anon, authenticated;

create or replace function public.list_programs(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_programs(p_session_token); $$;
revoke all on function public.list_programs(text) from public;
grant execute on function public.list_programs(text) to anon, authenticated;

create or replace function public.list_default_requirements(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_default_requirements(p_session_token); $$;
revoke all on function public.list_default_requirements(text) from public;
grant execute on function public.list_default_requirements(text) to anon, authenticated;

create or replace function public.set_default_requirements(p_session_token text, p_items jsonb)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.set_default_requirements(p_session_token, p_items); $$;
revoke all on function public.set_default_requirements(text, jsonb) from public;
grant execute on function public.set_default_requirements(text, jsonb) to anon, authenticated;

create or replace function public.match_requirement_item(p_session_token text, p_item_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.match_requirement_item(p_session_token, p_item_id); $$;
revoke all on function public.match_requirement_item(text, uuid) from public;
grant execute on function public.match_requirement_item(text, uuid) to anon, authenticated;

create or replace function public.create_proposal(p_session_token text, p_program_id uuid, p_title text, p_description text, p_activity_type text, p_event_date date, p_venue text, p_unit_id uuid, p_items jsonb, p_note text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.create_proposal(p_session_token, p_program_id, p_title, p_description, p_activity_type, p_event_date, p_venue, p_unit_id, p_items, p_note); $$;
revoke all on function public.create_proposal(text, uuid, text, text, text, date, text, uuid, jsonb, text) from public;
grant execute on function public.create_proposal(text, uuid, text, text, text, date, text, uuid, jsonb, text) to anon, authenticated;

create or replace function public.submit_revision(p_session_token text, p_proposal_id uuid, p_items jsonb, p_note text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.submit_revision(p_session_token, p_proposal_id, p_items, p_note); $$;
revoke all on function public.submit_revision(text, uuid, jsonb, text) from public;
grant execute on function public.submit_revision(text, uuid, jsonb, text) to anon, authenticated;

create or replace function public.list_proposals(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_proposals(p_session_token); $$;
revoke all on function public.list_proposals(text) from public;
grant execute on function public.list_proposals(text) to anon, authenticated;

create or replace function public.proposal_detail(p_session_token text, p_proposal_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.proposal_detail(p_session_token, p_proposal_id); $$;
revoke all on function public.proposal_detail(text, uuid) from public;
grant execute on function public.proposal_detail(text, uuid) to anon, authenticated;

create or replace function public.review_proposal(p_session_token text, p_proposal_id uuid, p_decision text, p_remark text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.review_proposal(p_session_token, p_proposal_id, p_decision, p_remark); $$;
revoke all on function public.review_proposal(text, uuid, text, text) from public;
grant execute on function public.review_proposal(text, uuid, text, text) to anon, authenticated;

create or replace function public.get_item_file(p_session_token text, p_submission_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.get_item_file(p_session_token, p_submission_id); $$;
revoke all on function public.get_item_file(text, uuid) from public;
grant execute on function public.get_item_file(text, uuid) to anon, authenticated;

create or replace function public.am_i_reviewer(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.am_i_reviewer(p_session_token); $$;
revoke all on function public.am_i_reviewer(text) from public;
grant execute on function public.am_i_reviewer(text) to anon, authenticated;
