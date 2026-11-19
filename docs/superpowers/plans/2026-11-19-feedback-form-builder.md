# Feedback Form Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Google-Forms-style feedback form builder to the existing Feedback tab, with USG/LSG creation, audience targeting, public and signed-in responses, response review, acknowledgment, and CSV export.

**Architecture:** Add a separate feedback-form layer beside the existing `feedback_entries` direct-message system. New tables are reachable only through `SECURITY DEFINER` RPCs and their controlled `public` wrappers; route handlers validate with Zod and call typed helpers; the Manage Feedback tab hosts four sub-tabs: Forms, Responses, Answer, Direct messages.

**Tech Stack:** Next.js 16.3.6 App Router, React 19.2.8, TypeScript, Zod 4, Supabase/Postgres RPCs, Tailwind, Playwright-based `scripts/*.mjs` gates.

**Spec:** `docs/superpowers/specs/2026-11-19-feedback-form-builder-design.md`

## Global Constraints

- Do not commit unless the user explicitly asks.
- Do not run validation gates in parallel; run them sequentially.
- No RLS policies, direct table grants, direct table reads from client code, or `service_role`.
- Every read and write resolves identity from `p_session_token`; never trust client-supplied organization, unit, role, creator, reviewer, or respondent identity.
- Keep the existing `feedback_entries` direct-message feature and its four RPCs unchanged.
- Add no top-level nav tile and no dashboard widget changes. The existing Manage `feedback` tab gains sub-tabs.
- The only new `page.tsx` is the public form page `src/app/feedback/f/[token]/page.tsx`; this exception is approved.
- Route Handlers use Web `Request`/`Response`; dynamic params are promises and must be awaited.
- Add `'use client'` only to interactive leaf components, at the top before imports.
- Never print credentials, `.env.local` values, or the `git remote` URL/token.
- Leave `paperworks/` untracked and unchanged.
- Migrations are added, never edited. The new migration is `supabase/migrations/20260101003300_feedback_forms.sql`.
- CSV export must prefix cells beginning with `=`, `+`, `-`, or `@` with `'`.
- Use `npx next build --webpack` and `next start`; do not use Turbopack for final validation.

## Review Focus

- Access must be enforced twice: route-level fast failures and SQL-level final authority. Add wrong-side, wrong-unit, wrong-organization, closed-form, and regenerated-link tests.
- Locking must be real: questions freeze after the first response, and access, identity, and audience freeze after opening. Test both the RPC reason code and the API status.
- Anonymous means anonymous: do not store account id, name, or email on anonymous responses, and do not expose identity in reviewer payloads or CSV identity columns.
- Public links are capabilities: opening generates a 32-character slug, regenerating replaces it, and the old slug stops resolving.
- The public page must not leak internal form metadata, scopes, organization ids, response counts, reviewer data, or the slug.
- Student quick-add fields are normal questions with `field_key`; they are not a parallel storage path.
- Empty, loading, error, locked, closed, and no-response states must render visible, useful copy.
- Legacy direct messages must keep working after the Feedback tab becomes a four-sub-tab workspace.

## File Structure

Create:

- `docs/superpowers/plans/2026-11-19-feedback-form-builder.md`
- `scripts/check-feedback-forms.mjs`
- `supabase/migrations/20260101003300_feedback_forms.sql`
- `src/lib/feedback-forms.ts`
- `src/lib/feedback-forms-schema.ts`
- `src/app/api/feedback/forms/route.ts`
- `src/app/api/feedback/forms/[id]/route.ts`
- `src/app/api/feedback/forms/[id]/questions/route.ts`
- `src/app/api/feedback/forms/[id]/status/route.ts`
- `src/app/api/feedback/forms/[id]/link/route.ts`
- `src/app/api/feedback/forms/[id]/responses/route.ts`
- `src/app/api/feedback/forms/[id]/responses/[responseId]/acknowledge/route.ts`
- `src/app/api/feedback/forms/[id]/export/route.ts`
- `src/app/api/feedback/forms/[id]/respond/route.ts`
- `src/app/api/feedback/available/route.ts`
- `src/app/api/feedback/public/[slug]/route.ts`
- `src/app/feedback/f/[token]/page.tsx`
- `src/components/dashboard/FeedbackWorkspace.tsx`
- `src/components/dashboard/FeedbackFormsPanel.tsx`
- `src/components/dashboard/FeedbackFormBuilder.tsx`
- `src/components/dashboard/FeedbackQuestionEditor.tsx`
- `src/components/dashboard/FeedbackResponsesPanel.tsx`
- `src/components/dashboard/FeedbackAnswerPanel.tsx`
- `src/components/dashboard/PublicFeedbackForm.tsx`

Modify:

- `package.json`
- `scripts/check-authority.mjs`
- `scripts/check-e2e.mjs`
- `scripts/check-interactions-ui.mjs`
- `scripts/check-smoke.mjs`
- `scripts/check-dashboard-audit.mjs`
- `src/lib/auth/messages.ts`
- `src/app/api/permissions/route.ts`
- `src/components/dashboard/AccountsPanel.tsx`
- `src/app/usg/manage/ManageClient.tsx`
- `src/app/lsg/manage/page.tsx`
- `docs/final-report.md`

Do not modify:

- `smartgov.feedback_entries` or the existing feedback RPC bodies.
- `src/app/api/feedback/route.ts`
- `src/app/api/feedback/[id]/route.ts`
- `src/app/api/feedback/[id]/acknowledge/route.ts`
- `src/components/dashboard/FeedbackPanel.tsx`, except importing it unchanged inside `FeedbackWorkspace`.

---

## Task 1: Contract gate and Next.js docs check

**Files:**
- Create: `scripts/check-feedback-forms.mjs`
- Modify: `package.json:5-27`

**Interfaces:**
- Consumes: none.
- Produces: `npm run check:feedback-forms`; helpers `assertFile(path)`, `assertIncludes(path, snippets[])`, `assertNoIncludes(path, snippets[])`, `assertRouteContract(path, methods[])`, and `assertSql(path, snippets[])`.

- [ ] **Step 1: Read the installed Next.js guides**

Read:

- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md`

Expected: route handlers use Web APIs, dynamic params are awaited, a `route.ts` cannot share a segment with `page.tsx`, and `'use client'` belongs on interactive leaves.

- [ ] **Step 2: Write the failing contract gate**

Create `scripts/check-feedback-forms.mjs` using the same `check`, `readSource`, and `stripCommentsAndStrings` style as `scripts/check-federated-features.mjs`. Start with one assertion:

```js
assertFile("supabase/migrations/20260101003300_feedback_forms.sql");
```

Also assert that legacy feedback files still exist and that `src/lib/feedback.ts` still exports `createFeedback`, `listFeedback`, `getFeedback`, and `acknowledgeFeedback`.

- [ ] **Step 3: Add the npm script**

Add to `package.json`:

```json
"check:feedback-forms": "node scripts/check-feedback-forms.mjs"
```

Place it after `check:features`.

- [ ] **Step 4: Run the gate and verify it fails**

Run:

```powershell
npm run check:feedback-forms
```

Expected: FAIL because `supabase/migrations/20260101003300_feedback_forms.sql` does not exist.

---

## Task 2: Migration tables, constraints, and permission widening

**Files:**
- Create: `supabase/migrations/20260101003300_feedback_forms.sql`
- Modify: `scripts/check-feedback-forms.mjs`

**Interfaces:**
- Consumes: gate helpers from Task 1.
- Produces: tables `smartgov.feedback_forms`, `feedback_form_scopes`, `feedback_questions`, `feedback_responses`; `can_target_units` in the permission vocabulary; legacy tables unchanged.

- [ ] **Step 1: Add failing schema assertions**

Assert the migration contains:

- `create table if not exists smartgov.feedback_forms`
- `feedback_form_scopes`, `feedback_questions`, `feedback_responses`
- `public_slug`, `scope`, `access_mode`, `identity_mode`
- `order_index`, `qtype`, `field_key`, `scale_label_low`, `scale_label_high`
- `acknowledged_by`, `acknowledged_at`, `submitted_at`
- `alter table smartgov.account_permissions drop constraint if exists account_permissions_known`
- `permission in ('can_invite', 'can_target_units')`
- `alter table smartgov.feedback_forms enable row level security` and the same for the other three tables
- `revoke all on smartgov.feedback_forms from public, anon, authenticated` and the same for the other three
- no `create policy`, no direct `grant select`/`insert`/`update`/`delete` on the new tables, and no `service_role`

- [ ] **Step 2: Run the gate and verify it fails**

Run `npm run check:feedback-forms`; expected: FAIL on missing table and permission snippets.

- [ ] **Step 3: Write `feedback_forms` exactly**

```sql
create table if not exists smartgov.feedback_forms (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_by      uuid not null references smartgov.accounts (id) on delete cascade,
  title           text not null check (length(btrim(title)) between 3 and 200),
  description     text check (description is null or length(description) <= 4000),
  status          text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  access_mode     text not null default 'signed_in' check (access_mode in ('signed_in', 'public_link')),
  identity_mode   text not null default 'identified' check (identity_mode in ('identified', 'anonymous')),
  public_slug     text unique,
  scope           text not null default 'unit' check (scope in ('university', 'unit_type', 'units', 'unit')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  opened_at       timestamptz,
  closed_at       timestamptz
);
```

`public_slug` is null for `signed_in` forms. Do not add a separate `audience_mode` column; the design uses `scope`.

- [ ] **Step 4: Write scopes exactly**

```sql
create table if not exists smartgov.feedback_form_scopes (
  id        uuid primary key default gen_random_uuid(),
  form_id   uuid not null references smartgov.feedback_forms (id) on delete cascade,
  unit_type text,
  unit_id   uuid references public.governance_units (id) on delete cascade,
  check (unit_type is not null or unit_id is not null)
);
```

Add:

```sql
create unique index if not exists feedback_form_scopes_unique_idx
  on smartgov.feedback_form_scopes (
    form_id,
    coalesce(unit_type, ''),
    coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
create index if not exists feedback_form_scopes_unit_idx
  on smartgov.feedback_form_scopes (unit_id);
```

- [ ] **Step 5: Write questions exactly**

```sql
create table if not exists smartgov.feedback_questions (
  id               uuid primary key default gen_random_uuid(),
  form_id          uuid not null references smartgov.feedback_forms (id) on delete cascade,
  order_index      integer not null default 0,
  qtype            text not null check (qtype in ('short_text','long_text','multiple_choice','checkbox','dropdown','rating','linear_scale','date','time')),
  field_key        text check (field_key is null or field_key in ('full_name','email','student_number','year_level','program','section','campus')),
  title            text not null check (length(btrim(title)) between 1 and 200),
  description      text check (description is null or length(description) <= 1000),
  required         boolean not null default false,
  options          jsonb not null default '[]'::jsonb,
  scale_min        integer,
  scale_max        integer,
  scale_label_low  text check (scale_label_low is null or length(scale_label_low) <= 80),
  scale_label_high text check (scale_label_high is null or length(scale_label_high) <= 80),
  check (jsonb_typeof(options) = 'array')
);
create index if not exists feedback_questions_form_order_idx
  on smartgov.feedback_questions (form_id, order_index);
```

`field_key` is how quick-add student fields remain normal questions. Do not add quick-add columns to responses.

- [ ] **Step 6: Write responses exactly**

```sql
create table if not exists smartgov.feedback_responses (
  id              uuid primary key default gen_random_uuid(),
  form_id         uuid not null references smartgov.feedback_forms (id) on delete cascade,
  submitted_by    uuid references smartgov.accounts (id) on delete set null,
  respondent_name text,
  respondent_email text,
  answers         jsonb not null default '{}'::jsonb,
  status          text not null default 'new' check (status in ('new', 'acknowledged')),
  acknowledged_by uuid references smartgov.accounts (id) on delete set null,
  acknowledged_at timestamptz,
  submitted_at    timestamptz not null default now(),
  check (jsonb_typeof(answers) = 'object')
);
create index if not exists feedback_responses_form_status_idx
  on smartgov.feedback_responses (form_id, status, submitted_at desc);
```

- [ ] **Step 7: Revoke access and widen the permission**

```sql
alter table smartgov.feedback_forms enable row level security;
alter table smartgov.feedback_form_scopes enable row level security;
alter table smartgov.feedback_questions enable row level security;
alter table smartgov.feedback_responses enable row level security;

revoke all on smartgov.feedback_forms from public, anon, authenticated;
revoke all on smartgov.feedback_form_scopes from public, anon, authenticated;
revoke all on smartgov.feedback_questions from public, anon, authenticated;
revoke all on smartgov.feedback_responses from public, anon, authenticated;

alter table smartgov.account_permissions
  drop constraint if exists account_permissions_known;
alter table smartgov.account_permissions
  add constraint account_permissions_known
  check (permission in ('can_invite', 'can_target_units'));
```

Recreate `smartgov.grant_permission(text, text, text)` from `20260101002200_account_permissions.sql`, changing only:

```sql
if p_permission not in ('can_invite', 'can_target_units') then
```

Keep the same `SECURITY DEFINER`, search path, owner-only check, target lookup, upsert, and return shape.

- [ ] **Step 8: Apply the migration and run the gate**

Run:

```powershell
node scripts/apply-migration.mjs supabase/migrations/20260101003300_feedback_forms.sql
npm run check:feedback-forms
```

Expected: migration applies, PostgREST reloads, and the gate fails only on RPC assertions not yet written.

---

## Task 3: Helpers and management read/create/update RPCs

**Files:**
- Modify: `supabase/migrations/20260101003300_feedback_forms.sql`
- Modify: `scripts/check-feedback-forms.mjs`

**Interfaces:**
- Consumes: tables from Task 2.
- Produces:
  - `smartgov.feedback_form_can_manage(p_account smartgov.accounts, p_form smartgov.feedback_forms) returns boolean`
  - `smartgov.feedback_form_can_review(p_account smartgov.accounts, p_form smartgov.feedback_forms) returns boolean`
  - `smartgov.feedback_form_matches_account(p_account smartgov.accounts, p_form smartgov.feedback_forms) returns boolean`
  - `smartgov.feedback_form_is_locked(p_form_id uuid) returns boolean`
  - `smartgov.list_feedback_forms(p_session_token text) returns jsonb`
  - `smartgov.get_feedback_form(p_session_token text, p_form_id uuid) returns jsonb`
  - `smartgov.create_feedback_form(p_session_token text, p_title text, p_description text, p_scope text, p_unit_ids uuid[], p_unit_types text[], p_access_mode text, p_identity_mode text) returns jsonb`
  - `smartgov.update_feedback_form(p_session_token text, p_form_id uuid, p_title text, p_description text, p_scope text, p_unit_ids uuid[], p_unit_types text[], p_access_mode text, p_identity_mode text) returns jsonb`

- [ ] **Step 1: Add failing RPC assertions**

Assert the exact function names and argument lists above. Assert every `public` wrapper grants execute only to `anon, authenticated`.

- [ ] **Step 2: Run the gate and verify it fails**

Run `npm run check:feedback-forms`; expected: FAIL on missing function names.

- [ ] **Step 3: Implement the helpers**

- `feedback_form_can_manage` and `feedback_form_can_review` both return true when the form belongs to the caller's organization and either the caller is USG-side or `created_by = caller.id`.
- `feedback_form_matches_account` returns true only when the form is `open` and:
  - `scope = 'university'` and the account belongs to the organization, or
  - `scope = 'unit_type'` and any active `lsg_unit_ids` membership has a matching `governance_units.unit_type`, or
  - `scope in ('units','unit')` and any active `lsg_unit_ids` membership is one of the form's unit scopes.
- USG-side status alone must not match a unit-scoped form.
- `feedback_form_is_locked` returns true when any response exists for the form.

- [ ] **Step 4: Implement `list_feedback_forms`**

Reject `unauthenticated` and `no_organization`. USG sees all forms in the organization; LSG sees only forms it created. Return rows with:

```json
{
  "id": "...",
  "title": "...",
  "description": null,
  "status": "draft",
  "scope": "unit",
  "accessMode": "signed_in",
  "identityMode": "identified",
  "audienceSummary": "Own unit",
  "responseCount": 0,
  "questionCount": 0,
  "canManage": true,
  "canReview": true,
  "publicPath": null,
  "createdAt": "...",
  "openedAt": null,
  "closedAt": null
}
```

Return `publicPath: "/feedback/f/<slug>"` only when the caller can manage the form. Order by `created_at desc, id desc`.

- [ ] **Step 5: Implement `get_feedback_form`**

Reject `unauthenticated`, `no_organization`, `forbidden`, and `not_found`. Return:

```json
{
  "ok": true,
  "form": {
    "id": "...",
    "title": "...",
    "description": null,
    "status": "draft",
    "scope": "units",
    "accessMode": "signed_in",
    "identityMode": "identified",
    "createdAt": "...",
    "updatedAt": "...",
    "openedAt": null,
    "closedAt": null,
    "responseCount": 0,
    "questionCount": 0,
    "questionsLocked": false,
    "canManage": true,
    "canReview": true,
    "publicPath": null
  },
  "scopes": [{ "unitType": "campus", "unitId": null }, { "unitType": null, "unitId": "..." }],
  "questions": [
    {
      "id": "...",
      "orderIndex": 0,
      "qtype": "short_text",
      "fieldKey": null,
      "title": "...",
      "description": null,
      "required": true,
      "options": [],
      "scaleMin": null,
      "scaleMax": null,
      "scaleLabelLow": null,
      "scaleLabelHigh": null
    }
  ]
}
```

- [ ] **Step 6: Implement audience validation**

Create `smartgov.validate_feedback_form_audience(p_account, p_scope, p_unit_ids, p_unit_types)` returning `{ ok, reason }`.

Rules:

- `scope` must be one of the four enum values.
- `university` and `unit_type` are USG-only (`owner` or `is_org_reviewer`).
- Every unit id must belong to the caller's organization. Reject missing ids.
- Every unit type must exist on at least one unit in the organization.
- `university`: ignore both arrays.
- `unit_type`: require at least one type and no unit ids.
- `units`: require at least one unit id and no unit types.
- `unit`: require exactly one unit id and no unit types.
- LSG may use its own `lsg_unit_ids`. It may use other organization units only when `can_target_units` is granted. Reject `invalid_audience` otherwise.

- [ ] **Step 7: Implement `create_feedback_form`**

- Reject `unauthenticated`, `no_organization`, `forbidden`, `invalid_form_title`, `invalid_form_description`, `invalid_audience`.
- Any USG-side account or any LSG account holding at least one active `lsg_unit_ids` membership may create.
- Defaults come from the caller: LSG gets all its active unit ids; USG gets the requested scope.
- Insert the form and its scopes in one transaction.
- Write `smartgov.log_audit(p_session_token, 'feedback_form_create', 'feedback_form', form_id, '{}'::jsonb)` after insert.
- Return `{ ok: true, formId }`.

- [ ] **Step 8: Implement `update_feedback_form`**

- Same manager check as `get_feedback_form`.
- Title and description are always editable.
- When status is not `draft`, reject any change to `scope`, `unit_ids`, `unit_types`, `access_mode`, or `identity_mode` with `form_locked`.
- Validate the audience before replacing scopes.
- Update `updated_at`.
- Audit with `feedback_form_update`.
- Return `{ ok: true }`.

- [ ] **Step 9: Add public wrappers and verify**

For every `smartgov` function in this task, add a `public.<name>` SQL wrapper with `security definer`, `set search_path = public, extensions, smartgov, pg_temp`, `revoke all from public`, and `grant execute to anon, authenticated`.

Run:

```powershell
node scripts/apply-migration.mjs supabase/migrations/20260101003300_feedback_forms.sql --force
npm run check:feedback-forms
```

---

## Task 4: Question, status, link, and delete RPCs

**Files:**
- Modify: `supabase/migrations/20260101003300_feedback_forms.sql`
- Modify: `scripts/check-feedback-forms.mjs`

**Interfaces:**
- Consumes: Task 3 helpers.
- Produces:
  - `smartgov.save_feedback_questions(p_session_token text, p_form_id uuid, p_questions jsonb) returns jsonb`
  - `smartgov.set_feedback_form_status(p_session_token text, p_form_id uuid, p_status text) returns jsonb`
  - `smartgov.regenerate_feedback_link(p_session_token text, p_form_id uuid) returns jsonb`
  - `smartgov.delete_feedback_form(p_session_token text, p_form_id uuid) returns jsonb`

- [ ] **Step 1: Add failing lifecycle assertions**

Assert the four function names, `questions_locked`, `no_questions`, `invalid_questions`, `invalid_slug`, `form_not_open`, `responses_exist`, and `gen_random_bytes(24)`.

- [ ] **Step 2: Implement `save_feedback_questions`**

Accept a JSON array of up to 50 items:

```json
{
  "qtype": "multiple_choice",
  "fieldKey": null,
  "title": "Which session did you attend?",
  "description": null,
  "required": true,
  "options": ["Morning", "Afternoon"],
  "scaleMin": null,
  "scaleMax": null,
  "scaleLabelLow": null,
  "scaleLabelHigh": null
}
```

Reject `invalid_questions` on bad shape. Reject `questions_locked` when `feedback_form_is_locked` is true. Validate:

- `order_index` is assigned from array order, starting at 0.
- title trimmed `1..200`; description max 1000.
- `field_key` is null or one of the seven approved keys.
- `qtype` is one of the nine approved types.
- choice types require `2..20` non-empty unique options, each `1..120` after trim.
- `rating` has no options and no scale values.
- `linear_scale` requires min and max `1..10`, min < max, and optional labels max 80.
- text/date/time have no options and no scale values.

Delete existing questions and insert the new list in one transaction. Audit with `feedback_questions_save` and a detail containing only the question count, never question text.

- [ ] **Step 3: Implement `set_feedback_form_status`**

- Manager only.
- `p_status` is `open` or `closed`.
- Allow only `draft -> open`, `open -> closed`, and `closed -> open`; otherwise return `form_not_open`.
- Opening requires at least one question, otherwise `no_questions`.
- Opening a `public_link` form generates `public_slug` when null:

```sql
replace(replace(replace(encode(gen_random_bytes(24), 'base64'), '+', '-'), '/', '_'), '=', '')
```

- Opening sets `opened_at = now()` and `closed_at = null`; closing sets `closed_at = now()`.
- Reopening keeps the same slug unless regenerated.
- Audit with `feedback_form_open` or `feedback_form_close`.
- Return `{ ok: true, status, publicPath }`, with `publicPath` only for managers and only when a slug exists.

- [ ] **Step 4: Implement `regenerate_feedback_link`**

- Manager only.
- Reject `form_not_open` unless the form is `open`.
- Require `access_mode = 'public_link'`.
- Generate a new 24-byte base64url slug, update it, and audit `feedback_form_link_regenerate`.
- Return `{ ok: true, publicPath: "/feedback/f/<slug>" }`.

- [ ] **Step 5: Implement `delete_feedback_form`**

- Manager only.
- Reject `responses_exist` when any response exists.
- Delete the form; scopes, questions, and responses cascade.
- Return `{ ok: true }`.

- [ ] **Step 6: Add public wrappers and verify**

Add the four wrappers. Run migration with `--force` and `npm run check:feedback-forms`.

---

## Task 5: Responding RPCs, slug validation, rate limits, and audit

**Files:**
- Modify: `supabase/migrations/20260101003300_feedback_forms.sql`
- Modify: `scripts/check-feedback-forms.mjs`

**Interfaces:**
- Consumes: Task 3 helpers and existing `smartgov.consume_rate_limit`.
- Produces:
  - `smartgov.list_available_feedback_forms(p_session_token text) returns jsonb`
  - `smartgov.get_feedback_form_for_response(p_session_token text, p_form_id uuid) returns jsonb`
  - `smartgov.submit_feedback_response(p_session_token text, p_form_id uuid, p_answers jsonb, p_respondent_name text, p_respondent_email text) returns jsonb`
  - `smartgov.get_public_feedback_form(p_slug text) returns jsonb`
  - `smartgov.submit_public_feedback_response(p_slug text, p_answers jsonb, p_respondent_name text, p_respondent_email text) returns jsonb`

- [ ] **Step 1: Add failing response assertions**

Assert function names, `feedback:submit:`, `feedback:public:`, `consume_rate_limit`, `rate_limited`, `invalid_answers`, `invalid_respondent`, generic `not_found` for public misses, and that anonymous responses set `submitted_by`, `respondent_name`, and `respondent_email` to null.

- [ ] **Step 2: Implement available lists**

`list_available_feedback_forms` returns `scope = 'signed_in'`, `status = 'open'`, and `feedback_form_matches_account`. Never return `public_slug`. Include `id`, `title`, `description`, `scope`, `questionCount`, and `createdAt`.

`get_feedback_form_for_response` returns the same sanitized form plus ordered questions after status and audience checks. Reject `form_not_open`, `forbidden`, and `not_found`.

- [ ] **Step 3: Implement answer validation**

Create `smartgov.validate_feedback_answers(p_form_id uuid, p_answers jsonb)` returning `{ ok, answers }` or `{ ok: false, reason: 'invalid_answers' }`.

Rules:

- `p_answers` must be an object and at most 100,000 characters when cast to text.
- Keys must be exactly the form's current question ids; unknown keys are rejected.
- Required questions need a non-empty answer; checkbox needs at least one selection.
- `short_text` max 500, `long_text` max 5000.
- `multiple_choice` and `dropdown`: string equal to one stored option.
- `checkbox`: array of unique stored options, max 50.
- `rating`: integer `1..5`.
- `linear_scale`: integer within stored min/max.
- `date`: `YYYY-MM-DD`.
- `time`: `HH:MM` or `HH:MM:SS`.
- Normalize strings with `btrim`; normalize checkbox arrays by trimming each item.

- [ ] **Step 4: Implement signed-in submit**

`submit_feedback_response`:

- authenticate and require an organization
- reject `form_not_open` unless open
- reject `forbidden` unless `scope = 'signed_in'` and `feedback_form_matches_account`
- call `smartgov.consume_rate_limit('feedback:submit:<account-id>:<form-id>', 10, interval '10 minutes')`; return `rate_limited` when false
- validate answers
- `identified`: store `submitted_by = account.id`, `respondent_name = account.display_name`, `respondent_email = account.email`
- `anonymous`: store all three as null and ignore both respondent parameters
- insert one response
- audit `feedback_response_submit` with `{ formId }` only; for anonymous set `actor_id` null
- return `{ ok: true, responseId }`

- [ ] **Step 5: Implement public read and submit**

Slug validation: exactly 32 characters matching `^[A-Za-z0-9_-]{32}$`. Reject `invalid_slug` for bad shape; return generic `not_found` for missing, closed, or non-public forms.

`get_public_feedback_form` returns only `title`, `description`, `identityMode`, and ordered questions. Never return the slug, organization id, form id, scopes, creator, counts, or timestamps.

`submit_public_feedback_response`:

- resolve the open public form by slug
- enforce `consume_rate_limit('feedback:public:<slug>', 120, interval '10 minutes')`
- validate answers
- `identified`: require name `2..120` and a valid-looking email max 200; store both; `submitted_by = null`
- `anonymous`: store no account, name, or email and ignore respondent parameters
- insert the response
- insert an audit row with `actor_id = null`, action `feedback_response_submit`, target the form, detail `{ formId }` only
- return `{ ok: true, responseId }`

- [ ] **Step 6: Add public wrappers and verify**

Add the five wrappers. Run migration with `--force` and `npm run check:feedback-forms`.

---

## Task 6: Reviewing RPCs and acknowledgment

**Files:**
- Modify: `supabase/migrations/20260101003300_feedback_forms.sql`
- Modify: `scripts/check-feedback-forms.mjs`

**Interfaces:**
- Consumes: Task 3 review helper.
- Produces:
  - `smartgov.list_feedback_responses(p_session_token text, p_form_id uuid) returns jsonb`
  - `smartgov.acknowledge_feedback_response(p_session_token text, p_response_id uuid) returns jsonb`

- [ ] **Step 1: Add failing review assertions**

Assert both function names, `feedback_response_acknowledge`, and that anonymous reviewer payloads set identity fields to null.

- [ ] **Step 2: Implement `list_feedback_responses`**

- Reject unless `feedback_form_can_review`.
- Return the form with `id`, `title`, `status`, `identityMode`, and `responseCount`.
- Return ordered questions (id, orderIndex, qtype, fieldKey, title, options, scale fields).
- Return rows ordered by `submitted_at desc` with `id`, `status`, `submittedAt`, `acknowledgedAt`, `answers`, and identity fields.
- When `identity_mode = 'anonymous'`, force `submittedBy`, `respondentName`, and `respondentEmail` to null even if old data exists.

- [ ] **Step 3: Implement `acknowledge_feedback_response`**

- Authenticate.
- Find the response and its form.
- Reject `forbidden` unless `feedback_form_can_review`.
- Update `status = 'acknowledged'`, `acknowledged_by = caller.id`, `acknowledged_at = now()`.
- Audit `feedback_response_acknowledge` with `{ formId }` only.
- Return `{ ok: true, status: 'acknowledged' }`.

- [ ] **Step 4: Add public wrappers and verify**

Add both wrappers. Run migration with `--force` and `npm run check:feedback-forms`.

---

## Task 7: Types, Zod schemas, reason copy, and management routes

**Files:**
- Create: `src/lib/feedback-forms-schema.ts`
- Create: `src/lib/feedback-forms.ts`
- Create: `src/app/api/feedback/forms/route.ts`
- Create: `src/app/api/feedback/forms/[id]/route.ts`
- Create: `src/app/api/feedback/forms/[id]/questions/route.ts`
- Create: `src/app/api/feedback/forms/[id]/status/route.ts`
- Create: `src/app/api/feedback/forms/[id]/link/route.ts`
- Create: `src/app/api/feedback/forms/[id]/responses/route.ts`
- Create: `src/app/api/feedback/forms/[id]/responses/[responseId]/acknowledge/route.ts`
- Create: `src/app/api/feedback/forms/[id]/export/route.ts`
- Modify: `src/lib/auth/messages.ts`
- Modify: `scripts/check-feedback-forms.mjs`

**Interfaces:**
- Consumes: RPC wrappers from Tasks 3–6.
- Produces: types, Zod schemas, and exact management route contracts.

- [ ] **Step 1: Add failing route contract assertions**

Assert:

- `/api/feedback/forms`: `GET`, `POST`
- `/api/feedback/forms/[id]`: `GET`, `PATCH`, `DELETE`
- `/questions`: `POST`
- `/status`: `POST`
- `/link`: `POST`
- `/responses`: `GET`
- `/responses/[responseId]/acknowledge`: `POST`
- `/export`: `GET`
- every management route calls `readSessionToken()`

- [ ] **Step 2: Add reason copy**

Append to `src/lib/auth/messages.ts`:

```ts
invalid_form_title: "Enter a form title between 3 and 200 characters.",
invalid_form_description: "Keep the description under 4,000 characters.",
invalid_questions: "Check the questions and try again.",
no_questions: "Add at least one question before opening the form.",
questions_locked: "Questions cannot change after the first response.",
form_locked: "Access, identity, and audience cannot change after the form opens.",
form_not_open: "This form is not accepting responses.",
invalid_audience: "Choose a valid audience for this form.",
invalid_answers: "Check the answers and try again.",
invalid_slug: "This feedback link is not valid.",
invalid_respondent: "Enter your name and email to continue.",
responses_exist: "Forms with responses cannot be deleted.",
rate_limited: "Too many submissions. Try again in a few minutes.",
```

- [ ] **Step 3: Write Zod schemas**

`src/lib/feedback-forms-schema.ts` exports:

```ts
export const feedbackScopeSchema = z.enum(["university", "unit_type", "units", "unit"]);
export const feedbackAccessSchema = z.enum(["signed_in", "public_link"]);
export const feedbackIdentitySchema = z.enum(["identified", "anonymous"]);
export const feedbackStatusSchema = z.enum(["draft", "open", "closed"]);
export const feedbackQtypeSchema = z.enum(["short_text","long_text","multiple_choice","checkbox","dropdown","rating","linear_scale","date","time"]);
export const feedbackFieldKeySchema = z.enum(["full_name","email","student_number","year_level","program","section","campus"]);
export const feedbackQuestionInputSchema = z.object({
  qtype: feedbackQtypeSchema,
  fieldKey: feedbackFieldKeySchema.nullable().default(null),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullable().default(null),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  scaleMin: z.number().int().min(1).max(10).nullable().default(null),
  scaleMax: z.number().int().min(1).max(10).nullable().default(null),
  scaleLabelLow: z.string().trim().max(80).nullable().default(null),
  scaleLabelHigh: z.string().trim().max(80).nullable().default(null),
});
export const feedbackFormInputSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(4000).nullable().default(null),
  scope: feedbackScopeSchema,
  unitIds: z.array(z.string().uuid()).default([]),
  unitTypes: z.array(z.string().trim().min(1).max(40)).default([]),
  accessMode: feedbackAccessSchema,
  identityMode: feedbackIdentitySchema,
});
export const feedbackAnswersSchema = z.record(z.string(), z.unknown());
```

- [ ] **Step 4: Write `src/lib/feedback-forms.ts`**

Use `callRpc` exactly as `src/lib/feedback.ts` does. Export these signatures:

```ts
export async function listFeedbackForms(sessionToken: string): Promise<ListFeedbackFormsResult>
export async function getFeedbackForm(sessionToken: string, formId: string): Promise<GetFeedbackFormResult>
export async function createFeedbackForm(sessionToken: string, input: FeedbackFormInput): Promise<CreateFeedbackFormResult>
export async function updateFeedbackForm(sessionToken: string, formId: string, input: FeedbackFormInput): Promise<UpdateFeedbackFormResult>
export async function saveFeedbackQuestions(sessionToken: string, formId: string, questions: FeedbackQuestionInput[]): Promise<SaveQuestionsResult>
export async function setFeedbackFormStatus(sessionToken: string, formId: string, status: "open" | "closed"): Promise<StatusResult>
export async function regenerateFeedbackLink(sessionToken: string, formId: string): Promise<LinkResult>
export async function deleteFeedbackForm(sessionToken: string, formId: string): Promise<DeleteResult>
export async function listFeedbackResponses(sessionToken: string, formId: string): Promise<ListResponsesResult>
export async function acknowledgeFeedbackResponse(sessionToken: string, formId: string, responseId: string): Promise<AcknowledgeResult>
```

- [ ] **Step 5: Write the management routes**

Every route:

- calls `readSessionToken()` and returns `401` without a token
- parses bodies with the Zod schemas from Task 7 Step 3
- returns `400` with `messageFor("invalid_answers")` or a field-specific message on validation failure
- maps `unauthenticated` to `401`, `forbidden` to `403`, `not_found` to `404`, `questions_locked`/`form_locked`/`responses_exist` to `409`, `rate_limited` to `429`, and other reasons to `400`
- returns `{ ok: true, ... }`
- logs only a stable prefix and the error, never the token or body

Dynamic route shape:

```ts
type RouteContext = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  ...
}
```

The acknowledge route uses `{ id, responseId }`.

- [ ] **Step 6: Write CSV export**

`GET /api/feedback/forms/[id]/export`:

- calls `listFeedbackResponses`
- builds columns exactly: `submitted_at`, `status`, `respondent_name`, `respondent_email`, then one column per question in order
- serializes with:

```ts
function sanitizeCsvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}
```

- sets `content-type: text/csv; charset=utf-8`
- sets `Content-Disposition: attachment; filename="feedback-<form-id>.csv"`
- returns `404` for forbidden/not-found rather than leaking existence
- leaves identity columns empty for anonymous responses

- [ ] **Step 7: Run lint, TypeScript, and the contract gate**

Run sequentially:

```powershell
npm run lint
npx tsc --noEmit
npm run check:feedback-forms
```

---

## Task 8: Responding routes and the public page

**Files:**
- Create: `src/app/api/feedback/available/route.ts`
- Create: `src/app/api/feedback/forms/[id]/respond/route.ts`
- Create: `src/app/api/feedback/public/[slug]/route.ts`
- Create: `src/app/feedback/f/[token]/page.tsx`
- Create: `src/components/dashboard/PublicFeedbackForm.tsx`
- Modify: `src/lib/feedback-forms.ts`
- Modify: `scripts/check-feedback-forms.mjs`

**Interfaces:**
- Consumes: Task 5 RPCs.
- Produces: `GET /api/feedback/available`, `GET/POST /api/feedback/forms/[id]/respond`, `GET/POST /api/feedback/public/[slug]`, public page.

- [ ] **Step 1: Add failing public route assertions**

Assert:

- `/api/feedback/available`: `GET`
- `/api/feedback/forms/[id]/respond`: `GET`, `POST`
- `/api/feedback/public/[slug]`: `GET`, `POST`
- public routes do **not** call `readSessionToken()`
- public page imports `PublicFeedbackForm` and awaits `params`
- public page calls `getPublicFeedbackForm` server-side or renders a client loader that does
- public page contains no `redirect("/login")` and no `currentAccount()`

- [ ] **Step 2: Add response helpers**

Extend `src/lib/feedback-forms.ts`:

```ts
export async function listAvailableFeedbackForms(sessionToken: string): Promise<ListAvailableResult>
export async function getFeedbackFormForResponse(sessionToken: string, formId: string): Promise<GetForResponseResult>
export async function submitFeedbackResponse(sessionToken: string, formId: string, input: {
  answers: Record<string, unknown>;
  respondentName: string | null;
  respondentEmail: string | null;
}): Promise<SubmitResponseResult>
export async function getPublicFeedbackForm(slug: string): Promise<PublicFormResult>
export async function submitPublicFeedbackResponse(slug: string, input: {
  answers: Record<string, unknown>;
  respondentName: string | null;
  respondentEmail: string | null;
}): Promise<SubmitResponseResult>
```

- [ ] **Step 3: Write the responding routes**

- `GET /api/feedback/available` requires a session.
- `GET/POST /api/feedback/forms/[id]/respond` require a session.
- `GET/POST /api/feedback/public/[slug]` require no session.
- Validate `answers` as an object and respondent fields as nullable strings.
- Map `invalid_slug` and public `not_found` to `404` with `messageFor("invalid_slug")`; do not reveal whether a closed form exists.
- Map `rate_limited` to `429`.

- [ ] **Step 4: Write the public page**

`src/app/feedback/f/[token]/page.tsx`:

- server component
- `params` is a promise; `const { token } = await params`
- does not call `currentAccount()`
- renders a centered, theme-matched card with the SmartGov mark and no dashboard shell
- renders `PublicFeedbackForm` with the token
- on missing/invalid form, render “This feedback link is not valid.” with no login redirect
- include `data-testid="public-feedback-form-page"`

- [ ] **Step 5: Write `PublicFeedbackForm`**

- only `'use client'` file in this task
- loading, invalid/closed, form, submitted states
- identified forms show required name and email fields above the questions
- anonymous forms show a short privacy note
- all nine question types render with accessible labels
- submit calls `POST /api/feedback/public/[slug]`
- success screen says the response was recorded
- no reviewer names, counts, other responses, or internal ids exposed
- `data-testid="public-feedback-form"`

- [ ] **Step 6: Run lint, TypeScript, and the gate**

Run sequentially:

```powershell
npm run lint
npx tsc --noEmit
npm run check:feedback-forms
```

---

## Task 9: Workspace, forms list, and builder shell

**Files:**
- Create: `src/components/dashboard/FeedbackWorkspace.tsx`
- Create: `src/components/dashboard/FeedbackFormsPanel.tsx`
- Create: `src/components/dashboard/FeedbackFormBuilder.tsx`
- Modify: `src/app/usg/manage/ManageClient.tsx`
- Modify: `src/app/lsg/manage/page.tsx`
- Modify: `scripts/check-feedback-forms.mjs`

**Interfaces:**
- Consumes: Task 7 management routes/types.
- Produces: four-sub-tab workspace; forms list; builder shell.

- [ ] **Step 1: Add failing UI assertions**

Assert:

- `FeedbackWorkspace.tsx` contains the exact labels `Forms`, `Responses`, `Answer`, `Direct messages`
- it renders `FeedbackFormsPanel`, `FeedbackResponsesPanel`, `FeedbackAnswerPanel`, and the existing `FeedbackPanel`
- `FeedbackFormsPanel` uses `/api/feedback/forms`
- `FeedbackFormBuilder` uses `/questions`, `/status`, and `/link`
- both manage pages no longer render `FeedbackPanel` directly in the feedback tab
- the `FeedbackPanel` import remains for the Direct messages sub-tab

- [ ] **Step 2: Build the workspace shell**

`FeedbackWorkspace` is a client component with local tab state:

```ts
const TABS = ["forms", "responses", "answer", "messages"] as const;
```

Labels are exactly `Forms`, `Responses`, `Answer`, `Direct messages`. Use `data-testid="feedback-workspace"`.

For Direct messages, render the existing `FeedbackPanel` unchanged:

- USG: `<FeedbackPanel mode="review" />`
- LSG: `<FeedbackPanel mode="submit" />`

- [ ] **Step 3: Build the forms list**

`FeedbackFormsPanel`:

- loads `GET /api/feedback/forms`
- loading skeleton, error with Try again, empty state “No feedback forms yet.”
- cards show title, status badge (`Draft`, `Open`, `Closed`), audience summary, response count, and actions
- actions: open builder, open/close, copy link, regenerate link, delete when empty
- selecting a form opens `FeedbackFormBuilder`
- use `Reveal`, `Button`, and `ROW_STAGGER_MS` from `workspace-shared`
- `data-testid="feedback-form-list"` and `data-testid="feedback-form-new"`

- [ ] **Step 4: Build the builder shell**

`FeedbackFormBuilder`:

- loads `GET /api/feedback/forms/[id]`
- title input (`maxLength=200`), description textarea (`maxLength=4000`)
- access card: `Signed-in only` / `Public link`
- identity card: `Identified` / `Anonymous`
- audience card:
  - USG: `University`, `Unit type`, `Selected units`, `Single unit`
  - LSG: `Selected units` / `Single unit` only; defaults to all active memberships
  - unit picker appears only when the caller holds `can_target_units`
  - `Cross-unit targeting is enabled for you.` note when the permission is present
- after open: scope, access, and identity controls disabled with `form_locked` copy
- public link block shows copy and `Regenerate link`; never render a slug for signed-in forms
- status actions call `POST /status`
- delete disabled when `responseCount > 0`
- save uses one `PATCH /api/feedback/forms/[id]` and one `POST /questions`; report which failed
- `data-testid="feedback-form-builder"`

- [ ] **Step 5: Add builder to Manage**

In `src/app/usg/manage/ManageClient.tsx`, replace:

```tsx
{tab === "feedback" && canReviewDocuments ? <FeedbackPanel mode="review" /> : null}
```

with:

```tsx
{tab === "feedback" && canReviewDocuments ? <FeedbackWorkspace side="usg" /> : null}
```

In `src/app/lsg/manage/page.tsx`, replace:

```tsx
{tab === "feedback" ? <FeedbackPanel mode="submit" /> : null}
```

with:

```tsx
{tab === "feedback" ? <FeedbackWorkspace side="lsg" /> : null}
```

- [ ] **Step 6: Run lint, TypeScript, and the gate**

Run `npm run lint`, `npx tsc --noEmit`, and `npm run check:feedback-forms` sequentially.

---

## Task 10: Question editor and student quick-add fields

**Files:**
- Create: `src/components/dashboard/FeedbackQuestionEditor.tsx`
- Modify: `src/components/dashboard/FeedbackFormBuilder.tsx`
- Modify: `scripts/check-feedback-forms.mjs`

**Interfaces:**
- Consumes: `FeedbackQuestionInput`, `FeedbackQuestionType`, `FeedbackFieldKey`.
- Produces: ordered question editor with add/duplicate/remove/reorder, per-type controls, `field_key` quick-add chips, and locked mode.

- [ ] **Step 1: Add failing editor assertions**

Assert:

- `FeedbackQuestionEditor` contains every question type label
- it contains the seven quick-add labels `Full name`, `Email`, `Student number`, `Year level`, `Program`, `Section`, `Campus`
- quick-add chips assign `fieldKey` values (`full_name`, `email`, `student_number`, `year_level`, `program`, `section`, `campus`)
- `FeedbackFormBuilder` renders the editor and disables save when there are no questions
- `questions_locked` copy is present

- [ ] **Step 2: Build the editor**

Each question row has:

- title input
- optional description input
- type select
- required checkbox
- duplicate, move up, move down, remove
- type-specific body:
  - choice types: option list with add/remove and 2–20 bound
  - rating: fixed `1–5 stars` preview
  - linear scale: min and max selects `1..10`, min < max, optional low/high labels max 80
  - text/date/time: no extra body

Use `data-testid="feedback-question-editor"` and per-question `data-testid="feedback-question"`.

- [ ] **Step 3: Add quick-add chips**

Above the question list, render seven chips. Clicking a chip appends a normal question:

```ts
{
  qtype: "short_text",
  fieldKey: "full_name",
  title: "Full name",
  description: null,
  required: false,
  options: [],
  scaleMin: null,
  scaleMax: null,
  scaleLabelLow: null,
  scaleLabelHigh: null,
}
```

Use these titles/keys:

- `Full name` -> `full_name`
- `Email` -> `email`
- `Student number` -> `student_number`
- `Year level` -> `year_level`
- `Program` -> `program`
- `Section` -> `section`
- `Campus` -> `campus`

If a key is already present, disable its chip. Do not create a separate quick-fields setting or response columns.

- [ ] **Step 4: Prefill signed-in identified forms**

In `FeedbackAnswerPanel`/respond UI, when the form is `identified` and the question has `field_key`:

- `full_name` -> workspace account display name
- `email` -> workspace account email
- `campus` -> workspace account campus name

Public forms do not prefill.

- [ ] **Step 5: Save questions and lock**

`FeedbackFormBuilder` saves via `POST /api/feedback/forms/[id]/questions`. Show `questions_locked` inline without discarding the current draft. Disable the editor when `questionsLocked` is true.

- [ ] **Step 6: Verify**

Run `npm run lint`, `npx tsc --noEmit`, and `npm run check:feedback-forms` sequentially.

---

## Task 11: Responses, acknowledgment, export, and Answer panels

**Files:**
- Create: `src/components/dashboard/FeedbackResponsesPanel.tsx`
- Create: `src/components/dashboard/FeedbackAnswerPanel.tsx`
- Modify: `src/components/dashboard/FeedbackWorkspace.tsx`
- Modify: `scripts/check-feedback-forms.mjs`

**Interfaces:**
- Consumes: `/responses`, `/acknowledge`, `/export`, `/api/feedback/available`, `/api/feedback/forms/[id]/respond`.
- Produces: response table, status filter, acknowledgment, CSV download, answerable form list, and answer form.

- [ ] **Step 1: Add failing panel assertions**

Assert:

- `FeedbackResponsesPanel` uses `/responses`, `/acknowledge`, and `/export`
- `FeedbackAnswerPanel` uses `/api/feedback/available` and `/respond`
- both have empty, loading, error, and `data-testid` hooks
- anonymous response rows render `Anonymous`
- response detail renders every question title and answer

- [ ] **Step 2: Build the responses panel**

- form select loaded from `GET /api/feedback/forms`
- load `GET /api/feedback/forms/[id]/responses`
- filter by `All`, `New`, `Acknowledged`
- table columns: Submitted at, Respondent, Email, plus one column per question
- anonymous rows show `Anonymous` and `—` for email
- clicking a row opens a detail card with all answers
- `Acknowledge` calls `POST /api/feedback/forms/[id]/responses/[responseId]/acknowledge`
- `Export CSV` links to `/api/feedback/forms/[id]/export`
- empty state: “No responses yet.”
- `data-testid="feedback-responses-panel"`

- [ ] **Step 3: Build the answer panel**

- load `GET /api/feedback/available`
- list open signed-in forms with title and question count
- selecting one loads `GET /api/feedback/forms/[id]/respond`
- render the shared question renderer, prefill `field_key` fields when identified
- submit to `POST /api/feedback/forms/[id]/respond`
- show “This form is not accepting responses.” for `form_not_open`
- show “You have already reached the submission limit.” for `rate_limited`
- `data-testid="feedback-answer-panel"`

- [ ] **Step 4: Share the question renderer**

Extract the question render/serialize logic into a small local component used by both `PublicFeedbackForm` and `FeedbackAnswerPanel`. Do not duplicate answer validation in the browser; render controls and let SQL reject invalid answers.

- [ ] **Step 5: Wire the workspace**

`FeedbackWorkspace` renders:

- Forms -> `FeedbackFormsPanel`
- Responses -> `FeedbackResponsesPanel`
- Answer -> `FeedbackAnswerPanel`
- Direct messages -> `FeedbackPanel` in the correct mode

- [ ] **Step 6: Verify**

Run `npm run lint`, `npx tsc --noEmit`, and `npm run check:feedback-forms` sequentially.

---

## Task 12: Cross-unit permission toggle and API allow-list

**Files:**
- Modify: `src/app/api/permissions/route.ts`
- Modify: `src/components/dashboard/AccountsPanel.tsx`
- Modify: `scripts/check-feedback-forms.mjs`

**Interfaces:**
- Consumes: widened `grant_permission`/`revoke_permission` from Task 2.
- Produces: `PERMISSIONS = new Set(["can_invite", "can_target_units"])`; owner-only cross-unit feedback toggle per invited account.

- [ ] **Step 1: Add failing permission assertions**

Assert `src/app/api/permissions/route.ts` includes `can_target_units`, and `AccountsPanel` renders a `Cross-unit feedback` control with `data-testid="feedback-cross-unit-toggle"`.

- [ ] **Step 2: Widen the route allow-list**

Change:

```ts
const PERMISSIONS = new Set(["can_invite", "can_target_units"]);
```

Update the comment: “Grantable permissions are widened by migration, not by input.”

- [ ] **Step 3: Load grants in AccountsPanel**

Add a third fetch to `load()`:

```ts
fetch("/api/permissions", { cache: "no-store" })
```

Build a `Map<email, Set<permission>>` from `grants`. If the call fails, show an inline error but keep the account table usable.

- [ ] **Step 4: Render the toggle**

Add a `Cross-unit feedback` column. Each invited account gets a checkbox:

- checked when the email holds `can_target_units`
- `onChange` POSTs `{ email, permission: "can_target_units" }`
- unchecking sends DELETE with the same body
- disable while busy and reload on success
- note: “Lets this LSG officer target other LSG units in feedback forms. USG-wide targeting stays USG-only.”
- `data-testid="feedback-cross-unit-toggle"`

- [ ] **Step 5: Verify**

Run `npm run lint`, `npx tsc --noEmit`, and `npm run check:feedback-forms` sequentially.

---

## Task 13: Authority, integration, UI, smoke, and audit gates

**Files:**
- Modify: `scripts/check-feedback-forms.mjs`
- Modify: `scripts/check-authority.mjs`
- Modify: `scripts/check-smoke.mjs`
- Modify: `scripts/check-e2e.mjs`
- Modify: `scripts/check-interactions-ui.mjs`
- Modify: `scripts/check-dashboard-audit.mjs`
- Modify: `docs/final-report.md`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: end-to-end coverage for create, save questions, audience checks, open/close, public submission, signed-in submission, acknowledge, export, and permission denial.

- [ ] **Step 1: Extend `check-feedback-forms.mjs` with API integration**

Use `fetch` plus `pg` and the existing credentials file. Sign in as the seeded owner and Pedro. Create a temporary form, save one question, open it, submit one public response, list responses, acknowledge it, export CSV, close it, reopen it, regenerate the link, and clean up direct SQL in `finally` in this order: responses, questions, scopes, forms.

Assert:

- a 32-character slug
- old slug fails after regeneration
- closed form returns `not_found` publicly
- anonymous response has null identity fields
- CSV has the exact header `submitted_at,status,respondent_name,respondent_email,...`
- CSV prefixes `=SUM(A1:A2)` with `'`
- unauthorized management calls return `401`

