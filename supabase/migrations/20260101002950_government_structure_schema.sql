-- Government structure: the schema a council's own structure lives in.
--
-- Why the structure is a document and not a set of rows
-- ---------------------------------------------------
-- The brief asks an LSG to *build* its structure and a USG to *approve* it before
-- it takes effect. That rules out writing committees straight into
-- `governance_units`: a half-built chart would be a live chart, and a rejected
-- structure would have to be un-built row by row with no record of what it used
-- to say.
--
-- So a structure is an immutable-ish jsonb `document` plus a term, and it only
-- becomes a chart at the moment of approval, in SQL, inside one transaction
-- (02960). The live chart therefore never contains an unapproved structure, and
-- every approved structure stays readable afterwards as the historical record of
-- what that council's government looked like for that term -- the same reason
-- `unit_memberships` is dated rather than overwritten in 00600.
--
-- What a `document` holds
-- -----------------------
--   { "committees": [
--       { "key": "executive", "isUnit": true, "name": "...",
--         "description": "...",
--         "positions": [ { "key": "president", "title": "President",
--                           "holder": { ...person fields... } } ] } ] }
--
-- `key` is a stable client-generated slug that survives renames and reorders, so
-- the drag-and-drop builder can reorder and retitle without losing who sits
-- where. It is also what lands in `governance_units.structure_key`, which is how
-- re-approving a structure recognises a renamed committee as the same committee.
--
-- `isUnit: true` marks the one committee whose seats belong to the unit the
-- structure is *for* rather than to a child of it -- a council's own board is the
-- council, not a committee inside it. Without it, approving a USG structure would
-- move the USG board's seats onto a child unit and leave the USG unit itself
-- empty, which would break every existing read that expects the owner to be seated
-- in the `usg` unit. At most one committee may carry it, and it must be first.
--
-- `holder` is optional -- a seat may be vacant, which is the normal state of a
-- council mid-recruitment.
--
-- Posture: identical to every other table here. RLS on, zero policies, revoked
-- from `anon` and `authenticated`, reachable only through the `security definer`
-- functions in 02960 and their `public` forwarders in 02970.

-- ------------------------------------------------------------- committee keys

-- A structure's committees become rows in `governance_units`, so the document's
-- stable `key` needs somewhere to land. Without it, re-approving a renamed
-- committee would have to guess whether "Welfare Committee" and "Welfare and
-- Outreach Committee" are the same row, and a rename would silently orphan every
-- seat inside it.
--
-- Nullable, because only committees that came out of a structure carry one --
-- colleges, campuses and LSGs are declared at organization creation and have no
-- key. The partial unique index is what makes approval idempotent: re-approving a
-- structure with one changed seat reuses its committee rows instead of creating
-- a second copy of every committee.
alter table public.governance_units
  add column if not exists structure_key text
  check (structure_key is null or length(btrim(structure_key)) between 1 and 60);

create unique index if not exists governance_units_one_structure_key
  on public.governance_units (organization_id, parent_id, structure_key)
  where structure_key is not null;

-- ------------------------------------------------------------ member details

-- The brief asks a member record to carry last name, first name, middle
-- name/initial, birthdate, photo, course, level, gender, contact number, email and
-- address. `full_name` is kept and stays `not null` because 00600's invites, the
-- chart, and the roster picker all already read it, and rewriting those to
-- concatenate four nullable columns would be a downgrade for the rows that have
-- never had a structured name. The structured columns are the record; `full_name`
-- is derived from them by 02960 whenever a structure supplies the parts, and left
-- alone otherwise.
--
-- `photo_oid` points at a large object rather than storing bytes inline, for the
-- same reason 02700 stores documents there: a 512 KiB base64 blob would bloat
-- every roster row, every chart read and every backup dump. 02960 accepts the
-- bytes as base64 on the way in and never returns them in a list read.
alter table smartgov.roster
  add column if not exists last_name       text,
  add column if not exists first_name      text,
  add column if not exists middle_name     text,
  add column if not exists birthdate       date,
  add column if not exists course          text,
  add column if not exists year_level      text,
  add column if not exists gender          text,
  add column if not exists contact_number  text,
  add column if not exists address         text,
  add column if not exists photo_oid       oid,
  add column if not exists photo_mime      text,
  add column if not exists photo_bytes     int;

