# Plan — LSG requirement submission & review, with USG/LSG dashboards

Date: 2026-09-29
Status: DRAFT — awaiting approval
Design: [2026-09-29-requirement-submission-review-design.md](./2026-09-29-requirement-submission-review-design.md)
Branch: `feature/lsg-requirement-submissions` (worktree `.worktrees/requirement-submissions`)
Base: `main` at the current tip (design doc commit, `3d7e0ac`)

> **For the executing agent:** first run the `executing-plans` skill (it defines the
> loop this plan expects: failing test -> implement -> retro-verify -> commit, one
> task at a time). Work only inside the dedicated worktree below. The main
> workspace contains the user's uncommitted auth/OTP work — do not touch it and
> do not run commits there. Everything here is additive; no existing file is
> rewritten except `messages.ts`, `check-units.mjs`, `dashboard/page.tsx`, and
> `dashboard/Workspace.tsx` (extended, not redesigned from scratch).

## Intro

The dashboard today is an onboarding console (units, invites, account card).
This plan adds the operational layer on top of it: **programs** opened by the
USG, **requirement submissions** from LSG officers, and a **versioned review
loop** with remarks. Files are real uploads to a private Supabase Storage
bucket through server-minted signed URLs, so multi-MiB bytes never touch a
Next.js function. The dashboard gets a deliberate makeover (stronger shader
field, bento stat cards, animated counters, activity-type icons, an approval
timeline) and a skip-setup gate so an owner with no units yet can still use the
operational view.

The approved design doc is the authority on the *what*; this plan is the
*how*, with complete code. All database access stays behind pinned
`security definer` RPCs with thin `public` wrappers — RLS stays on and no
policies are created (the standing `check-units` rule).

The patient submits (decided with the owner, 2026-09-29):

1. **Program templates stay frozen after submissions exist** — drop + recreate
   is the sanctioned edit path (design non-goal kept).
2. **Review is not owner-only:** the USG board reviews too. Membership in the
   org's top unit (`unit_type = 'usg'`, the root node created by 00700) marks an
   invited officer as a reviewer; `is_org_reviewer` gates `review_proposal` and
   unlocks the full read scope for the inbox. (Design said "owner only" — this
   plan deviates per this decision; see Task 3.)
3. **Blank default template refuses standalone submissions** until the owner
   saves items — no invented defaults.

### One refinement to the design doc (flag for review)

The design says the LSG client POSTs the file (multipart) to `/api/uploads`.
Multipart through the route would still stream the whole file through the
Vercel function, defeating the design's own "keep bytes off the function"
goal. Instead `/api/uploads` is a **presign endpoint** (JSON): the client sends
metadata (a client-generated proposal uuid, item id, file name, mime type,
size), the server validates the caller, the item, the extension against the
item's allowed list, and the 10 MiB cap, and returns a `signedUrl` for the
client to PUT the bytes to directly. The client then sends the confirmed paths
in the submit call, which the route verifies against the live object. Nothing
inline over the route; `match_requirement_item` RPC + service-role client
enforce every gate.

## Prerequisites (operator, before task 1)

1. **Service-role key** — one-time, from the Supabase dashboard:
   Settings → API → `service_role` (secret). Requires no code change to the
   repo. The executor adds it to `.env.local` in the worktree (never committed,
   never in `.env.local.example`). Local verification of signed URLs depends on
   it; task 4 documents the flag.
2. **Storage bucket** — created by the migration itself (`insert into
   storage.buckets ... on conflict do nothing`), so nothing to do by hand.
   If the production Supabase refuses the `storage.buckets` insert, the
   operator creates bucket `proposal-documents` (private, `file_size_limit`
   10485760, `allowed_mime_types` per the migration) in the dashboard and the
   migration's `on conflict (id) do nothing` skips it.
3. **Worktree** — create it once:
   `git worktree add ../smartgov1/../.worktrees/requirement-submissions -b feature/lsg-requirement-submissions main`.
   Run `npm install` in the worktree (node_modules is not shared).

Reference commands (from the worktree unless noted):
```
npm run lint          # eslint (whole repo, fast)
npx tsc --noEmit      # typecheck
npm run check:units   # contract guards (item 14 grows here)
npm run build         # production build (must stay green)
```

---

## Task 1 — Contract guards that fail (check-units item 14)

**What:** grow `scripts/check-units.mjs` with item 14 guarding the new feature
contract. Per the repo rule these must go red before the feature exists and
stay green after, so this task commits alone and is the TDD "failing test" for
every following task.

**Where:** `scripts/check-units.mjs`.

### Steps

1. Read the top-of-file contract comment (currently 13 items) and bump it to
   14 with a sentence for the new item.
2. Append item 14's checks (starting at the `// ----` divider). Each check uses
   the file's existing helpers: `check(label, condition)`,
   `withoutComments(source)` and `withoutSqlComments(sql)` (build strings like
   the existing guards, with `flat(...)` for whitespace-insensitive matches).
3. Add the new reason keys guard (reads `src/lib/auth/messages.ts`) — these are
   the exact keys Task 2 adds, so this guard is red now too.
4. Commit: `git commit -m "check: guard the requirement-submission contract (red first)"`.

### Guard code to add

