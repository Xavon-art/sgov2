# Proposal Lifecycle and Review Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Status:** Implemented — Tasks 1–22 complete (2026-10-12). Migration `20260101003050_proposal_review_flow.sql` applied; API routes, `ProgressStepper`/`ReviewProposalPanel`, and the shell wiring landed. Gates green: `npm run lint` (0 errors), `npx tsc --noEmit`, `npm run build`, `npm run check:units` (282/282).

**Goal:** Remodel the Activities & Events / Requirements section into a full proposal lifecycle — LSG submits a proposal with budget and breakdown docs; USG clicks **Review Proposal** (flips to *Under Review* with a progress bar *Pending Review → Under Review → Responded → Verified*); USG responds **Rejected** (reason required), **Approved**, or **Approved + Additional Requirements** (loop back to LSG to respond per requirement, then returns to USG for per-item accept/waive verification until Approved).

**Architecture:** Extend the existing requirement-proposal store (`smartgov.proposals`, `smartgov.reviews`) rather than build a parallel feature. Add two new statuses (`under_review`, `requirements_requested`), one new review decision (`requirements`), one new table (`smartgov.proposal_requirements`), and a small set of security-definer RPCs plus public forwarders — every transition stays inside Postgres behind the existing `authenticate()` / `consume_rate_limit()` helpers. Requirement-response files reuse the existing `document_uploads` large-object machinery via a new scoped claim RPC so there is no second storage path to reason about. The Next.js API layer stays a thin JSON passthrough over `callRpc`, exactly like the current proposal routes.

**Tech Stack:** Next.js 14 (App Router, route handlers), TypeScript, Postgres migrations (Supabase, PL/pgSQL security-definer RPCs), `scripts/apply-migration.mjs` for the DB ledger, `scripts/check-units.mjs` for the migration audit. No service-role key — files are Postgres large objects streamed through route handlers.

---

## Working context (read this first)