- [ ] **Step 2: Add authority checks**

Using the seeded USG owner, Pedro (LSG), Carlo (other LSG), and Bea (member):

- LSG cannot read a USG-created form's responses (`403` or `404`)
- Pedro can create a form and target his own unit
- Pedro cannot target Carlo's unit without `can_target_units`
- after USG grants `can_target_units`, Pedro can target Carlo's unit; revoke afterward
- USG can create university and unit-type forms
- target-unit LSG who is not creator and not USG gets `forbidden` on responses
- opening with zero questions returns `no_questions`
- changing questions after a response returns `questions_locked` (`409`)
- changing scope/access/identity after open returns `form_locked` (`409`)
- delete with responses returns `responses_exist` (`409`)
- anonymous signed-in response stores null `submitted_by`, `respondent_name`, and `respondent_email`
- signed-in submit over 10 per 10 minutes returns `429`

Clean up with `pg` in `finally`.

- [ ] **Step 3: Add smoke checks**

Add management APIs to the anonymous `401` list:

- `/api/feedback/forms`
- `/api/feedback/available`
- `/api/feedback/forms/00000000-0000-0000-0000-000000000000/responses`

Add `GET /api/feedback/public/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` expecting `404` and no `/login` redirect. Confirm legacy `GET /api/feedback` still returns `403` for LSG and `200` for USG.