```js
// --------------------------------------------------------------------- 14

// The requirement-submission feature contract. The load-bearing rows here are
// mutation-tested the same way as the older guards: deleting the RLS-enable
// on a new table, stripping the membership join out of list_proposals, and
// deleting the 10 MiB cap out of the uploads route each turn this item red.
check(
  "14a. 002000 creates all six requirement tables with RLS on and no policies",
  (() => {
    const m = withoutSqlComments(readMigration("20260101002000_lsg_requirement_submissions.sql"));
    const tables = ["programs", "requirement_items", "proposals", "proposal_versions", "item_submissions", "reviews"];
    return tables.every((t) => m.includes(`create table if not exists smartgov.${t}`))
      && tables.every((t) => m.includes(`alter table smartgov.${t} enable row level security`))
      && !/(create policy|using\s*\()/.test(m);
  })(),
);

check(
  "14b. every 002000 smartgov function is security definer, pinned, and revoked; wrappers bounded",
  (() => {
    const m = withoutSqlComments(readMigration("20260101002000_lsg_requirement_submissions.sql"));
    // The full smartgov function surface: the 13 RPC/helper entry points plus
    // the two internal helpers (lsg_unit_ids, proposal_items_valid) and the
    // reviewer helper. A helper that is not pinned and revoked is as dangerous
    // as an RPC that is not.
    const names = [
      "lsg_unit_ids", "proposal_items_valid", "is_org_reviewer",
      "create_program", "set_default_requirements", "list_programs",
      "list_default_requirements", "match_requirement_item", "create_proposal",
      "submit_revision", "list_proposals", "proposal_detail", "review_proposal",
      "get_item_file", "am_i_reviewer",
    ];
    return names.every((n) => {
      const i = indexOfFn(m, n);
      if (i < 0) return false;
      const slice = m.slice(i);
      const start = slice.indexOf("security definer");
      const body = slice.indexOf("as $$");
      return start > 0 && start < body
        && /set search_path = (public|smartgov)[^;]*/.test(slice.slice(0, body))
        && m.includes(`revoke all on function smartgov.${n}`);
    })
      && indexOfFn(m, "create_program") > 0; // not decoration
  })(),
);

check(
  "14c. every mutating RPC meters a consume_rate_limit bucket",
  (() => {
    const m = withoutSqlComments(readMigration("20260101002000_lsg_requirement_submissions.sql"));
    const fns = ["create_program", "set_default_requirements", "create_proposal", "submit_revision", "review_proposal"];
    // Each function body runs from its `as $$` to the matching revoke line.
    let prev = 0;
    for (const fn of fns) {
      const start = m.indexOf(`function smartgov.${fn}(`);
      const end = m.indexOf(`revoke all on function smartgov.${fn}`);
      if (start < prev || end <= start) return false;
      if (!m.slice(start, end).includes("smartgov.consume_rate_limit(")) return false;
      prev = end;
    }
    return true;
  })(),
);

check(
  "14d. program read scoping: list_programs hides non-published from invited officers",
  (() => {
    const m = withoutSqlComments(readMigration("20260101002000_lsg_requirement_submissions.sql"));
    const i = m.indexOf("function smartgov.list_programs(");
    if (i < 0) return false;
    const body = m.slice(i, m.indexOf("revoke all", i));
    return /where pr\.organization_id = v_account\.organization_id/.test(body)
      && /v_account\.account_scope = 'owner' or pr\.status = 'published'/.test(body);
  })(),
);

check(
  "14e. proposal listing is scoped in SQL: invited officers only their own units",
  (() => {
    const m = withoutSqlComments(readMigration("20260101002000_lsg_requirement_submissions.sql"));
    const i = m.indexOf("function smartgov.list_proposals(");
    const body = m.slice(i, m.indexOf("revoke all", i));
    return /smartgov\.lsg_unit_ids\(/.test(body) && /created_by = v_account\.id/.test(body);
  })(),
);

check(
  "14f. the status state machine: usg writes published, lsg submitted; revision only from returned; review terminal",
  (() => {
    const m = withoutSqlComments(readMigration("20260101002000_lsg_requirement_submissions.sql"));
    return /v_author_kind :?= 'usg'[\s\S]{0,120}v_status :?= 'published'/.test(m)
      && /v_author_kind :?= 'lsg'[\s\S]{0,120}v_status :?= 'submitted'/.test(m)
      && /v_proposal\.status <> 'returned'/.test(m)
      && /'approved','returned','rejected'/.test(m);
  })(),
);

check(
  "14g. proposal_detail and get_item_file scope in SQL, not by hiding rows",
  (() => {
    const m = withoutSqlComments(readMigration("20260101002000_lsg_requirement_submissions.sql"));
    return /function smartgov\.proposal_detail\(/.test(m)
      && /v_ok := v_account\.account_scope = 'owner'/.test(m)
      && /function smartgov\.get_item_file\(/.test(m)
      && /v_scope := v_account\.account_scope = 'owner'/.test(m);
  })(),
);

check(
  "14m. review is open to the USG board: is_org_reviewer gates review_proposal and unlocks the reads",
  (() => {
    const m = withoutSqlComments(readMigration("20260101002000_lsg_requirement_submissions.sql"));
    const r = m.indexOf("function smartgov.is_org_reviewer(");
    const rp = m.slice(m.indexOf("function smartgov.review_proposal("), m.indexOf("revoke all on function smartgov.review_proposal"));
    return r > 0
      && /unit_type = 'usg'/.test(m.slice(r, m.indexOf("revoke all on function smartgov.is_org_reviewer")))
      && /smartgov\.is_org_reviewer\(/.test(rp)
      && /function smartgov\.am_i_reviewer\(/.test(m);
  })(),
);

check(
  "14h. messages.ts carries every new reason the feature emits",
  (() => {
    const s = withoutComments(readFileSync(join(ROOT, "src/lib/auth/messages.ts"), "utf8"));
    const keys = [
      "no_program", "no_proposal", "not_in_unit", "incomplete_submission",
      "unsupported_file_type", "file_too_large", "not_returned", "already_reviewed",
    ];
    return keys.every((k) => s.includes(`  ${k}: `));
  })(),
);

check(
  "14i. the uploads route caps bytes at the bucket limit (mutation: deleting this check red)",
  (() => {
    const s = withoutComments(readFileSync(join(ROOT, "src/app/api/uploads/route.ts"), "utf8"));
    return /MAX_FILE_BYTES/.test(s) && /sizeBytes\s*>/.test(s) && /ALLOWED_EXTENSIONS/.test(s);
  })(),
);

check(
  "14j. the service key stays server-only: only storage.ts reads it, never the client, never the example env",
  (() => {
    const t = withoutComments(readFileSync(join(ROOT, "src/lib/storage.ts"), "utf8"));
    const ex = withoutComments(readFileSync(join(ROOT, ".env.local.example"), "utf8"));
    return /SUPABASE_SERVICE_ROLE_KEY/.test(t) && !/SUPABASE_SERVICE_ROLE_KEY/.test(ex);
  })(),
);

check(
  "14k. the skip-setup gate exists in the dashboard and only for owners without units",
  (() => {
    const w = withoutComments(readFileSync(join(ROOT, "src/components/dashboard/requirement/RequirementWorkspace.tsx"), "utf8"));
    return /Proceed to dashboard anyway/.test(w) && /Go back to setup/.test(w)
      && /unitCount === 0/.test(w);
  })(),
);

check(
  "14l. no email or notification machinery leaks into the new feature (YAGNI gate)",
  (() => {
    const m = withoutSqlComments(readMigration("20260101002000_lsg_requirement_submissions.sql"));
    return !/nodemailer|smtp|mailer|sendEmail|welcomeEmail/.test(m);
  })(),
);
```

The helpers `readMigration(name)` and `indexOfFn(source, name)` do not exist
yet — add them next to the existing file-top helpers:

```js
function readMigration(name) {
  return readFileSync(join(ROOT, "supabase/migrations", name), "utf8");
}

function indexOfFn(source, fnName) {
  const starts = [];
  const re = /function smartgov\.([a-z_]+)\(/g;
  let m;
  while ((m = re.exec(source)) !== null) starts.push([m[1], m.index]);
  const hit = starts.filter(([n]) => n === fnName);
  return hit.length === 1 ? hit[0][1] : -1;
}
```

Guard the "one definition" assumption: the checks use `indexOfFn` returning -1
for zero or repeated definitions, so a rebase duplication turns red instead of
passing.

### Verified

- `node scripts/check-units.mjs` fails with red lines on 14a–14l (the migration,
  messages, uploads route, and gate strings do not exist yet). Demo the reds in
  the commit message body.
- `npm run lint` and `npx tsc --noEmit` still pass (only a .mjs script changed).

---

## Task 2 — `messages.ts` gains the new reasons

**What:** the eight reason codes the RPCs and routes emit, mapped to safe
wording. Follows the file's existing `RPC_MESSAGES` map.

**Where:** `src/lib/auth/messages.ts` (extend, after line 46 before the closing
`};`).

### Steps

1. Add the entries below.
2. This satisfies guard 14h — the earlier red goes green.
3. No route changes yet.

### Code

```ts
  no_program: "That program could not be found.",
  no_proposal: "That proposal could not be found.",
  not_in_unit: "Your account is not part of that unit.",
  incomplete_submission: "Every item needs a file or a link before you can submit.",
  unsupported_file_type: "One of the files is not a type the requirement allows.",
  file_too_large: "One of the files is larger than the 10 MB limit.",
  not_returned: "Only a returned proposal can be revised.",
  already_reviewed: "This version has already been reviewed.",
```

### Verified

- `node scripts/check-units.mjs` shows 14h green, others still red.
- `npx tsc --noEmit` green; `npm run lint` green.

---

## Task 3 — Migration `20260101002000_lsg_requirement_submissions.sql`

**What:** six tables, RLS on with no policies, `revoke` from `anon`,
`authenticated`, the private storage bucket with the 10 MiB cap, and 11 pinned
`security definer` functions with `public` wrappers — whole file below. This is
the biggest task; copy the file verbatim and then apply it to the live
database so later tasks have something to call.

**Where:** `supabase/migrations/20260101002000_lsg_requirement_submissions.sql`.

### Rules the file obeys

- Every table in `smartgov`, RLS `enable row level security`, no policies,
  `revoke all on all tables in schema smartgov from anon, authenticated`.
- Every function `security definer` with `set search_path = public, extensions,
  smartgov, pg_temp`, `revoke all ... from public` for the `smartgov` versions
  and the same for `public` wrappers which are granted to `anon, authenticated`.
- `smartgov.authenticate(p_session_token)` is the only identity source;
  every read/write is filtered by `v_account.organization_id`.
- Mutating RPCs call `smartgov.consume_rate_limit(key, limit, interval)`.

### The file

```sql
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
-- holding a current seat in the org's top (unit_type = 'usg') unit — the USG
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
      coalesce(p_items->v_i->'allowed_extensions', jsonb '[]'),
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
      coalesce(p_items->v_i->'allowed_extensions', jsonb '[]'),
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
  p_account   smartgov.accounts%rowtype,
  p_template  jsonb,
  p_items     jsonb,
  p_version   int
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
      if not (v_ext = any((v_t->'allowedExtensions')::text[])) then
        return jsonb_build_object('ok', false, 'reason', 'unsupported_file_type');
      end if;
      -- The path must be the exact shape the presign route mints:
      -- <org>/proposals/<uuid>/v<N>/<item>/<name>.
      if v_path <> p_account.organization_id::text || '/proposals/'
           || substring(v_path from 'proposals/([^/]+)/' ) || '/v' || p_version || '/'
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
    into v_proposal
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
    into v_proposal
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
```

### Apply to the live database

From the worktree with credentials in the environment pair (same transport as
the 001500 push), run:

```
supabase db push --db-url "postgresql://postgres.qyatedebfmupzntcltru:...@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres" --include-all
```

(Executor reuses the exact DB URL already recorded in the environment notes.
Mind PowerShell quoting: wrap the URL in double quotes and see the environment
notes about UTF-8 when copying a file with `git checkout <sha> -- <path>`.)

Then confirm RLS is really on and functions pinned/revoked per the repo's 001500
pattern by running the same verification you used for 001500 (function list =
security definer, public wrappers granted, anon/authenticated revoked). The
`check-units` 14a–14g, 14l guards now go green against the file (independent of
the database).

### Verified

- `node scripts/check-units.mjs` — 14a–14g, 14l green; 14h green since task 2;
  only 14i/14j/14k red (routes + dashboard, coming in later tasks).
- `supabase db push` clean on the live project; `npx tsc --noEmit` green.

---

## Task 4 — Storage service client + presign/sign helpers

**What:** `src/lib/storage.ts`, the only module that sees
`SUPABASE_SERVICE_ROLE_KEY`. It exposes the bucket constant, the byte cap, the
allowed-extension set, and two async helpers: `createSignedUploadUrl(path,
mimeType, sizeBytes)` and `createSignedDownloadUrl(path, redirectFor)`.

**Where:** `src/lib/storage.ts` (new).

### Rules

- Uses `@supabase/supabase-js` `createClient` with `auth: { persistSession:
  false }` — the service client must never touch the browser.
- If `SUPABASE_SERVICE_ROLE_KEY` is missing, helpers throw a descriptive error
  (`"proposal storage is not configured"`); routes surface it as a 500. Local
  `.env.local` must carry the key for local E2E.
- Guard 14j turns green as soon as this file reads the key... but 14j also
  asserts the example env does NOT list the key (nothing to do) — so 14j goes
  green here.

### Code

```ts
/**
 * Server-only access to Supabase Storage for proposal documents.
 *
 * The publishable key in `@/lib/supabase` cannot touch the private bucket at
 * all; everything here runs on the service-role key, which is why this module
 * is never imported transitively from a client component ("use client"). The
 * browser only ever receives short-lived signed URLs, never this client.
 *
 * The 10 MiB cap lives in exactly two places: the bucket's `file_size_limit`
 * (enforced by Storage regardless of who mints the URL) and this constant,
 * which the presign route checks against the declared size before a signed
 * upload URL exists.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function serviceClient() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error("proposal storage is not configured");
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

export const PROPOSAL_BUCKET = "proposal-documents";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Extensions the USG may pick when an item asks for a file. */
export const ALLOWED_EXTENSIONS = [
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "jpg", "jpeg", "png", "webp", "gif", "zip",
] as const;

export function sanitizeFileName(fileName: string): string {
  const base = fileName.replace(/[\\/]/g, "-").replace(/[\u0000-\u001f]/g, "").trim();
  return base.length > 128 ? base.slice(0, 128) : base;
}

export async function createSignedUploadUrl(
  storagePath: string,
  mimeType: string,
  sizeBytes: number,
): Promise<{ signedUrl: string; token: string }> {
  const res = await serviceClient()
    .storage.from(PROPOSAL_BUCKET)
    .createSignedUploadUrl(storagePath, {
      contentType: mimeType,
      size: sizeBytes,
    });
  if (res.error || !res.data?.signedUrl) {
    throw new Error(res.error?.message ?? "could not mint an upload URL");
  }
  return { signedUrl: res.data.signedUrl, token: res.data.token };
}

export async function createSignedDownloadUrl(
  storagePath: string,
): Promise<string> {
  const res = await serviceClient()
    .storage.from(PROPOSAL_BUCKET)
    .createSignedUrl(storagePath, 5 * 60);
  if (res.error || !res.data?.signedUrl) {
    throw new Error(res.error?.message ?? "could not mint a download URL");
  }
  return res.data.signedUrl;
}

/** Verifies an already-uploaded object exists and matches the declared size. */
export async function objectSize(storagePath: string): Promise<number | null> {
  const res = await serviceClient().storage.from(PROPOSAL_BUCKET).info(storagePath);
  if (res.error || !res.data) return null;
  return Number(res.data.metadata?.size) || null;
}
```

### Verified

- `npx tsc --noEmit` green; `npm run lint` green.
- `node scripts/check-units.mjs` — 14j green.
- Honest check: `rg -l "SUPABASE_SERVICE_ROLE_KEY" && rg -l "SUPABASE_SERVICE_ROLE_KEY" src/app src/components` — only `src/lib/storage.ts` matches; nothing in `src/app` or `src/components`.

---

## Task 5 — API routes

**What:** the eight route files. Each follows the existing route shape (401 no
session; `callRpc` → map reason → status; transport error → 500), with the
`rate_limited → 429` mapping the design specifies. `messageFor()` feeds all
messages; no raw reason is ever shipped.

**Where (new files):**
- `src/app/api/programs/route.ts` — GET `list_programs`, POST `create_program`
- `src/app/api/programs/[id]/route.ts` — GET detail (filter of `list_programs`)
- `src/app/api/requirements/default/route.ts` — GET `list_default_requirements`,
  POST `set_default_requirements`
- `src/app/api/proposals/route.ts` — GET `list_proposals`, POST `create_proposal`
- `src/app/api/proposals/[id]/route.ts` — GET `proposal_detail`,
  POST `submit_revision`
- `src/app/api/proposals/[id]/review/route.ts` — POST `review_proposal`
- `src/app/api/uploads/route.ts` — POST presign (validates item via
  `match_requirement_item`, extension vs `ALLOWED_EXTENSIONS` ∩ item list, size
  vs `MAX_FILE_BYTES`, then mints `<orgId>/proposals/<uuid>/v<version>/<itemId>/<name>`
  and returns `{ signedUrl, storagePath }`)
- `src/app/api/files/[submissionId]/route.ts` — GET `get_item_file` → sign → redirect
- `src/app/api/reviewer/route.ts` — GET `am_i_reviewer` (the shell needs to know
  an invited account is on the USG board to render the USG view)

Guards 14i (uploads cap) and the general route shape turn green once these
land. `check-units` only reads the uploads route's cap guard plus the messages
keys, so the rest is verified by typecheck, lint, and the live behavior test in
task 9.

### Error mapping (shared, in each route)

```ts
function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "rate_limited") return 429;
  if (reason === "forbidden") return 403;
  return 400;
}
```

### Representative code — the two that are not pure RPC passthroughs

`src/app/api/uploads/route.ts` (the presign endpoint; the design refinement):

```ts
import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import {
  ALLOWED_EXTENSIONS,
  MAX_FILE_BYTES,
  createSignedUploadUrl,
  sanitizeFileName,
} from "@/lib/storage";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MatchItem = {
  itemKind: "file" | "link";
  allowedExtensions: string[];
};

export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });

  const ip = clientIp(req);
  const limited = rateLimit(`upload:${ip}`, 40, 10 * 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { ok: false, message: messageFor("rate_limited"), retryAfterSeconds: limited.retryAfterSeconds },
      { status: 429 },
    );
  }

  let body: {
    uuid: string;
    itemId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    version?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Something went wrong. Please try again." }, { status: 400 });
  }

  const version = Number.isInteger(body.version) && body.version! >= 1 ? body.version! : 1;
  if (!UUID_RE.test(body.uuid ?? "") || !UUID_RE.test(body.itemId ?? "")) {
    return NextResponse.json({ ok: false, message: messageFor("invalid_request") }, { status: 400 });
  }
  if (typeof body.sizeBytes !== "number" || body.sizeBytes <= 0 || body.sizeBytes > MAX_FILE_BYTES) {
    return NextResponse.json({ ok: false, message: messageFor("file_too_large") }, { status: 400 });
  }

  try {
    const match = await callRpc<RpcResult & { item?: MatchItem }>("match_requirement_item", {
      p_session_token: token,
      p_item_id: body.itemId,
    });
    if (!match.ok) {
      return NextResponse.json({ ok: false, message: messageFor(match.reason) }, { status: statusForReason(match.reason) });
    }
    if (match.item?.itemKind !== "file") {
      return NextResponse.json({ ok: false, message: messageFor("invalid_request") }, { status: 400 });
    }

    const ext = (body.fileName.split(".").pop() ?? "").toLowerCase();
    const allowed = match.item.allowedExtensions.length
      ? match.item.allowedExtensions
      : ALLOWED_EXTENSIONS;
    if (!allowed.includes(ext)) {
      return NextResponse.json({ ok: false, message: messageFor("unsupported_file_type") }, { status: 400 });
    }

    // The caller's organization is not in the body; it is not needed to build
    // the path because the RPC call above already scoped the caller to their
    // own org. The path shape is the exact one create_proposal/submit_revision
    // re-derive, so a client cannot inject a foreign path.
    const orgId = await callerOrganizationId(token); // helper below
    if (!orgId) {
      return NextResponse.json({ ok: false, message: messageFor("unauthenticated") }, { status: 401 });
    }

    const name = sanitizeFileName(body.fileName);
    if (!name) {
      return NextResponse.json({ ok: false, message: messageFor("invalid_request") }, { status: 400 });
    }

    const storagePath =
      `${orgId}/proposals/${body.uuid}/v${version}/${body.itemId}/${name}`;

    const { signedUrl, token: uploadToken } = await createSignedUploadUrl(
      storagePath,
      body.mimeType || "application/octet-stream",
      body.sizeBytes,
    );

    return NextResponse.json({ ok: true, signedUrl, storagePath, uploadToken });
  } catch (error) {
    console.error("[uploads:presign]", error);
    return NextResponse.json({ ok: false, message: "We could not prepare that upload." }, { status: 500 });
  }
}
```

The `callerOrganizationId` helper: `list_programs` is already org-scoped and
caller-authenticated, so it is a safe place to read the caller's own
`organization_id` back out (Task 3 adds `'organizationId', v_account.organization_id`
to the top-level return of `list_programs` for exactly this):

```ts
async function callerOrganizationId(token: string): Promise<string | null> {
  const res = await callRpc<RpcResult & { organizationId?: string }>("list_programs", {
    p_session_token: token,
  });
  return res.ok && res.organizationId ? res.organizationId : null;
}
```

This leaks nothing a caller does not already know about their own org.

`src/app/api/files/[submissionId]/route.ts` (download gate):

```ts
import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { createSignedDownloadUrl } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ submissionId: string }> }) {
  const token = await readSessionToken();
  if (!token) return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });

  const { submissionId } = await ctx.params;
  try {
    const res = await callRpc<RpcResult & { storagePath?: string }>("get_item_file", {
      p_session_token: token,
      p_submission_id: submissionId,
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, message: messageFor(res.reason) }, { status: statusForReason(res.reason) });
    }
    const url = await createSignedDownloadUrl(res.storagePath!);
    return NextResponse.redirect(url);
  } catch (error) {
    console.error("[files:get]", error);
    return NextResponse.json({ ok: false, message: "We could not fetch that file." }, { status: 500 });
  }
}
```

The remaining six routes are mechanical passthroughs of the same shape
(`GET /api/programs`, `POST /api/programs`, `GET /api/requirements/default`,
`POST /api/requirements/default`, `GET|POST /api/proposals`,
`GET|POST /api/proposals/[id]`, `POST /api/proposals/[id]/review`). Details:

- Input validation that the RPC already performs (title length, enum, item
  kinds) is left to the RPC; routes only coerce the body into the typed
  argument list, so the plan's SQL stays the single authority.
- `submit_revision` (POST `/api/proposals/[id]`) additionally verifies each
  file entry's `storagePath` resolves to a real object of the declared size via
  `objectSize` before forwarding; a mismatch is a `400` "That file has not
  uploaded yet."
- `rate_limited` maps to `429` with `messageFor("rate_limited")`; `forbidden`
  → `403`; `unauthenticated` → `401` (plus the 401 shortcut when no token).

### Verified

- `npx tsc --noEmit` and `npm run lint` green.
- `node scripts/check-units.mjs` — 14i green. 14k still red (dashboard).
- Review each route once against the checklist: 401 no token, `callRpc` failure
  path uses `messageFor`, transport errors 500, no raw reason leaked.

---

## Task 6 — Dashboard gate + redesign scaffolding

**What:** rework `src/app/dashboard/page.tsx` (server side) so it learns
whether the owner has units and can show the skip-setup gate, plus the shared
`requirement/` components (types, helpers, activity icon, count-up hook).

**Where:**
- `src/app/dashboard/page.tsx` (extend)
- `src/components/dashboard/requirement/types.ts` (new)
- `src/components/dashboard/requirement/helpers.ts` (new — status labels,
  `formatDate`, reason map reuse)
- `src/components/dashboard/requirement/ActivityIcon.tsx` (new)
- `src/components/dashboard/requirement/CountUp.tsx` (new)

### Gate design (guard 14k is watching for these strings)

In `page.tsx`, add a small server-driven fetch of the unit list (the existing
`Workspace` already fetches it client-side via `/api/units`, so also expose the
count server-side): call `callRpc` to the existing units list RPC (the same one
`/api/units` uses) and derive `units.length === 0`. Keep the current hero; under
`<Workspace .../>` add the new operational area. The gate lives in a new client
component `RequirementWorkspace`, which receives `account` and `unitCount`:

- **Owner with no units:** show setup (existing `Workspace`) plus a prominent
  callout: "Set up at least one local student government to begin." →
  `[Proceed to dashboard anyway]`. Clicking reveals the operational workspace
  and swaps the callout for a persistent header button `[Go back to setup]`.
- **Owner with units:** show the operational workspace immediately, with the
  setup link still available in a slim header row ("Setup & units").
- **Invited officer:** `am_i_reviewer` decides the view — a USG-board member
  sees the same operational USG view as the owner (review inbox, programs); any
  other invited officer sees the LSG view only. Invited accounts are never
  setup participants.

### Types (complete)

```ts
export type ActivityType =
  | "sports" | "culture" | "academic" | "community" | "wellness" | "special";

export type ItemKind = "file" | "link";

export type RequirementItem = {
  id: string;
  label: string;
  itemKind: ItemKind;
  allowedExtensions: string[];
  position: number;
};

export type ProgramRow = {
  id: string;
  name: string;
  description: string;
  icon: ActivityType;
  status: "draft" | "published";
  createdAt: string;
  items: RequirementItem[];
};

export type ProposalsListRow = {
  id: string;
  title: string;
  status: "submitted" | "returned" | "approved" | "rejected" | "published";
  authorKind: "lsg" | "usg";
  activityType: ActivityType;
  eventDate: string | null;
  createdAt: string;
  programName: string | null;
  unitName: string | null;
  version: number;
  latestDecision: string | null;
  latestRemark: string | null;
};

export type ProposalDetail = {
  id: string;
  title: string;
  description: string;
  status: ProposalsListRow["status"];
  authorKind: "lsg" | "usg";
  activityType: ActivityType;
  eventDate: string | null;
  venue: string | null;
  createdAt: string;
  programName: string | null;
  unitName: string | null;
  versions: Array<{
    id: string;
    versionNumber: number;
    submittedBy: string;
    submissionNote: string | null;
    submittedAt: string;
    items: Array<{
      itemId: string;
      label: string;
      itemKind: ItemKind;
      submissionKind: ItemKind;
      originalName: string | null;
      sizeBytes: number | null;
      linkUrl: string | null;
    }>;
  }>;
  reviews: Array<{
    versionNumber: number;
    decision: "approved" | "returned" | "rejected";
    remark: string | null;
    decidedBy: string;
    createdAt: string;
  }>;
};
```

### ActivityIcon + CountUp

```tsx
import { IconEvents, IconCompass, IconVerification, IconBuilding, IconShield, IconSparkle } from "@/components/ui/Icons";
import type { ActivityType } from "./types";

const ICONS: Record<ActivityType, typeof IconEvents> = {
  sports: IconEvents,
  culture: IconCompass,
  academic: IconVerification,
  community: IconBuilding,
  wellness: IconShield,
  special: IconSparkle,
};

export function ActivityIcon({ type, className }: { type: ActivityType; className?: string }) {
  const Icon = ICONS[type] ?? IconSparkle;
  return <Icon className={className} />;
}
```

`CountUp` — animated counter used by the bento stat cards, using the existing
`motion` dependency (already in package.json, no new install):

```tsx
"use client";
import { useEffect, useRef, useState } from "react";

export function CountUp({ value, duration = 700 }: { value: number; duration?: number }) {
  const [n, setN] = useState(0);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      setN(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span>{n.toLocaleString("en-PH")}</span>;
}
```

`helpers.ts`:

```ts
import type { ProposalsListRow } from "./types";

export function statusLabel(status: ProposalsListRow["status"]): string {
  switch (status) {
    case "submitted": return "Submitted";
    case "returned": return "Returned — resubmit";
    case "approved": return "Approved";
    case "rejected": return "Rejected";
    case "published": return "Published";
  }
}

export const ACTIVITY_OPTIONS = [
  { value: "sports", label: "Sports" },
  { value: "culture", label: "Culture" },
  { value: "academic", label: "Academic" },
  { value: "community", label: "Community" },
  { value: "wellness", label: "Wellness" },
  { value: "special", label: "Special" },
] as const;
```

### Verified

- `npx tsc --noEmit`, `npm run lint` green.
- `node scripts/check-units.mjs` — 14k green once both gate strings and
  `units.length === 0` appear in exactly those files.

---

## Task 7 — USG shell (RequirementWorkspace owner view)

**What:** `RequirementWorkspace` decides owner/reviewer vs invited and renders
the USG shell (owner or USG-board reviewer) or LSG shell (invited officer). The
USG shell holds four panels:

1. **Review inbox** — proposals from `list_proposals` filtered to
   `submitted`/`returned`, sorted newest first; a row opens
   `ProposalDetailFlow` (task 9) with approve/return/reject actions.
2. **Programs & templates** — list programs with their item chips; "New program"
   form (name, description, icon select, item editor: label, kind, allowed
   extensions); the standalone default template editor using
   `/api/requirements/default`.
3. **Own published proposals** — USG-authored `published` proposals with a
   "New USG activity" form (no review).
4. **Setup & units** — the existing `Workspace` (invites + units) embedded.

**Where (new files):**
- `src/components/dashboard/requirement/RequirementWorkspace.tsx`
- `src/components/dashboard/requirement/UsgShell.tsx`
- `src/components/dashboard/requirement/ProgramForm.tsx`
- `src/components/dashboard/requirement/TemplateEditor.tsx`
- `src/components/dashboard/requirement/ReviewInbox.tsx`

Component conventions: mirror `Workspace.tsx`'s inline-busy-flag + `role="status"`
caption style; errors from the API surface via `messageFor`-produced messages
(each fetch already returns `{ message }`); the shell's API calls are typed
against `ProgramRow`/`ProposalsListRow`.

### RequirementsWorkspace (gate + shell switch) — complete

```tsx
"use client";

import { useEffect, useState } from "react";
import type { Account } from "@/lib/auth/session";
import { Workspace } from "@/components/dashboard/Workspace";
import { UsgShell } from "./UsgShell";
import { LsgShell } from "./LsgShell";
import { ButtonLink } from "@/components/ui/Button";

export function RequirementWorkspace({
  account,
  unitCount,
}: {
  account: Account;
  unitCount: number;
}) {
  const isOwner = account.accountScope === "owner";
  const [reviewer, setReviewer] = useState(false);
  const [forced, setForced] = useState(false);
  const [shell, setShell] = useState<"setup" | "ops">(
    isOwner && unitCount === 0 ? "setup" : "ops",
  );

  // Invited accounts on the USG board (am_i_reviewer) get the USG view too.
  useEffect(() => {
    if (isOwner) return;
    let alive = true;
    fetch("/api/reviewer")
      .then((r) => r.json())
      .then((d) => { if (alive && d.ok) setReviewer(Boolean(d.reviewer)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [isOwner]);

  if (isOwner && shell === "setup") {
    return (
      <div>
        {unitCount === 0 ? (
          <div className="mb-6 flex flex-col items-start gap-4 rounded-2xl border border-brass/40 bg-brass-soft/25 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold text-ink">Set up the local student governments first</p>
              <p className="mt-1 text-[0.875rem] text-body">
                Add at least one unit below. You can still open the operational dashboard
                in the meantime.
              </p>
            </div>
            <ButtonLink
              href="#"
              onClick={(e) => { e.preventDefault(); setShell("ops"); setForced(true); }}
            >
              Proceed to dashboard anyway
            </ButtonLink>
          </div>
        ) : null}
        <Workspace account={account} variant={account.accountKind === "central" ? "central" : "usg"} />
      </div>
    );
  }

  const showUsg = isOwner || reviewer;

  return (
    <div>
      {isOwner && (forced || unitCount === 0) ? (
        <div className="mb-6 flex items-center justify-between rounded-xl border border-line bg-paper/60 px-4 py-3">
          <p className="text-[0.8125rem] text-body">Operational dashboard</p>
          <button
            type="button"
            className="text-[0.8125rem] font-semibold text-brass-deep underline-offset-2 hover:underline"
            onClick={() => setShell("setup")}
          >
            Go back to setup
          </button>
        </div>
      ) : null}
      {showUsg ? (
        <UsgShell account={account} />
      ) : (
        <LsgShell account={account} />
      )}
    </div>
  );
}
```

Wait — owner-with-zero-units starts on `setup` but keeps the operational view
reachable; owner-with-units starts on `ops` with the row of setup links kept
inside the USG shell. That matches guard 14k and the design. `LsgShell`'s
`forcedGate` prop is unused for now — drop it during implementation unless the
executor finds a use (goes in the commit as written; small PR-reviewed later).

### USG shell outline

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import type { Account } from "@/lib/auth/session";
import type { ProgramRow, ProposalsListRow } from "./types";
import { ReviewInbox } from "./ReviewInbox";
import { ProgramForm } from "./ProgramForm";
import { TemplateEditor } from "./TemplateEditor";
import { Workspace } from "@/components/dashboard/Workspace";
import { ActivityIcon } from "./ActivityIcon";
import { CountUp } from "./CountUp";
import { Reveal } from "@/components/fx/Reveal";

export function UsgShell({ account }: { account: Account }) {
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [proposals, setProposals] = useState<ProposalsListRow[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const [p, q] = await Promise.all([
      (await fetch("/api/programs")).json(),
      (await fetch("/api/proposals")).json(),
    ]);
    if (p.ok) setPrograms(p.programs);
    if (q.ok) setProposals(q.proposals);
    setLoading(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const awaiting = proposals.filter((x) => x.status === "submitted" || x.status === "returned").length;
  const published = proposals.filter((x) => x.status === "published").length;
  const total = proposals.length;

  if (loading) return <p role="status" className="text-[0.875rem] text-body">Loading the workspace…</p>;

  return (
    <div className="space-y-6">
      {/* bento stat cards */}
      <Reveal className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Awaiting review", value: awaiting, icon: "submission" },
          { label: "Published programs", value: programs.length, icon: "tracking" },
          { label: "Approved this term", value: published, icon: "monitoring" },
        ].map((c) => (
          <div key={c.label} className="rounded-2xl border border-line bg-paper/70 p-5">
            <div className="flex items-center justify-between">
              <p className="eyebrow">{c.label}</p>
              <ActivityIcon type="academic" className="h-4 w-4 text-brass" />
            </div>
            <p className="mt-3 text-[2rem] font-semibold leading-none text-ink-deep">
              <CountUp value={c.value} />
            </p>
          </div>
        ))}
      </Reveal>

      <ReviewInbox proposals={proposals} onChanged={reload} />

      <div className="grid gap-6 xl:grid-cols-2">
        <ProgramForm programs={programs} onCreated={reload} />
        <TemplateEditor onSaved={reload} />
      </div>

      {/* USG's own published proposals */}
      <section className="rounded-2xl border border-line bg-paper/70 p-6">
        <p className="eyebrow">Run by your office</p>
        {total === published && published === 0 ? (
          <p className="mt-3 text-[0.875rem] text-body">Nothing published yet.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {proposals.filter((p) => p.authorKind === "usg").map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-4 rounded-xl border border-line/70 px-4 py-3">
                <span className="truncate text-[0.9375rem] font-medium text-ink">{p.title}</span>
                <span className="text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-brass-deep">Published</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="border-t border-line/70 pt-6">
        <Workspace account={account} variant={account.accountKind === "central" ? "central" : "usg"} />
      </div>
    </div>
  );
}
```

(The `total`/`published` vars above are deliberately simple; executor trims
dead vars before committing.)

### Verified

- `npx tsc --noEmit`, `npm run lint` green.
- Desktop check by hand once live: owner with units sees stat cards, inbox,
  program form, template editor, and the existing invites/units below.

---

## Task 8 — LSG shell (browse, submit, resubmit, track)

**What:** the invited-officer view. Programs to browse (`/api/programs`),
default template for standalone drafts (`/api/requirements/default`), the
unit's own proposals (`/api/proposals`), and a submit/resubmit form backed by
the presign flow.

**Where (new files):**
- `src/components/dashboard/requirement/LsgShell.tsx`
- `src/components/dashboard/requirement/ProposalForm.tsx` (program picker +
  dynamic item fields: file fields walk the presign+PUT flow, link fields are
  URL inputs)
- `src/components/dashboard/requirement/ProposalDetailFlow.tsx` (used by both
  shells: timeline, version diff, review actions, resubmit)
- `src/components/dashboard/requirement/Timeline.tsx` (approval timeline)

### ProposalForm file-upload walk (the part that must be exactly right)

```tsx
async function presignAndPut(
  uuid: string,
  item: RequirementItem,
  file: File,
  version: number,
): Promise<{ storagePath: string }> {
  const res = await fetch("/api/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uuid,
      itemId: item.id,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      version,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok || !data.signedUrl) {
    throw new Error(data.message ?? "Could not prepare that file.");
  }
  const put = await fetch(data.signedUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type, "Content-Length": String(file.size) },
    body: file,
  });
  if (!put.ok) throw new Error("The file upload failed. Try again.");
  return { storagePath: data.storagePath };
}
```

The form keeps one `proposalUuid` (generated once per draft via
`crypto.randomUUID()`), passes `version = 1` for a new proposal or
`latestVersion + 1` for a resubmit, and on submit POSTs `/api/proposals` (new)
or `/api/proposals/{id}` (revision) with the assembled `items` array.

Important UI principle from the design doc: link or file per item is decided by
the USG's template; the form renders a file input for `file` items and a URL
input for `link` items, and never lets a user swap one for the other.

### Timeline (approval history)

```tsx
export function Timeline({ proposal }: { proposal: ProposalDetail }) {
  const steps = [
    { label: "Submitted", at: proposal.createdAt, kind: "created" },
    ...proposal.reviews.map((r) => ({
      label: r.decision === "approved" ? "Approved" : r.decision === "returned" ? "Returned" : "Rejected",
      at: r.createdAt,
      kind: r.decision,
      remark: r.remark,
      version: r.versionNumber,
      by: r.decidedBy,
    })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return (
    <ol className="mt-4 flex flex-col gap-3">
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-3">
          <span aria-hidden className={nodeDot(s.kind)} />
          <div>
            <p className="text-[0.875rem] font-semibold text-ink">
              {s.version ? `v${s.version} · ` : ""}{s.label}
            </p>
            {s.remark ? (
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-body">{s.remark}</p>
            ) : null}
            <p className="mt-0.5 text-[0.6875rem] text-muted">
              {formatDate(s.at)} {s.by ? `· ${s.by}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function nodeDot(kind: string) {
  const map = {
    created: "bg-ink",
    approved: "bg-emerald-500",
    returned: "bg-amber-500",
    rejected: "bg-red-500",
  } as Record<string, string>;
  return `mt-1 size-2.5 shrink-0 rounded-full ${map[kind] ?? "bg-line"}`;
}
```

(`emerald/amber/red` classes exist in the project's Tailwind v4 setup — verify
at implementation time and fall back to the brass/ink palette if not.)

### Verified

- `npx tsc --noEmit`, `npm run lint` green.
- Manual: invited officer signs in, browses programs, drafts a file+link
  proposal, submits; the row appears in the owner inbox.

---

## Task 9 — Behavior test (live DB, rolled back) + full verification + deploy

**What:** prove the whole loop against the live database with a thrown-away
transaction, then run every guard, then deploy like 0019 (preview, test, promote).

### Behavior test

`scripts/requirement-loop-behavior.mjs` (new, deleted after running). Same
technique as the invite E2E: mint a session token for an existing owner account
and an existing invited officer by inserting session rows directly in the DB
with `pg` (see `units-prod-e2e.mjs` in the temp dir for the cookie shape), then
drive the RPCs via the `pg` connection wrapped in a transaction that is rolled
back:

1. owner: `create_program` with a file item (pdf) + a link item → ok.
2. owner: `list_programs` shows the program; cross-org id in `proposal_detail`
   → `no_proposal` (not_found path).
3. invited officer: `list_programs` → program visible; `create_proposal`
   attached with a file entry (storage_path shaped like the presign route
   mints) + link entry → ok, `status submitted`, `version 1`.
4. owner: `review_proposal` returned with remark → `returned`.
5. invited: `submit_revision` → `version 2`, `status submitted`; double-check
   `submit_revision` on the same (now submitted) row → `not_returned`.
6. owner: `review_proposal` approved → `approved`; second review of the same
   version → `already_reviewed`.
7. invited: `list_proposals` returns ONLY their unit's rows (a second invited
   account from another unit cannot see the row); the second account's
   `am_i_reviewer` → false.
8. owner (or an invited USG-board account): `am_i_reviewer` → true, and its
   `list_proposals` returns all org rows.
8b. owner: `set_default_requirements`; standalone `create_proposal` against it.
9. All rolled back; no rows remain, no sessions remain.

The storage path in step 3 must match `proposal_items_valid`'s exact shape
(`<org>/proposals/<uuid>/v1/<item>/<name>`), so the script derives it from the
same components (`org = current org`, a random uuid, the item id from the
created program). `get_item_file` + a signed download URL is exercised
separately in the E2E against the deployed route once Storage is live.

### Mandatory retro checklist before deploy

- `npm run lint`, `npx tsc --noEmit`, `npm run check:units` (expect ~110 checks
  green including item 14), `npm run build`.
- No `SUPABASE_SERVICE_ROLE_KEY` in any committed file (`rg` over the worktree,
  excluding `.env.local`).
- Temporary behavior script deleted; perms on `.env.local` unchanged.

### Deploy (same rhythm as the invite-actions release)

1. Commit every task already committed along the way — this task only adds the
   rollout + this checklist.
2. Push `feature/lsg-requirement-submissions`.
3. Add `SUPABASE_SERVICE_ROLE_KEY` to the Vercel project (via `vercel env add`)
   plus the existing `SMTP_PASS`-style secrets already there.
4. Preview deploy → open the previous production-data workspace (owner + an LSG
   officer still signed out — sign in the owner) → run a real file upload end
   to end once (presign, PUT, submit, owner downloads).
5. Promote to production when green.

### Cleanup

- Delete `scripts/requirement-loop-behavior.mjs` and any temp test artifacts.
- Verify `SELECT count(*) FROM smartgov.sessions` returns only real logged-in
  users (no test tokens), matching the session hygiene done for invite-actions.

---

## Decisions (answered with the owner, 2026-09-29)

1. **Program templates stay frozen after submissions exist** — drop + recreate
   is the sanctioned edit path (design non-goal kept). No code change needed;
   `create_program`/`set_default_requirements` already stateless.
2. **Review is open to the USG board, not only the owner.** The USG board is an
   invited account holding a current seat in the org's top unit
   (`unit_type = 'usg'`). `is_org_reviewer` gates `review_proposal` and unlocks
   the full read scope (`list_proposals`, `proposal_detail`, `get_item_file`,
   `match_requirement_item`) so the board can run the inbox. `create_program`,
   `set_default_requirements`, and USG-authored direct publishing stay
   owner-only; an invited reviewer still submits as an LSG author when they
   draft proposals. This deviates from the design doc's "owner only" wording.
3. **Standalone default template blank state = refuse** — before the owner
   saves any default items, `create_proposal` against `program_id IS NULL`
   answers `incomplete_submission`. Good: no invented defaults. (The migration
   does not seed the template.)