-- A closed vocabulary for gender, chosen so "prefer not to say" is a stored
-- answer rather than a NULL the UI has to special-case. Nullable: a seat filled
-- through the 00900 invite path has no gender yet, and that must not be a
-- constraint violation.
do $$ begin
  alter table smartgov.roster
    add constraint roster_gender_known
    check (gender is null or gender in (
      'female', 'male', 'other', 'prefer_not_to_say'
    ));
exception when duplicate_object then null; end $$;

-- Length ceilings rather than a regex for the free-text parts. A name longer than
-- 80 characters is a paste accident, and the columns are rendered into cards;
-- letting an unbounded string through would let one row decide the layout of
-- every roster page behind it.
do $$ begin
  alter table smartgov.roster
    add constraint roster_detail_lengths check (
      (last_name      is null or length(btrim(last_name))      between 1 and 80) and
      (first_name     is null or length(btrim(first_name))     between 1 and 80) and
      (middle_name    is null or length(btrim(middle_name))    between 1 and 80) and
      (course         is null or length(btrim(course))         between 1 and 160) and
      (year_level     is null or length(btrim(year_level))     between 1 and 60) and
      (contact_number is null or length(btrim(contact_number)) between 4 and 40) and
      (address        is null or length(btrim(address))        between 1 and 240)
    );
exception when duplicate_object then null; end $$;

-- A photo is a face, not a file: 512 KiB covers a phone photo at sane
-- compression and refuses a screenshot-of-a-PDF. `lo_from_bytea` in 02960 is the
-- only writer, so the two size columns can only disagree if someone reaches the
-- table another way -- which RLS and the revoked grants make impossible.
do $$ begin
  alter table smartgov.roster
    add constraint roster_photo_size check (
      photo_bytes is null or (photo_bytes > 0 and photo_bytes <= 524288)
    );
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------- templates

-- Curated blueprints. `organization_id is null` marks a built-in that every
-- organization sees; a non-null one is that organization's own saved template.
--
-- Deliberately no third-party template provider is wired in. A structure template
-- is a static committee/position outline, so a hosted catalogue would add an
-- availability dependency to a government-registration path and an outbound
-- request from a context that handles personal data, in exchange for a list that
-- changes rarely. Curated built-ins plus "save this structure as a template" give
-- the same result with no third party in the path; an organization can import a
-- template it obtained elsewhere by pasting the JSON, which 02960 validates with
-- the same validator the builder uses.
create table if not exists smartgov.gov_structure_templates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  key             text not null check (length(btrim(key)) between 2 and 60),
  name            text not null check (length(btrim(name)) between 2 and 80),
  description     text not null default '',
  category        text not null default 'general'
                  check (category in ('general','academic','org','athletic','media','service','custom')),
  document        jsonb not null check (jsonb_typeof(document) = 'object'),
  is_builtin      boolean not null default false,
  created_by      uuid references smartgov.accounts (id) on delete set null,
  created_at      timestamptz not null default now()
);

-- One template per key per organization, and one per key across the built-ins.
-- An expression index because a table-level `unique` cannot take one, and without
-- it the same key could be seeded twice by a re-run and appear twice in the
-- gallery.
create unique index if not exists gov_structure_templates_one_key_per_scope
  on smartgov.gov_structure_templates (
    coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(key)
  );

-- ------------------------------------------------------------ structures