- Working tree: `C:\Users\JULIUS~1.MAT\AppData\Local\Temp\opencode\smartgov-deploy` (clean clone at `a2385e6`, `origin/main`). Do **not** edit the Desktop `smartgov1` directory.
- Migration numbering: next file is `20260101003050_proposal_review_flow.sql` (after `...03040_officer_deactivation.sql`).
- Apply migrations: `node scripts/apply-migration.mjs <file>` with `DATABASE_URL` set to the direct connection string (Supabase CLI unusable; `vcp_` tokens won't auth it).
- Every migration in this repo follows the same ceremony. Study `supabase/migrations/20260101002300_budget_requests.sql` before writing SQL: `security definer` + `set search_path = public, extensions, smartgov, pg_temp`, `authenticate(p_session_token)` first, bless via forwarders `create or replace function public.<name>.. as $$ select smartgov.<name>(...)` then `revoke all on function public.<name>...; grant execute ... to anon, authenticated;`. There is **never** a `create policy`. Extend `scripts/check-units.mjs` instead.
- File type allowlist for requirement responses lives in the DB (fixed array) and server (`src/lib/documents.ts` `ALLOWED_EXTENSIONS`).
- Verify every CLI task with the exact commands given. Required overall gates: `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run check:units`.

### Canonical paths to NEW files

- `supabase/migrations/20260101003050_proposal_review_flow.sql`
- `src/components/dashboard/requirement/ProgressStepper.tsx`
- `src/components/dashboard/requirement/ReviewProposalPanel.tsx`
- `src/app/api/proposals/[id]/start-review/route.ts`
- `src/app/api/proposals/[id]/requirements/submit/route.ts`
- `src/app/api/proposals/[id]/requirements/verify/route.ts`
- `src/app/api/files/requirement/[requirementId]/route.ts`

### Canonical paths to MODIFY

- `src/lib/documents.ts` — add `buildRequirementStoragePath`, `ALLOWED_EXTENSIONS` already covers the set.
- `src/app/api/uploads/route.ts` — `claim` action gains a `target === "requirement"` branch.
- `src/app/api/proposals/[id]/review/route.ts` — accept `requirements` array, forward as `p_requirements`.
- `src/lib/auth/messages.ts` — add reason codes if any new DB reason lacks a message.
- `src/lib/auth/rpc.ts` — add param typings if helper signatures are typed (check; likely generic).
- `src/components/dashboard/requirement/types.ts`, `helpers.ts`, `ProposalDetailFlow.tsx`, `ReviewInbox.tsx`, `LsgShell.tsx`, `UsgShell.tsx`.
- `scripts/check-units.mjs` — guard section for `003050`.

### Existing facts the implementer must use

- `smartgov.proposals.status` CHECK now: `('submitted','returned','approved','rejected','published')` (constraint name `proposals_status_check`, created inline — drop by name, re-add).
- `smartgov.reviews.decision` CHECK now: `('approved','returned','rejected')` (constraint name `reviews_decision_check`).
- `smartgov.review_proposal` current definition: `supabase/migrations/20260101002180_rowtype_read_repair.sql:156` (signature `(text, uuid, text, text)`, org-scoped, reviewer-only, reviews the *latest* version, refuses `already_reviewed`, status stays as the previous `submitted`/`returned` verdict). It will be **replaced** with a 5-arg version carrying `p_requirements jsonb default null`.
- `smartgov.proposal_detail` current definition: `supabase/migrations/20260101002150_proposal_detail_exposes_submission_id.sql:4`. Payload: `proposal{..., versions[], reviews[]}`. New payload adds `requirements[]` and `budget`.
- `document_uploads` (20260101002600:68, hardened 20260101002700): `storage_path` PK, `organization_id`, `uploaded_by`, `requirement_item uuid NOT NULL`, `original_name`, `mime_type`, `size_bytes`, `written_bytes default 0`, `large_object_oid`, `confirmed_at`, `proposal_id`; delete trigger `document_uploads_release_object` does `lo_unlink`. Claim/chunk/commit RPCs: `claim_document_upload`, `write_document_chunk(..., p_offset, p_chunk, p_total_bytes)`, `confirm_document_upload(..., p_oid, p_actual_bytes)`, `discard_document_upload` — all keyed on `storage_path`.
- `claim_document_upload` (20260101002600:94) derives everything from the path (`<org>/proposals/<nonce>/v<N>/<itemId>/<name>`) and proves the caller may submit that item: `owner` OR `is_org_reviewer` OR (`program_id is null` OR program `published`). This function is the template for `claim_requirement_upload`; do not reuse it for requirements.
- File-serving pattern: `src/app/api/files/[submissionId]/route.ts` — calls `get_document`, maps `oid` → `readLargeObject`, streams with a `Content-Disposition`. Mirror it for requirements.
- Budget: `smartgov.budget_requests` (20260101002300:21: `proposal_id`, `requested_total`, `approved_total`, `status`, `justification`) and `smartgov.budget_items` (id, `position`, `label`, `quantity`, `unit_cost`, `subtotal` generated). One latest request per proposal (ordered by `created_at desc limit 1`).
- Proposal scope rules (reuse verbatim, from 002150 proposal_detail): viewer ok if `owner` OR `is_org_reviewer` OR `created_by = account` OR `unit_id in lsg_unit_ids(account, org)`.
- Response scope rules (new): author (`created_by`) or officer of the proposal's `unit_id`.
- Reviewer scope: `account_scope = 'owner'` OR `smartgov.is_org_reviewer(account, org)`.

### Checkpoint / lifecycle map (single source of truth for Tasks 9, 12, 15-21)

| status | stepper active node | LSG sees | USG sees |
|---|---|---|---|
| `submitted` | Pending Review (0) | timeline, "withdrawn" no | review BUTTON enabled |
| `under_review` | Under Review (1) | progress, wait message | review panel (require reason/per-req builder) |
| `returned` | Pending Review (0) | resubmit form (existing) | — |
| `rejected` | Responded (2, red chip "Rejected") | reason banner | reason |
| `requirements_requested` | Responded with amber chip "Additional requirements" | respond-to-requirements form | why (the reason from approval) |
| `approved` | Verified (3, green) | success | success |
| `published` | Verified (3, green) | — | — |

---

## PHASE 0 — DATABASE (migration `20260101003050_proposal_review_flow.sql`)

### Task 1: Scaffold migration + extend the two status CHECK constraints

**Files:**
- Create: `supabase/migrations/20260101003050_proposal_review_flow.sql`

**Step 1: Write the opening sections**

```sql
-- 003050 proposal review flow -------------------------------------------------
-- Extends the requirement-submission lifecycle with an explicit review step and
-- an "approved with additional requirements" loop:
--
--   submitted --USG "Review Proposal"--> under_review
--   under_review --USG--> rejected | returned | approved
--   under_review --USG approve + requirements--> requirements_requested
--   requirements_requested --LSG responds per requirement--> under_review
--   under_review --USG accept/waive each--> approved
--
-- No `create policy` in this repository: read/write authority is enforced in the
-- security-definer RPCs, audited by scripts/check-units.mjs.

alter table smartgov.proposals
  drop constraint if exists proposals_status_check;
alter table smartgov.proposals
  add constraint proposals_status_check
  check (status in ('submitted','under_review','returned','requirements_requested','approved','rejected','published'));

alter table smartgov.reviews
  drop constraint if exists reviews_decision_check;
alter table smartgov.reviews
  add constraint reviews_decision_check
  check (decision in ('approved','returned','rejected','requirements'));
```

**Step 2: Apply + audit**

Run: `node scripts/apply-migration.mjs supabase/migrations/20260101003050_proposal_review_flow.sql`
Expected: ends with `applied`.

### Task 2: `proposal_requirements` table + extend `document_uploads`

**Files:**
- Modify: `supabase/migrations/20260101003050_proposal_review_flow.sql` (append)

**Step 1: Append the table**

```sql
-- ----------------------------------------------------------------- requirements

-- One row per "additional requirement" the USG attaches to an approval. An LSG
-- response lands on the row itself (a link, or a document) so the whole response
-- is visible through proposal_detail without a second join shape. States:
--   requested  USG asked for it, LSG has not answered yet;
--   submitted  LSG answered (new proposal version minted);
--   accepted   USG verified the answer (final);
--   waived     USG let this one go (final, no artifact required).
create table if not exists smartgov.proposal_requirements (
  id             uuid primary key default gen_random_uuid(),
  proposal_id    uuid not null references smartgov.proposals (id) on delete cascade,
  version_id     uuid references smartgov.proposal_versions (id) on delete set null,
  created_by     uuid not null references smartgov.accounts (id),
  position       int not null default 0,
  label          text not null check (length(btrim(label)) between 3 and 140),
  detail         text not null default '',
  status         text not null default 'requested'
                 check (status in ('requested','submitted','accepted','waived')),
  -- response artifact: exactly one of {link | file trio} once answered
  link_url       text,
  storage_path   text,
  original_name  text,
  mime_type      text,
  size_bytes     bigint,
  responded_note text,
  responded_by   uuid references smartgov.accounts (id) on delete set null,
  responded_at   timestamptz,
  created_at     timestamptz not null default now(),
  constraint proposal_requirements_artifact check (
    (status = 'requested' and link_url is null and storage_path is null and original_name is null)
    or (
      status in ('submitted','accepted')
      and (
        (link_url is not null and storage_path is null and original_name is null
           and mime_type is null and size_bytes is null)
        or (link_url is null and storage_path is not null and original_name is not null
           and mime_type is not null and size_bytes is not null)
      )
    )
    or status = 'waived'
  )
);

alter table smartgov.proposal_requirements enable row level security;

revoke all on smartgov.proposal_requirements from anon, authenticated;
```

**Step 2: Append the `document_uploads` extension (Option C — one byte store, two targets)**

```sql
-- Requirement-response documents live in the same byte store as item documents.
-- `requirement_item` becomes optional and a sibling `proposal_requirement` column
-- pins a row to its requirement instead; exactly one of the two is ever set. The
-- chunk/commit/abort RPCs are keyed on storage_path, so they need no change.

alter table smartgov.document_uploads
  alter column requirement_item drop not null;

alter table smartgov.document_uploads
  add column if not exists proposal_requirement uuid
  references smartgov.proposal_requirements (id) on delete cascade;

alter table smartgov.document_uploads
  drop constraint if exists document_uploads_target_check;
alter table smartgov.document_uploads
  add constraint document_uploads_target_check
  check ((requirement_item is null) <> (proposal_requirement is null));

create index if not exists document_uploads_requirement_idx
  on smartgov.document_uploads (proposal_requirement)
  where proposal_requirement is not null;
```

**Step 3: Apply + audit**

Run: `node scripts/apply-migration.mjs supabase/migrations/20260101003050_proposal_review_flow.sql`
Expected: ends with `applied`.

### Task 3: `start_proposal_review` RPC (the "Review Proposal" button)

**Files:**
- Modify: `supabase/migrations/20260101003050_proposal_review_flow.sql` (append)

**Step 1: Append**

```sql
-- ------------------------------------------------- review actions

-- The explicit "start reviewing" step. Cheap to reason about: the review panel
-- does not open until the reviewer has pressed it, and `review_proposal` then
-- knows the proposal is truly under review rather than still pending. Idempotent:
-- already-under-review reads as success.
create or replace function smartgov.start_proposal_review(
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
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.account_scope <> 'owner'
     and not smartgov.is_org_reviewer(v_account.id, v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if not smartgov.consume_rate_limit(
       'proposal:review:' || v_account.id::text, 40, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  select pr.id, pr.status
    into v_proposal.id, v_proposal.status
    from smartgov.proposals pr
   where pr.id = p_proposal_id
     and pr.organization_id = v_account.organization_id
   for update;

  if v_proposal.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_proposal');
  end if;

  if v_proposal.status = 'under_review' then
    return jsonb_build_object('ok', true, 'proposalId', v_proposal.id, 'status', 'under_review');
  end if;

  if v_proposal.status <> 'submitted' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  update smartgov.proposals
     set status = 'under_review'
   where id = v_proposal.id;

  return jsonb_build_object('ok', true, 'proposalId', v_proposal.id, 'status', 'under_review');
end;
$$;

revoke all on function smartgov.start_proposal_review(text, uuid) from public;

create or replace function public.start_proposal_review(p_session_token text, p_proposal_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.start_proposal_review(p_session_token, p_proposal_id); $$;
revoke all on function public.start_proposal_review(text, uuid) from public;
grant execute on function public.start_proposal_review(text, uuid) to anon, authenticated;
```

**Step 2: Apply + audit.**

### Task 4: `claim_requirement_upload` + `match_proposal_requirement` RPCs

**Files:**
- Modify: `supabase/migrations/20260101003050_proposal_review_flow.sql` (append)

**Step 1: Append**

```sql
-- A response document is reserved the same way an item document is, but against a
-- proposal_requirement instead of a requirement_item. Everything is derived from
-- the path (`<org>/proposals/<nonce>/reqs/v<N>/<requirementId>/<name>`), so a
-- caller can only ever land a file under their own organization. Only an *open*
-- requirement (`requested`) inside a `requirements_requested` proposal of the
-- caller's unit/ authorship may be claimed.

create or replace function smartgov.match_proposal_requirement(
  p_session_token text,
  p_proposal_id   uuid,
  p_requirement   uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return false;
  end if;

  return exists (
    select 1
      from smartgov.proposal_requirements r
      join smartgov.proposals p on p.id = r.proposal_id
     where r.id = p_requirement
       and p.id = p_proposal_id
       and p.organization_id = v_account.organization_id
       and p.status = 'requirements_requested'
       and r.status = 'requested'
       and (
         p.created_by = v_account.id
         or (p.unit_id is not null and p.unit_id in (
               select u from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u
             ))
       )
  );
end;
$$;

revoke all on function smartgov.match_proposal_requirement(text, uuid, uuid) from public;

create or replace function public.match_proposal_requirement(p_session_token text, p_proposal_id uuid, p_requirement uuid)
returns boolean language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.match_proposal_requirement(p_session_token, p_proposal_id, p_requirement); $$;
revoke all on function public.match_proposal_requirement(text, uuid, uuid) from public;
grant execute on function public.match_proposal_requirement(text, uuid, uuid) to anon, authenticated;

create or replace function smartgov.claim_requirement_upload(
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
  v_org     uuid;
  v_frag    uuid;
  v_version int;
  v_req_id  uuid;
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

  v_org := nullif(split_part(p_storage_path, '/', 1), '')::uuid;

  if v_org is null or v_org <> v_account.organization_id then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  v_frag    := nullif(substring(p_storage_path from '^[^/]+/proposals/([^/]+)/reqs/v[0-9]+/'), '');
  v_version := substring(p_storage_path from '^[^/]+/proposals/[^/]+/reqs/v([0-9]+)/')::int;
  v_req_id  := nullif(substring(p_storage_path from '^[^/]+/proposals/[^/]+/reqs/v[0-9]+/([^/]+)/'), '')::uuid;

  if v_frag is null or v_version is null or v_req_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if p_storage_path <> v_account.organization_id::text || '/proposals/'
                       || v_frag::text || '/reqs/v' || v_version || '/'
                       || v_req_id::text || '/' || p_original_name then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if v_version < 1 or v_version > 50 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if not exists (
    select 1
      from smartgov.proposal_requirements r
      join smartgov.proposals p on p.id = r.proposal_id
     where r.id = v_req_id
       and p.organization_id = v_account.organization_id
       and p.status = 'requirements_requested'
       and r.status = 'requested'
       and (
         p.created_by = v_account.id
         or (p.unit_id is not null and p.unit_id in (
               select u from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u
             ))
       )
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_ext := lower(substring(p_original_name from '[^.]+$'));

  if not (v_ext = any(array['pdf','jpeg','jpg','png','webp','doc','docx','xls','xlsx','zip'])) then
    return jsonb_build_object('ok', false, 'reason', 'unsupported_file_type');
  end if;

  if exists (select 1 from smartgov.document_uploads d where d.storage_path = p_storage_path) then
    return jsonb_build_object('ok', false, 'reason', 'already_uploaded');
  end if;

  insert into smartgov.document_uploads (
    storage_path, organization_id, uploaded_by, proposal_requirement,
    original_name, mime_type, size_bytes
  ) values (
    p_storage_path, v_account.organization_id, v_account.id, v_req_id,
    p_original_name, coalesce(nullif(btrim(p_mime_type), ''), 'application/octet-stream'),
    p_size_bytes
  );

  return jsonb_build_object('ok', true, 'storagePath', p_storage_path);
end;
$$;

revoke all on function smartgov.claim_requirement_upload(text, text, text, text, bigint) from public;

create or replace function public.claim_requirement_upload(p_session_token text, p_storage_path text, p_original_name text, p_mime_type text, p_size_bytes bigint)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.claim_requirement_upload(p_session_token, p_storage_path, p_original_name, p_mime_type, p_size_bytes); $$;
revoke all on function public.claim_requirement_upload(text, text, text, text, bigint) from public;
grant execute on function public.claim_requirement_upload(text, text, text, text, bigint) to anon, authenticated;
```

**Step 2: Apply + audit.**

### Task 5: Extend `review_proposal` to carry `p_requirements`

**Files:**
- Modify: `supabase/migrations/20260101003050_proposal_review_flow.sql` (append)

**Step 1: Append the redefinition (replaces the 002180 body; forwarders regranted)**

Behavior table (the exact contract the UI is built against):
- `rejected` → status `rejected`, review row `decision='rejected'`, **remark required**.
- `returned` → status `returned`, review row `decision='returned'`, remark required.
- `approved` with an empty/absent `p_requirements` → status `approved`, review row `decision='approved'`.
- `approved` with a non-empty `p_requirements` array → status `requirements_requested`, review row `decision='requirements'`, one `proposal_requirements` row per entry on the reviewed version.
- `p_requirements` on any non-`approved` decision → `invalid_request`.

```sql
create or replace function smartgov.review_proposal(
  p_session_token text,
  p_proposal_id   uuid,
  p_decision      text,
  p_remark        text,
  p_requirements  jsonb default null
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
  v_reqs    jsonb;
  v_i       int;
  v_label   text;
  v_detail  text;
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

  v_reqs := p_requirements;
  if v_reqs is null or jsonb_typeof(v_reqs) <> 'array' then
    v_reqs := jsonb '[]';
  end if;

  if p_decision <> 'approved' and jsonb_array_length(v_reqs) > 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  -- Validation before any write, so a malformed requirement list cannot leave a
  -- partial approval behind.
  for v_i in 0 .. jsonb_array_length(v_reqs) - 1 loop
    v_label := btrim(coalesce(v_reqs->v_i->>'label', ''));
    v_detail := btrim(coalesce(v_reqs->v_i->>'detail', ''));
    if length(v_label) < 3 or length(v_label) > 140 or length(v_detail) > 1000 then
      return jsonb_build_object('ok', false, 'reason', 'invalid_request');
    end if;
  end loop;

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

  -- Legacy path (review straight from `submitted`) stays valid; the UI always
  -- starts the review first, but existing clients may still call directly.
  if v_proposal.status not in ('submitted','under_review') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
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

  if p_decision = 'approved' and jsonb_array_length(v_reqs) > 0 then
    insert into smartgov.reviews (
      proposal_id, version_id, decided_by, decision, remark
    ) values (
      v_proposal.id, v_ver_id, v_account.id, 'requirements',
      nullif(btrim(p_remark), '')
    );

    update smartgov.proposals
       set status = 'requirements_requested'
     where id = v_proposal.id;

    for v_i in 0 .. jsonb_array_length(v_reqs) - 1 loop
      insert into smartgov.proposal_requirements (
        proposal_id, version_id, created_by, position, label, detail
      ) values (
        v_proposal.id, v_ver_id, v_account.id, v_i + 1,
        btrim(v_reqs->v_i->>'label'),
        btrim(coalesce(v_reqs->v_i->>'detail', ''))
      );
    end loop;

    return jsonb_build_object(
      'ok', true, 'proposalId', v_proposal.id, 'status', 'requirements_requested',
      'version', v_ver, 'requirementCount', jsonb_array_length(v_reqs)
    );
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

revoke all on function smartgov.review_proposal(text, uuid, text, text, jsonb) from public;

create or replace function public.review_proposal(p_session_token text, p_proposal_id uuid, p_decision text, p_remark text, p_requirements jsonb default null)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.review_proposal(p_session_token, p_proposal_id, p_decision, p_remark, p_requirements); $$;
revoke all on function public.review_proposal(text, uuid, text, text, jsonb) from public;
grant execute on function public.review_proposal(text, uuid, text, text, jsonb) to anon, authenticated;
```

**Step 2: Apply + audit.** NOTE: the audit (`check-units.mjs`) checks the old 4-arg `review_proposal` signature — this section must be mirrored in the guard (Task 22). Apply is fine.

### Task 6: `submit_requirement_response` RPC (the loop back to LSG)

**Files:**
- Modify: `supabase/migrations/20260101003050_proposal_review_flow.sql` (append)

**Step 1: Append**

Contract: only while status `requirements_requested`; caller is the author or an officer of the proposal's unit; every `requested` requirement must be answered in one call; file responses must reference a **confirmed** reserved document (from `claim_requirement_upload`) that the caller reserved; creates the next proposal version; flips to `under_review`.

```sql
create or replace function smartgov.submit_requirement_response(
  p_session_token text,
  p_proposal_id   uuid,
  p_note          text,
  p_items         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_prop    uuid;
  v_unit    uuid;
  v_author  uuid;
  v_status  text;
  v_new_ver uuid;
  v_next    int;
  v_i       int;
  v_req     uuid;
  v_kind    text;
  v_sp      text;
  v_on      text;
  v_mt      text;
  v_sz      bigint;
  v_lu      text;
  v_open    int;
  v_seen    uuid[];
  v_count   int := 0;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if not smartgov.consume_rate_limit(
       'proposal:response:' || v_account.id::text, 30, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  select pr.id, pr.unit_id, pr.created_by, pr.status
    into v_prop, v_unit, v_author, v_status
    from smartgov.proposals pr
   where pr.id = p_proposal_id
     and pr.organization_id = v_account.organization_id
   for update;

  if v_prop is null then
    return jsonb_build_object('ok', false, 'reason', 'no_proposal');
  end if;

  if v_status <> 'requirements_requested' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if not (v_author = v_account.id
          or (v_unit is not null and v_unit in (
                select u from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u
              ))) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- Pass 1: validate each entry against an open, owned requirement.
  for v_i in 0 .. jsonb_array_length(p_items) - 1 loop
    v_req  := nullif(p_items->v_i->>'requirementId', '')::uuid;
    v_kind := p_items->v_i->>'kind';
    v_sp   := nullif(p_items->v_i->>'storagePath', '');
    v_on   := nullif(p_items->v_i->>'originalName', '');
    v_mt   := nullif(p_items->v_i->>'mimeType', '');
    v_sz   := (p_items->v_i->>'sizeBytes')::bigint;
    v_lu   := nullif(p_items->v_i->>'linkUrl', '');

    if v_req is null or v_seen @> array[v_req] then
      return jsonb_build_object('ok', false, 'reason', 'invalid_request');
    end if;

    if v_kind not in ('file','link') then
      return jsonb_build_object('ok', false, 'reason', 'invalid_request');
    end if;

    if not exists (
      select 1 from smartgov.proposal_requirements r
       where r.id = v_req and r.proposal_id = v_prop and r.status = 'requested'
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_request');
    end if;

    if v_kind = 'file' then
      -- Must be a fully-confirmed reservation this caller made for THIS requirement.
      if v_sp is null
         or not exists (
           select 1 from smartgov.document_uploads d
            where d.storage_path = v_sp
              and d.proposal_requirement = v_req
              and d.uploaded_by = v_account.id
              and d.confirmed_at is not null
              and d.large_object_oid is not null
         ) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_request');
      end if;
    else
      if v_lu is null
         or length(v_lu) > 2000
         or position(' ' in v_lu) > 0 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_request');
      end if;
    end if;

    v_seen := v_seen || v_req;
  end loop;

  -- Every open requirement must be answered in this one call.
  v_open := (select count(*) from smartgov.proposal_requirements r
              where r.proposal_id = v_prop and r.status = 'requested');

  if v_open <> card(array_length(v_seen, 1)) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_next := coalesce((select max(version_number) from smartgov.proposal_versions pv
                       where pv.proposal_id = v_prop), 0) + 1;

  insert into smartgov.proposal_versions (
    proposal_id, version_number, submitted_by, submission_note
  ) values (
    v_prop, v_next, v_account.id, btrim(coalesce(p_note, ''))
  ) returning id into v_new_ver;

  -- Pass 2: persist artifacts (validation passed, so nothing can fail here).
  for v_i in 0 .. jsonb_array_length(p_items) - 1 loop
    v_req  := (p_items->v_i->>'requirementId')::uuid;
    v_kind := p_items->v_i->>'kind';
    v_sp   := nullif(p_items->v_i->>'storagePath', '');
    v_on   := nullif(p_items->v_i->>'originalName', '');
    v_mt   := nullif(p_items->v_i->>'mimeType', '');
    v_sz   := (p_items->v_i->>'sizeBytes')::bigint;
    v_lu   := nullif(p_items->v_i->>'linkUrl', '');

    if v_kind = 'file' then
      update smartgov.proposal_requirements
         set status = 'submitted',
             version_id = v_new_ver,
             storage_path = v_sp,
             original_name = v_on,
             mime_type = v_mt,
             size_bytes = v_sz,
             responded_by = v_account.id,
             responded_at = now()
       where id = v_req;

      -- Bind the reserved bytes to this proposal so delete cascades still collect
      -- them (mirrors `bind_document_to_proposal` for item documents).
      update smartgov.document_uploads
         set proposal_id = v_prop
       where storage_path = v_sp
         and proposal_id is null;
    else
      update smartgov.proposal_requirements
         set status = 'submitted',
             version_id = v_new_ver,
             link_url = v_lu,
             storage_path = null,
             original_name = null,
             mime_type = null,
             size_bytes = null,
             responded_by = v_account.id,
             responded_at = now()
       where id = v_req;
    end if;

    v_count := v_count + 1;
  end loop;

  update smartgov.proposals
     set status = 'under_review'
   where id = v_prop;

  return jsonb_build_object(
    'ok', true, 'proposalId', v_prop, 'status', 'under_review',
    'version', v_next, 'answered', v_count
  );
end;
$$;

revoke all on function smartgov.submit_requirement_response(text, uuid, text, jsonb) from public;

create or replace function public.submit_requirement_response(p_session_token text, p_proposal_id uuid, p_note text, p_items jsonb)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.submit_requirement_response(p_session_token, p_proposal_id, p_note, p_items); $$;
revoke all on function public.submit_requirement_response(text, uuid, text, jsonb) from public;
grant execute on function public.submit_requirement_response(text, uuid, text, jsonb) to anon, authenticated;
```

**Step 2: Apply + audit.** (If the applied server does not know `card(array_length(...))`, replace with `v_open <> coalesce(array_length(v_seen, 1), 0)` and note it in the file.)

### Task 7: `verify_proposal_requirements` RPC (accept/waive → approved)

**Files:**
- Modify: `supabase/migrations/20260101003050_proposal_review_flow.sql` (append)

**Step 1: Append**

Contract: reviewer-only; while status `under_review`; `p_decisions` is an array of `{requirementId, decision: accepted|waived, note}`; **every `submitted` requirement must be decided** in the call; once no requirement is `requested`/`submitted`, the latest response version is sealed `approved` (review row on that version).

```sql
create or replace function smartgov.verify_proposal_requirements(
  p_session_token text,
  p_proposal_id   uuid,
  p_decisions     jsonb,
  p_remark        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_prop    uuid;
  v_status  text;
  v_ver_id  uuid;
  v_ver     int;
  v_i       int;
  v_req     uuid;
  v_dec     text;
  v_note    text;
  v_left    int;
  v_seen    uuid[];
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.account_scope <> 'owner'
     and not smartgov.is_org_reviewer(v_account.id, v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if jsonb_typeof(p_decisions) <> 'array' or jsonb_array_length(p_decisions) < 1 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if not smartgov.consume_rate_limit(
       'proposal:review:' || v_account.id::text, 40, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  select pr.id, pr.status
    into v_prop, v_status
    from smartgov.proposals pr
   where pr.id = p_proposal_id
     and pr.organization_id = v_account.organization_id
   for update;

  if v_prop is null then
    return jsonb_build_object('ok', false, 'reason', 'no_proposal');
  end if;

  if v_status <> 'under_review' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  -- Validate every decision against a requirement that is actually awaiting a
  -- verdict, then apply.
  for v_i in 0 .. jsonb_array_length(p_decisions) - 1 loop
    v_req  := nullif(p_decisions->v_i->>'requirementId', '')::uuid;
    v_dec  := p_decisions->v_i->>'decision';
    v_note := btrim(coalesce(p_decisions->v_i->>'note', ''));

    if v_req is null or v_seen @> array[v_req]
       or v_dec not in ('accepted','waived') then
      return jsonb_build_object('ok', false, 'reason', 'invalid_request');
    end if;

    if not exists (
      select 1 from smartgov.proposal_requirements r
       where r.id = v_req and r.proposal_id = v_prop and r.status = 'submitted'
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_request');
    end if;

    update smartgov.proposal_requirements
       set status = v_dec,
           responded_note = case when v_note = '' then responded_note else v_note end
     where id = v_req;

    v_seen := v_seen || v_req;
  end loop;

  -- Every submitted requirement must have been decided; the reviewer cannot leave
  -- the proposal half-verified.
  if exists (
    select 1 from smartgov.proposal_requirements r
     where r.proposal_id = v_prop and r.status = 'submitted'
       and not (r.id = any(v_seen))
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_left := (select count(*) from smartgov.proposal_requirements r
              where r.proposal_id = v_prop and r.status in ('requested','submitted'));

  if v_left > 0 then
    return jsonb_build_object('ok', true, 'proposalId', v_prop, 'status', 'under_review');
  end if;

  select pv.id, pv.version_number into v_ver_id, v_ver
    from smartgov.proposal_versions pv
   where pv.proposal_id = v_prop
   order by pv.version_number desc
   limit 1;

  insert into smartgov.reviews (
    proposal_id, version_id, decided_by, decision, remark
  ) values (
    v_prop, v_ver_id, v_account.id, 'approved', nullif(btrim(p_remark), '')
  );

  update smartgov.proposals
     set status = 'approved'
   where id = v_prop;

  return jsonb_build_object('ok', true, 'proposalId', v_prop, 'status', 'approved', 'version', v_ver);
end;
$$;

revoke all on function smartgov.verify_proposal_requirements(text, uuid, jsonb, text) from public;

create or replace function public.verify_proposal_requirements(p_session_token text, p_proposal_id uuid, p_decisions jsonb, p_remark text default null)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.verify_proposal_requirements(p_session_token, p_proposal_id, p_decisions, p_remark); $$;
revoke all on function public.verify_proposal_requirements(text, uuid, jsonb, text) from public;
grant execute on function public.verify_proposal_requirements(text, uuid, jsonb, text) to anon, authenticated;
```

**Step 2: Apply + audit.**

### Task 8: `get_requirement_file` RPC (scoped download gate)

**Files:**
- Modify: `supabase/migrations/20260101003050_proposal_review_flow.sql` (append)

**Step 1: Append** — mirror of the `get_document` gate (20260101002600:326 area reads it): only author / unit / reviewer may open the bytes, and only once the confirmation is sealed.

```sql
create or replace function smartgov.get_requirement_file(
  p_session_token text,
  p_requirement   uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_req     smartgov.proposal_requirements%rowtype;
  v_prop_org   uuid;
  v_prop_unit  uuid;
  v_prop_author uuid;
  v_doc     bigint;
  v_ok      boolean;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select r.*, p.organization_id, p.unit_id, p.created_by
    into v_req, v_prop_org, v_prop_unit, v_prop_author
    from smartgov.proposal_requirements r
    join smartgov.proposals p on p.id = r.proposal_id
   where r.id = p_requirement
     and p.organization_id = v_account.organization_id;

  if v_req.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_req.storage_path is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_ok := v_account.account_scope = 'owner'
       or smartgov.is_org_reviewer(v_account.id, v_account.organization_id)
       or v_prop_author = v_account.id
       or (v_prop_unit is not null and v_prop_unit in (
             select u from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u
           ));

  if not v_ok then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select d.large_object_oid into v_doc
    from smartgov.document_uploads d
   where d.storage_path = v_req.storage_path
     and d.confirmed_at is not null
     and d.large_object_oid is not null;

  if v_doc is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'oid', v_doc,
    'originalName', v_req.original_name,
    'mimeType', v_req.mime_type,
    'sizeBytes', v_req.size_bytes
  );
end;
$$;

revoke all on function smartgov.get_requirement_file(text, uuid) from public;

create or replace function public.get_requirement_file(p_session_token text, p_requirement uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.get_requirement_file(p_session_token, p_requirement); $$;
revoke all on function public.get_requirement_file(text, uuid) from public;
grant execute on function public.get_requirement_file(text, uuid) to anon, authenticated;
```

**Step 2: Apply + audit.**

### Task 9: Extend `proposal_detail` with `requirements` + `budget`

**Files:**
- Modify: `supabase/migrations/20260101003050_proposal_review_flow.sql` (append)

**Step 1: Append** — redefinition of the 002150 body adding two keys to the `proposal{...}` object (see the map in Working context). Insert right after the `reviews` block inside `jsonb_build_object`:

```sql
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
              'submissionId', isub.id,
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
      ), jsonb '[]'),
      'requirements', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r.id,
          'label', r.label,
          'detail', r.detail,
          'status', r.status,
          'linkUrl', r.link_url,
          'storagePath', r.storage_path,
          'originalName', r.original_name,
          'mimeType', r.mime_type,
          'sizeBytes', r.size_bytes,
          'respondedNote', r.responded_note,
          'respondedBy', (select a3.display_name from smartgov.accounts a3 where a3.id = r.responded_by),
          'respondedAt', r.responded_at,
          'versionNumber', (select pv3.version_number from smartgov.proposal_versions pv3 where pv3.id = r.version_id),
          'position', r.position
        ) order by r.position)
        from smartgov.proposal_requirements r
        where r.proposal_id = v_proposal.id
      ), jsonb '[]'),
      'budget', (select jsonb_build_object(
          'id', br.id,
          'title', br.title,
          'justification', br.justification,
          'status', br.status,
          'requestedTotal', br.requested_total,
          'approvedTotal', br.approved_total,
          'items', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', bi.id,
              'label', bi.label,
              'quantity', bi.quantity,
              'unitCost', bi.unit_cost,
              'subtotal', bi.subtotal
            ) order by bi.position)
            from smartgov.budget_items bi
            where bi.budget_request_id = br.id
          ), jsonb '[]')
        )
        from smartgov.budget_requests br
        where br.proposal_id = v_proposal.id
        order by br.created_at desc
        limit 1)
    )
  );
end;
$$;

revoke all on function smartgov.proposal_detail(text, uuid) from public;

create or replace function public.proposal_detail(p_session_token text, p_proposal_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.proposal_detail(p_session_token, p_proposal_id); $$;
revoke all on function public.proposal_detail(text, uuid) from public;
grant execute on function public.proposal_detail(text, uuid) to anon, authenticated;
```

**Step 2: Apply + audit.**

### Task 10: Final apply + full audit + guard in `check-units.mjs`

**Files:**
- Modify: `scripts/check-units.mjs`

**Step 1: Re-apply cleanly (idempotency check)**

Run: `node scripts/apply-migration.mjs supabase/migrations/20260101003050_proposal_review_flow.sql`
Expected: `applied` (or `already applied`), no error.

**Step 2: Add the audit guard.** Open `scripts/check-units.mjs`, find the section that audits `20260101002300` (budget) — read the whole file first (`Read`) and mirror its shape for a new `003050` section asserting: the two altered CHECK constraints, `proposal_requirements` table present + RLS + revoked, `document_uploads.proposal_requirement` column + target check, and every new/changed function existing in both `smartgov.` and `public.` with grants to `anon, authenticated` — including the 5-arg `review_proposal`. **IMPORTANT:** the guard must accept the *new* `review_proposal(text, uuid, text, text, jsonb)` signature and the new forwarder, so update the existing `review_proposal` entry rather than adding a conflicting one.

**Step 3: Run the audit**

Run: `npm run check:units`
Expected: PASS (no new violations).

---

## PHASE 1 — API ROUTES

### Task 11: `start-review` route

**Files:**
- Create: `src/app/api/proposals/[id]/start-review/route.ts`

**Step 1: Write the handler** (mirror `src/app/api/proposals/[id]/review/route.ts` structure — read it first):

```typescript
import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const { id } = await ctx.params;

  try {
    const res = await callRpc<RpcResult & { status?: string }>("start_proposal_review", {
      p_session_token: token,
      p_proposal_id: id,
    });

    if (!res.ok) {
      const statusCode = res.reason === "forbidden" ? 403 : res.reason === "no_proposal" ? 404 : 400;
      return NextResponse.json({ ok: false, message: messageFor(res.reason) }, { status: statusCode });
    }

    return NextResponse.json({ ok: true, status: res.status });
  } catch (error) {
    console.error("[proposals:start-review]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}
```

**Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: clean.

### Task 12: Extend the `review` route with `requirements`

**Files:**
- Modify: `src/app/api/proposals/[id]/review/route.ts`

**Step 1: Read the current route, then extend the body parse to forward `requirements`.** Pass `p_requirements: (body.requirements ?? null)` into the `review_proposal` call, typed as `unknown[] | null` (shape `{ label: string; detail?: string }[]`). Keep all existing error mapping; add 403 handling exactly as Task 11.

**Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: clean.

### Task 13: `requirements/submit` route

**Files:**
- Create: `src/app/api/proposals/[id]/requirements/submit/route.ts`

**Step 1: Write the handler** — `POST` body `{ items: RequirementResponseItem[]; note?: string }`, where item = `{ requirementId, kind: "file" | "link", storagePath?, originalName?, mimeType?, sizeBytes?, linkUrl? }`. Validate, then call `submit_requirement_response(p_session_token, p_proposal_id, p_note, p_items)`; map statuses like Task 11. Return `{ ok, status, version, answered }`.

**Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: clean.

### Task 14: `requirements/verify` route

**Files:**
- Create: `src/app/api/proposals/[id]/requirements/verify/route.ts`

**Step 1: Write the handler** — `POST` body `{ decisions: { requirementId, decision: "accepted" | "waived", note? }[]; remark? }`. Call `verify_proposal_requirements(p_session_token, p_proposal_id, p_decisions, p_remark)`. Map statuses like Task 11.

**Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: clean.

### Task 15: Upload route claim branch + path builder

**Files:**
- Modify: `src/lib/documents.ts`
- Modify: `src/app/api/uploads/route.ts`

**Step 1: Add the builder** to `documents.ts` (after `buildStoragePath`):

```typescript
/** Storage path for a requirement-response document; claim_requirement_upload
 *  parses exactly this shape. `version` is the next proposal version the LSG will
 *  create when it submits the response. */
export function buildRequirementStoragePath(args: {
  organizationId: string;
  nonce: string;
  requirementId: string;
  version: number;
  fileName: string;
}): string {
  const { organizationId, nonce, requirementId, version, fileName } = args;
  return `${organizationId}/proposals/${nonce}/reqs/v${version}/${requirementId}/${fileName}`;
}
```

**Step 2: Extend `route.ts` `claim` action.** Read `body.target`. When `body.target === "requirement"`, require `body.requirementId` (UUID_RE test), call `buildRequirementStoragePath`, RPC `claim_requirement_upload`, else the existing `claim_document_upload` path unchanged. Both branches share the rest of the response shape.

**Step 3: Verify**

Run: `npx tsc --noEmit` then `npm run lint`
Expected: both clean.

### Task 16: `files/requirement/[requirementId]` route

**Files:**
- Create: `src/app/api/files/requirement/[requirementId]/route.ts`

**Step 1: Copy `src/app/api/files/[submissionId]/route.ts`**, renaming the RPC to `get_requirement_file` with `p_requirement` and the param to `requirementId`. Stream `readLargeObject(res.oid)` identically.

**Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: clean.

---

## PHASE 2 — UI

### Task 17: Types + status labels

**Files:**
- Modify: `src/components/dashboard/requirement/types.ts`
- Modify: `src/components/dashboard/requirement/helpers.ts`

**Step 1: Extend `types.ts`:**
- `ProposalsListRow["status"]` and `ProposalDetail["status"]` → add `"under_review" | "requirements_requested"`.
- `ProposalDetail["reviews"][number]["decision"]` → add `"requirements"`.
- Add `ProposalRequirement` type and fields on `ProposalDetail`: `requirements: ProposalRequirement[]` and `budget?: { id: string; title: string; justification: string; status: string; requestedTotal: number; approvedTotal: number | null; items: Array<{ id: string; label: string; quantity: number; unitCost: number; subtotal: number }> }`.
- Add `REQUIREMENT_STATUS_LABEL` / `REQUIREMENT_STATUS_TONE` map exported for chips.

**Step 2: Extend `helpers.ts`:**
- `statusLabel`: add `"under_review" → "Under review"`, `"requirements_requested" → "Additional requirements"`.
- Add `statusTone(status): "neutral" | "info" | "warning" | "success" | "danger"` returning `submitted → info`, `under_review → info`, `returned → warning`, `requirements_requested → warning`, `rejected → danger`, `approved → success`, `published → success`.
- Add `formatMoney(n)` (PHP, `Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" })`).

**Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: clean. Surface every usage site of `ProposalsListRow["status"]` switch that now needs the new cases (TS exhaustiveness will point them out; fix them).

### Task 18: `ProgressStepper.tsx`

**Files:**
- Create: `src/components/dashboard/requirement/ProgressStepper.tsx`

**Step 1: Write the component.** Props: `{ status: ProposalDetail["status"] }`. Four nodes: `Pending Review`, `Under Review`, `Responded`, `Verified`. Active index per the map in Working context (submitted/returned→0; under_review→1; rejected/requirements_requested→2—with chip; approved/published→3). Render outcome chips: `rejected` → red "Rejected", `requirements_requested` → amber "Additional requirements", `approved` → green "Approved". Accessible: `role="list"`, stepper nodes as list items with `aria-current="step"` on the active one. Tailwind only, matching the existing card styling in this folder.

**Step 2: Verify**

Run: `npx tsc --noEmit`, `npm run lint`
Expected: both clean.

### Task 19: `ReviewProposalPanel.tsx`

**Files:**
- Create: `src/components/dashboard/requirement/ReviewProposalPanel.tsx`

**Step 1: Write the component.** Props: `{ proposal: ProposalDetail; onDone(): void }`. Three sections:
1. **Lifecycle + budget**: `ProgressStepper`, latest version's submitted items (file → link to `/api/files/[submissionId]`, link → external), the `budget` card with each `items` row `label`, `quantity × unitCost`, `subtotal`, and the `requestedTotal`.
2. **Decision bar** (visible when status is `under_review` or `submitted`): three buttons — **Reject** (opens textarea, required), **Approve** (direct call, informs if requirements exist), **Approve + Requirements** (toggles a per-row `{ label, detail }` editor; **Send** button enabled only when ≥1 non-empty label). All call `fetch` to `/api/proposals/[id]/review` (or `start-review` first when `submitted`, then review).
3. **Verification** (visible when status is `under_review` and `requirements.some(r => r.status === "submitted")`): list each submitted requirement with its artifact (link or `/api/files/requirement/[requirementId]`), and **Accept** / **Waive** toggle + optional note, then **Finish verification** → `/api/proposals/[id]/requirements/verify` with one decision per submitted requirement (required — the RPC refuses partial).

**Step 2: Verify**

Run: `npx tsc --noEmit`, `npm run lint`
Expected: both clean.

### Task 20: `ReviewInbox` + `LsgShell`/`UsgShell` wiring

**Files:**
- Modify: `src/components/dashboard/requirement/ReviewInbox.tsx`
- Modify: `src/components/dashboard/requirement/UsgShell.tsx`
- Modify: `src/components/dashboard/requirement/LsgShell.tsx`

**Step 1: `ReviewInbox`** — read the file; for `under_review` rows render an amber "Under review" chip (statusTone) and, for USG reviewers only, a **Review proposal** button that opens the detail with the review panel focused (reuse the existing "open detail" callback; if none exists, add one that sets a selected proposal in the shell). Add chip tones everywhere `statusLabel` is used.

**Step 2: `LsgShell`** — for a detail with status `requirements_requested`, render `ProgressStepper` + a **Respond to requirements** section: one row per `requested` requirement (label, detail, and a file/link input). File input uploads through the existing client helper (the one `ProposalForm` uses) with `target: "requirement"` + `requirementId` + next version, then submit all via `/api/proposals/[id]/requirements/submit`. Show `responded`/`accepted`/`waived` artifacts read-only after response.

**Step 3: `UsgShell`** — render `ProgressStepper` for every detail and mount `ReviewProposalPanel` for reviewer-visible statuses; keep the existing detail rendering.

**Step 4: Verify**

Run: `npx tsc --noEmit`, `npm run lint`
Expected: both clean.

### Task 21: `ProposalDetailFlow` + `messages.ts`

**Files:**
- Modify: `src/components/dashboard/requirement/ProposalDetailFlow.tsx`
- Modify: `src/lib/auth/messages.ts`

**Step 1: `ProposalDetailFlow`** — read the file; add `ProgressStepper` at the top (deriving status), surface the decision reason you need from the latest `reviews` entry (`rejected`/`returned`/`requirements` show `remark`), and ensure the `ProposalForm`-based resubmit path still works for `returned`.

**Step 2: `messages.ts`** — read it; confirm every reason code used by the new RPCs already maps (`unauthenticated`, `rate_limited`, `forbidden`, `invalid_request`, `no_proposal`, `already_reviewed`, `unsupported_file_type`, `already_uploaded`, `retry`, `no_organization`). Add any that are missing with a plain-English sentence.

**Step 3: Verify**

Run: `npx tsc --noEmit`, `npm run lint`
Expected: both clean.

---

## PHASE 3 — VERIFICATION + DEPLOY

### Task 22: Full gate + live smoke test + commit

**Step 1: Run the full gate**

Run: `npm run lint; npx tsc --noEmit; npm run build; npm run check:units`
Expected: all four pass.

**Step 2: Live smoke test (after `git push` if user requested deploy).** Against `https://sgov.vercel.app` (or `next dev` if env vars are present locally): sign in as a unit officer → create proposal + budget → USG sees it → start review → under_review → approve+2 requirements → LSG sees `requirements_requested` → respond (1 link + 1 file upload) → `under_review` again → USG verifies accept/waive → `approved`. Also reject path (rejected with reason), and verify the `already_reviewed` guard.

**Step 3: Commit** (only when the user asks): commit the migration, all routes/components, and the check-units guard with a short imperative message (repo style, no prefixes).

---

## Completion criteria

- Statuses `under_review` and `requirements_requested` flow end-to-end with correct permissions and zero RLS bypass.
- Additional requirements loop works: request → respond (file/link) → verify → approved.
- All four gates pass; `check:units` recognises the new migration with no violations.
- No `create policy` anywhere; all authority in security-definer RPCs.