- [ ] **Step 4: Add e2e coverage**

For both roles:

- navigate to Manage -> Feedback
- assert the four sub-tabs are visible
- create a form, add one quick-add question, save, open it, assert `Open`
- assert the public path is visible, load it in a new page, and assert `data-testid="public-feedback-form"` and the title render
- close the form, delete it, and assert it disappears
- switch to Direct messages and assert the existing UI still renders
- assert no browser console errors

- [ ] **Step 5: Extend interactions UI**

Add checks for:

- Forms / Responses / Answer / Direct messages tab switching
- opening and closing the builder
- quick-add chip appends a question row
- save button disabled with zero questions
- public link copy button does not throw
- responses filter changes the visible row set

- [ ] **Step 6: Extend dashboard audit**

Add explicit orphan checks for:

- `feedback_form_scopes.form_id`
- `feedback_questions.form_id`
- `feedback_responses.form_id`
- `feedback_responses.acknowledged_by`
- `feedback_forms.created_by`

Keep the existing dashboard widget ids, default order, and SQL whitelist unchanged. Keep `25/25` plus the new orphan assertions.

- [ ] **Step 7: Run focused static checks**

Before starting the server:

```powershell
npm run check:feedback-forms
npm run lint
npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 8: Build and run the full gate sequence**

Start the app:

```powershell
npx next build --webpack
npm start
```

In another terminal, run one at a time:

```powershell
npm run check:features
npm run check:reveal
npm run check:tours
npm run check:interactions
npm run check:federated
npm run check:units
npm run check:compliance
npm run check:smoke
npm run test:authority
npm run test:e2e
npm run check:interactions:ui
npm run check:tours:ui
npm run check:dashboard
npm run audit:connections
npm run check:feedback-forms
```

Expected: all pass. Update `docs/final-report.md` with the new gate command and feedback-form coverage.

---

## Task 14: Deployment verification

**Files:**
- Modify: `docs/final-report.md` only if Task 13 has not already updated it.

**Interfaces:**
- Consumes: merged `main`.
- Produces: production verification only after the user asks to deploy.

- [ ] **Step 1: Confirm the user wants deployment**

Do not push or deploy unless the user explicitly asks. If asked, push to `main`; the Vercel GitHub integration deploys `sgov` and `smartgov1`, and `.github/workflows/supabase-deploy.yml` applies the migration.

- [ ] **Step 2: Verify production**

Run against `https://sgov.vercel.app`:

- sign in as the seeded owner
- open Manage -> Feedback and confirm the four sub-tabs
- confirm the existing Direct messages tab still loads
- create, open, and delete a draft test form with no responses
- confirm an invalid public slug returns the invalid-link page, not `/login`
- confirm `/api/feedback/forms` returns `401` anonymously

- [ ] **Step 3: Do not use Vercel CLI**

The CLI still cannot access `sgov` (`Error: Not authorized`). Deploy through GitHub push only.

---

## Self-Review

- [ ] Spec coverage: separate layer, `scope`/`access_mode`/`identity_mode`, lifecycle, locks, reviewer scope, public slug, `field_key` quick-add questions, CSV, rate limits, no IP, legacy direct messages, and four sub-tabs are each implemented by a task.
- [ ] Placeholder scan: no `TBD`, `TODO`, or “similar to Task N” shortcuts; every task names exact files, signatures, and verification.
- [ ] Type consistency: all TypeScript names match RPC return keys and route payloads.
- [ ] Security: no direct table access, no `service_role`, no RLS policies, no client-supplied identity, no IP storage, and no anonymous identity persistence.
- [ ] Gate coverage: static contract, integration, authority, smoke, e2e, interactions UI, dashboard audit, and final sequential validation are all present.