create table if not exists smartgov.gov_structures (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  unit_id         uuid not null references public.governance_units (id) on delete cascade,
  author_kind     text not null check (author_kind in ('lsg','usg')),
  created_by      uuid not null references smartgov.accounts (id),
  template_key    text,
  term_label      text not null check (length(btrim(term_label)) between 1 and 80),
  starts_on       date not null,
  ends_on         date not null,
  status          text not null default 'draft'
                  check (status in ('draft','submitted','approved','returned','rejected','superseded')),
  revision        int not null default 1 check (revision >= 1),
  document        jsonb not null check (jsonb_typeof(document) = 'object'),
  note            text,
  submitted_by    uuid references smartgov.accounts (id) on delete set null,
  submitted_at    timestamptz,
  decided_by      uuid references smartgov.accounts (id) on delete set null,
  decided_at      timestamptz,
  decision_remark text,
  -- Set when this structure was created by the dashboard's Renew action. The
  -- self-reference is what makes "this council's 2nd term" a fact in the schema
  -- rather than something the UI infers from dates.
  renews_id       uuid references smartgov.gov_structures (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (ends_on > starts_on)
);

create index if not exists gov_structures_unit_idx
  on smartgov.gov_structures (unit_id, status);

create index if not exists gov_structures_org_status_idx
  on smartgov.gov_structures (organization_id, status, submitted_at desc nulls last);

-- One council cannot have two government structures in force. This is the
-- invariant that makes "the approved structure" a single row rather than a
-- query, so the chart, the dashboard and the approval queue cannot disagree
-- about which one is live.
create unique index if not exists gov_structures_one_approved_per_unit
  on smartgov.gov_structures (unit_id)
  where status = 'approved';

-- One thing in flight at a time per unit: a draft being edited, a draft waiting
-- on the USG, and a draft that came back for edits are all the same slot.
-- Without this an officer could open three drafts, edit the oldest, submit it,
-- and the USG would be looking at a document nobody current is working on.
create unique index if not exists gov_structures_one_open_per_unit
  on smartgov.gov_structures (unit_id)
  where status in ('draft','submitted','returned');

-- ------------------------------------------------------------ reviews

-- A structure can be submitted, returned, resubmitted and approved; keeping only
-- the last decision on the structure row would erase that. One row per revision,
-- which is also what stops the same revision being approved twice.
create table if not exists smartgov.gov_structure_reviews (
  id           uuid primary key default gen_random_uuid(),
  structure_id uuid not null references smartgov.gov_structures (id) on delete cascade,
  revision     int not null check (revision >= 1),
  decision     text not null check (decision in ('approved','returned','rejected')),
  remark       text,
  decided_by   uuid not null references smartgov.accounts (id),
  created_at   timestamptz not null default now(),
  unique (structure_id, revision)
);

create index if not exists gov_structure_reviews_queue_idx
  on smartgov.gov_structure_reviews (created_at desc);

-- ------------------------------------------------------------ RLS

alter table smartgov.gov_structures        enable row level security;
alter table smartgov.gov_structure_templates enable row level security;
alter table smartgov.gov_structure_reviews enable row level security;

revoke all on smartgov.gov_structures        from anon, authenticated;
revoke all on smartgov.gov_structure_templates from anon, authenticated;
revoke all on smartgov.gov_structure_reviews from anon, authenticated;

-- --------------------------------------------------------- template seed

-- Built-in blueprints. Seats only: a template that shipped a name in it would
-- ship one council's officers to every council that opens the gallery, so the
-- `holder` key is absent throughout and 02960 rejects a template that has one.
insert into smartgov.gov_structure_templates
  (key, name, description, category, document, is_builtin)
values
  ('blank', 'Start from scratch', 'An empty structure with a single board. Add committees and seats yourself.', 'custom',
   '{"committees":[{"key":"board","isUnit":true,"name":"Board","description":"","positions":[{"key":"seat-1","title":"President"},{"key":"seat-2","title":"Vice President"}]}]}'::jsonb, true),

  ('standard-council', 'Standard Council', 'The common seven-officer council: the default most student governments start from.', 'general',
   '{"committees":[{"key":"board","isUnit":true,"name":"Board of Officers","description":"","positions":[{"key":"president","title":"President"},{"key":"vice-president","title":"Vice President"},{"key":"secretary","title":"Secretary"},{"key":"treasurer","title":"Treasurer"},{"key":"auditor","title":"Auditor"},{"key":"pio","title":"Public Information Officer"},{"key":"sergeant-at-arms","title":"Sergeant-at-Arms"}]}]}'::jsonb, true),

  ('minimal-council', 'Minimal Council', 'Three officers. Right for a small programme or an early-term council.', 'general',
   '{"committees":[{"key":"board","isUnit":true,"name":"Board of Officers","description":"","positions":[{"key":"president","title":"President"},{"key":"secretary","title":"Secretary"},{"key":"treasurer","title":"Treasurer"}]}]}'::jsonb, true),

  ('executive-cabinet', 'Executive Cabinet', 'A president-led cabinet with a separate executive secretary and legal officer.', 'org',
   '{"committees":[{"key":"cabinet","isUnit":true,"name":"Executive Cabinet","description":"","positions":[{"key":"president","title":"President"},{"key":"vice-president","title":"Vice President"},{"key":"executive-secretary","title":"Executive Secretary"},{"key":"legal-officer","title":"Legal Officer"},{"key":"treasurer","title":"Treasurer"},{"key":"auditor","title":"Auditor"},{"key":"pio","title":"Public Information Officer"}]},{"key":"services","name":"Services Committee","description":"","positions":[{"key":"chairperson","title":"Chairperson"},{"key":"co-chairperson","title":"Co-Chairperson"},{"key":"member-1","title":"Committee Member"},{"key":"member-2","title":"Committee Member"}]}]}'::jsonb, true),

  ('committee-heavy', 'Committee-Based Government', 'A small board with six working committees underneath. Committees can be renamed or removed.', 'service',
   '{"committees":[{"key":"board","isUnit":true,"name":"Board of Officers","description":"","positions":[{"key":"president","title":"President"},{"key":"vice-president","title":"Vice President"},{"key":"secretary","title":"Secretary"},{"key":"treasurer","title":"Treasurer"}]},{"key":"finance","name":"Finance Committee","description":"","positions":[{"key":"chairperson","title":"Chairperson"},{"key":"co-chairperson","title":"Co-Chairperson"},{"key":"member-1","title":"Committee Member"}]},{"key":"audit","name":"Audit Committee","description":"","positions":[{"key":"chairperson","title":"Chairperson"},{"key":"member-1","title":"Committee Member"},{"key":"member-2","title":"Committee Member"}]},{"key":"communications","name":"Communications Committee","description":"","positions":[{"key":"chairperson","title":"Chairperson"},{"key":"member-1","title":"Committee Member"},{"key":"member-2","title":"Committee Member"}]},{"key":"public-affairs","name":"Public Affairs Committee","description":"","positions":[{"key":"chairperson","title":"Chairperson"},{"key":"co-chairperson","title":"Co-Chairperson"},{"key":"member-1","title":"Committee Member"}]},{"key":"welfare","name":"Welfare Committee","description":"","positions":[{"key":"chairperson","title":"Chairperson"},{"key":"member-1","title":"Committee Member"},{"key":"member-2","title":"Committee Member"},{"key":"member-3","title":"Committee Member"}]}]}'::jsonb, true),

  ('academic-council', 'Academic Council', 'An academic panel with academic, library and research officers added to the standard set.', 'academic',
   '{"committees":[{"key":"board","isUnit":true,"name":"Board of Officers","description":"","positions":[{"key":"president","title":"President"},{"key":"vice-president","title":"Vice President"},{"key":"academic-officer","title":"Academic Officer"},{"key":"secretary","title":"Secretary"},{"key":"treasurer","title":"Treasurer"},{"key":"auditor","title":"Auditor"},{"key":"librarian","title":"Librarian"},{"key":"pio","title":"Public Information Officer"}]},{"key":"research","name":"Research Committee","description":"","positions":[{"key":"chairperson","title":"Chairperson"},{"key":"member-1","title":"Committee Member"},{"key":"member-2","title":"Committee Member"}]}]}'::jsonb, true),

  ('org-team', 'Organization Team', 'A working organisation team: officers plus an executive, membership and property committee.', 'org',
   '{"committees":[{"key":"board","isUnit":true,"name":"Board of Officers","description":"","positions":[{"key":"president","title":"President"},{"key":"vice-president","title":"Vice President"},{"key":"secretary","title":"Secretary"},{"key":"treasurer","title":"Treasurer"},{"key":"business-manager","title":"Business Manager"},{"key":"property-officer","title":"Property Officer"},{"key":"auditor","title":"Auditor"},{"key":"pio","title":"Public Information Officer"}]},{"key":"membership","name":"Membership Committee","description":"","positions":[{"key":"chairperson","title":"Chairperson"},{"key":"co-chairperson","title":"Co-Chairperson"},{"key":"member-1","title":"Committee Member"}]},{"key":"secretariat","name":"Secretariat","description":"","positions":[{"key":"secretary","title":"Committee Secretary"},{"key":"member-1","title":"Committee Member"},{"key":"member-2","title":"Committee Member"}]}]}'::jsonb, true),

  ('media-council', 'Media and Publications Council', 'For a publication or broadcasting unit: an editorial board plus a production crew.', 'media',
   '{"committees":[{"key":"editorial","isUnit":true,"name":"Editorial Board","description":"","positions":[{"key":"editor-in-chief","title":"Editor-in-Chief"},{"key":"managing-editor","title":"Managing Editor"},{"key":"business-manager","title":"Business Manager"},{"key":"treasurer","title":"Treasurer"},{"key":"pio","title":"Public Information Officer"}]},{"key":"production","name":"Production Crew","description":"","positions":[{"key":"head","title":"Production Head"},{"key":"photographer","title":"Photographer"},{"key":"videographer","title":"Videographer"},{"key":"writer","title":"Staff Writer"}]},{"key":"publicity","name":"Publicity Committee","description":"","positions":[{"key":"chairperson","title":"Chairperson"},{"key":"member-1","title":"Committee Member"},{"key":"member-2","title":"Committee Member"}]}]}'::jsonb, true),

  ('athletics-council', 'Athletics Council', 'An athletics unit: an executive set plus a games, training and medical committee.', 'athletic',
   '{"committees":[{"key":"executive","isUnit":true,"name":"Executive Committee","description":"","positions":[{"key":"president","title":"President"},{"key":"vice-president","title":"Vice President"},{"key":"secretary","title":"Secretary"},{"key":"treasurer","title":"Treasurer"},{"key":"pio","title":"Public Information Officer"},{"key":"business-manager","title":"Business Manager"},{"key":"auditor","title":"Auditor"}]},{"key":"games","name":"Games Committee","description":"","positions":[{"key":"chairperson","title":"Chairperson"},{"key":"co-chairperson","title":"Co-Chairperson"},{"key":"member-1","title":"Committee Member"},{"key":"member-2","title":"Committee Member"}]},{"key":"training","name":"Training Committee","description":"","positions":[{"key":"head-coach","title":"Head Coach"},{"key":"assistant-coach","title":"Assistant Coach"},{"key":"trainer","title":"Trainer"}]},{"key":"medical","name":"Medical Committee","description":"","positions":[{"key":"team-physician","title":"Team Physician"},{"key":"masseur","title":"Masseur"},{"key":"first-aide","title":"First Aider"}]}]}'::jsonb, true),

  ('service-council', 'Community Service Council', 'A council organised entirely as service committees, with a coordinating board.', 'service',
   '{"committees":[{"key":"board","isUnit":true,"name":"Coordinating Board","description":"","positions":[{"key":"chairperson","title":"Chairperson"},{"key":"co-chairperson","title":"Co-Chairperson"},{"key":"secretary","title":"Secretary"},{"key":"treasurer","title":"Treasurer"}]},{"key":"outreach","name":"Outreach Committee","description":"","positions":[{"key":"chairperson","title":"Chairperson"},{"key":"member-1","title":"Committee Member"},{"key":"member-2","title":"Committee Member"}]},{"key":"environment","name":"Environment Committee","description":"","positions":[{"key":"chairperson","title":"Chairperson"},{"key":"member-1","title":"Committee Member"},{"key":"member-2","title":"Committee Member"}]},{"key":"health","name":"Health Committee","description":"","positions":[{"key":"chairperson","title":"Chairperson"},{"key":"member-1","title":"Committee Member"},{"key":"member-2","title":"Committee Member"}]},{"key":"education","name":"Education Committee","description":"","positions":[{"key":"chairperson","title":"Chairperson"},{"key":"member-1","title":"Committee Member"},{"key":"member-2","title":"Committee Member"}]}]}'::jsonb, true)
on conflict (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(key))
do update set name = excluded.name,
                description = excluded.description,
                category = excluded.category,
                document = excluded.document
              where gov_structure_templates.is_builtin;

-- The upsert rather than `do nothing` is deliberate: a migration is re-run by
-- hand whenever a built-in blueprint is corrected, and `do nothing` would leave
-- every organization on the version that shipped first. The `is_builtin` guard in
-- the WHERE keeps it from doing that to an organization that saved its own
-- template under a built-in's key.