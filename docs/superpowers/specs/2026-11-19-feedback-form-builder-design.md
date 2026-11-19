# Feedback form builder design

**Date:** 2026-11-19
**Status:** Draft for approval
**Scope:** USG and LSG feedback forms inside the existing Feedback tab

## Intent

The current Feedback tab is a subject-and-message inbox: USG reviews entries, LSG sends to USG. The request is a Google-Forms-style builder where USG and LSG officers can create, edit, target, publish, and read feedback forms, and decide what student information they collect. The UI must match the existing SmartGov theme and stay inside the current dashboard experience.

Success means an officer can create a themed form, add and reorder questions, choose an audience and an access mode, publish it, share a link, receive responses, acknowledge them, and export them, while the existing direct-message feedback keeps working.

## Goals

- USG and LSG officers can create and manage feedback forms.
- Officers can add, edit, reorder, require, and delete questions.
- Officers can choose what to collect from students, including common student fields.
- USG can target the university, a unit type, selected units, or one unit.
- LSG can target its own unit by default.
- USG can grant selected LSG officers cross-unit targeting.
- Each form chooses signed-in access or a public link.
- Each form chooses identified or anonymous responses.
- Reviewers can read responses, acknowledge them, and export CSV.
- Draft, open, and closed form states are supported.
- The existing Feedback tab, navigation, theme, and direct-message entries remain intact.

## Non-goals

- No form branching or conditional questions in this version.
- No file uploads, payments, or signatures.
- No email invitations; officers share the public link or students find signed-in forms.
- No per-target-unit response visibility; reviewers are the creator and the USG side.
- No custom themes beyond the existing SmartGov visual system.
- No editing questions after the first response.
- No response cap or deadline in this version; close the form manually.
- No replacement of the existing survey system.

## Anti-goals

- Do not add direct table reads, table grants, RLS policies, or service-role access.
- Do not trust client-supplied account, role, organization, unit, or reviewer identity.
- Do not let an LSG officer target another unit without the explicit USG grant.
- Do not expose anonymous respondents' account identity or email.
- Do not break or remove legacy direct-message feedback.
- Do not make public forms enumerable through a list endpoint.

## Constraints

- Platform pattern: migration -> `SECURITY DEFINER` function -> controlled `public` wrapper -> route handler -> typed lib helper -> UI.
- Migrations are added, never edited. Next migration is `20260101003300_feedback_forms.sql`.
- Route handlers use Web `Request`/`Response`; dynamic params are awaited.
- `'use client'` only on interactive leaf components.
- Credentials and `.env.local` values are never printed or committed.
- Do not touch `paperworks/`.
- Run validation gates sequentially, never in parallel.
- Build with `npx next build --webpack` and `next start` because of the Turbopack symlink error.
- The previous "no new `page.tsx` routes" constraint is superseded for exactly one new public route: `/feedback/f/[token]`.

## Approaches considered

### 1. Reuse surveys with a feedback kind

Add `kind = 'feedback'` to `smartgov.surveys`, then bolt unit scoping, reviewer access, acknowledgment, and a Feedback-tab shell onto the survey system.

Trade-off: fastest path, but survey semantics (result viewers, public survey page, OTP access, no unit scope) do not match feedback, and changes risk regressing the existing survey experience.

### 2. Separate feedback-form layer beside the current inbox (chosen)

Add feedback-form tables, RPCs, routes, and UI beside `feedback_entries`. Reuse the survey question vocabulary and editor patterns, but keep feedback scope, reviewer, and acknowledgment rules separate.

Trade-off: more code than reusing surveys, but clean boundaries, no survey regression risk, and a direct fit for the Feedback tab and unit model.

### 3. Generic forms engine

Abstract surveys and feedback into one shared engine.

Trade-off: best long-term shape, but too large and risky for this request, and it would require migrating existing survey behavior.

## Chosen approach

Build approach 2: a separate feedback-form layer inside the Feedback tab. The existing `feedback_entries` inbox remains as the "Direct messages" section. Forms, responses, and the builder live in new tables and RPCs.

## Product decisions

These are the calls made for this design. They can be corrected during approval.

- **Form lifecycle:** `draft` -> `open` -> `closed`. A closed form can reopen. A form needs at least one question before it can open. Opening a `public_link` form generates a slug if it does not have one. Reopening keeps the same slug unless the manager regenerates it.
- **Question editing:** questions can be edited while the form has no responses. After the first response, questions are locked; title and description remain editable. The creator can still close or reopen the form.
- **Delete:** a form can be deleted only while it has no responses. A form with responses is closed, not deleted.
- **Reviewer visibility:** the creator and the USG side can read responses. A target unit's LSG officers do not automatically see responses to a USG-created form.
- **Editing rights:** the creator manages their own form. The USG side can manage any form for moderation, but the UI labels forms created by someone else.
- **Access mode:** each form is `signed_in` or `public_link`.
- **Identity mode:** each form is `identified` or `anonymous`.
  - Signed-in + identified: store the account and show the account's name and email to reviewers.
  - Signed-in + anonymous: do not store the account, name, or email on the response.
  - Public + identified: require a name and email before submission; do not create an account.
  - Public + anonymous: store neither name nor email.
- **When access and identity can change:** only while the form is `draft`. Once opened, access mode, identity mode, and audience are fixed so a shared link cannot silently change meaning. Title and description can still change.
- **LSG cross-unit targeting:** LSG defaults to all of its active LSG memberships. With the `can_target_units` permission, an LSG officer can select active units in the same organization. LSG still cannot create a university-wide or unit-type form; those remain USG-only.
- **Question types:** `short_text`, `long_text`, `multiple_choice`, `checkbox`, `dropdown`, `rating`, `linear_scale`, `date`, `time`.
  - `rating` is a fixed 1-5 star scale.
  - `linear_scale` supports a custom min and max from 1 to 10, with optional low/high labels.
- **Student fields:** the builder offers quick-add fields for full name, email, student number, year level, program, section, and campus. These are normal questions with an optional `field_key`. Signed-in identified forms prefill full name, email, and campus from the account when those fields exist.
- **Public link:** an unguessable, revocable capability URL. Managers can copy it or regenerate it. Regenerating invalidates the old link.
- **Rate limiting:** public submissions and signed-in submissions use `smartgov.consume_rate_limit`. No IP address or user agent is stored.
- **No response cap or deadline:** the creator closes the form manually. This keeps the first version small.

## Data model

All new tables live in `smartgov`, enable RLS without policies, and revoke all access from `public`, `anon`, and `authenticated`.

### `smartgov.feedback_forms`

- `id uuid primary key default gen_random_uuid()`
- `organization_id uuid not null references public.organizations (id) on delete cascade`
- `created_by uuid not null references smartgov.accounts (id) on delete cascade`
- `title text not null` with a trimmed length check
- `description text`
- `status text not null default 'draft' check (status in ('draft', 'open', 'closed'))`
- `access_mode text not null default 'signed_in' check (access_mode in ('signed_in', 'public_link'))`
- `identity_mode text not null default 'identified' check (identity_mode in ('identified', 'anonymous'))`
- `public_slug text unique`
- `scope text not null default 'unit' check (scope in ('university', 'unit_type', 'units', 'unit'))`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `opened_at timestamptz`
- `closed_at timestamptz`

`public_slug` is a random 192-bit base64url capability stored in plaintext because managers must be able to copy the link again. It is never returned in respondent or list-for-students payloads. It is null for `signed_in` forms.

### `smartgov.feedback_form_scopes`

- `id uuid primary key default gen_random_uuid()`
- `form_id uuid not null references smartgov.feedback_forms (id) on delete cascade`
- `unit_type text`
- `unit_id uuid references public.governance_units (id) on delete cascade`

Unique on `(form_id, coalesce(unit_type, ''), coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid))`. Index `unit_id`.

### `smartgov.feedback_questions`

- `id uuid primary key default gen_random_uuid()`
- `form_id uuid not null references smartgov.feedback_forms (id) on delete cascade`
- `order_index integer not null default 0`
- `qtype text not null check (qtype in ('short_text', 'long_text', 'multiple_choice', 'checkbox', 'dropdown', 'rating', 'linear_scale', 'date', 'time'))`
- `field_key text check (field_key is null or field_key in ('full_name', 'email', 'student_number', 'year_level', 'program', 'section', 'campus'))`
- `title text not null`
- `description text`
- `required boolean not null default false`
- `options jsonb not null default '[]'::jsonb`
- `scale_min integer`
- `scale_max integer`
- `scale_label_low text`
- `scale_label_high text`

Index `(form_id, order_index)`.

### `smartgov.feedback_responses`

- `id uuid primary key default gen_random_uuid()`
- `form_id uuid not null references smartgov.feedback_forms (id) on delete cascade`
- `submitted_by uuid references smartgov.accounts (id) on delete set null`
- `respondent_name text`
- `respondent_email text`
- `answers jsonb not null default '{}'::jsonb`
- `status text not null default 'new' check (status in ('new', 'acknowledged'))`
- `acknowledged_by uuid references smartgov.accounts (id) on delete set null`
- `acknowledged_at timestamptz`
- `submitted_at timestamptz not null default now()`

Index `(form_id, status, submitted_at desc)`.

### Permission widening

Add `can_target_units` to `smartgov.account_permissions`'s check constraint and to the allowed list inside `smartgov.grant_permission`. Only the USG Admin can grant it, consistent with the existing permission rules. No new permission table.

## RPC surface

All functions are `SECURITY DEFINER` with `search_path = public, extensions, smartgov, pg_temp` and revoke all from `public`. Session-based functions authenticate with `smartgov.authenticate(p_session_token)` and derive the caller's organization, role, and unit server-side. Public functions take only a slug and the submitted payload.

### Helpers

- `smartgov.feedback_form_can_manage(p_account, p_form)` -> boolean: creator, or USG side.
- `smartgov.feedback_form_can_review(p_account, p_form)` -> boolean: creator, or USG side.
- `smartgov.feedback_form_matches_account(p_account, p_form)` -> boolean: form is open and the signed-in account matches the audience. `university` matches any active account in the organization; `unit_type` matches an active membership in a unit of that type; `units` and `unit` match an active membership in one of the scoped units. Use all of `smartgov.lsg_unit_ids`, not only `my_lsg_unit`, so an account with more than one seat is matched correctly. USG-side status alone does not grant access to a unit-scoped form.
- `smartgov.feedback_form_is_locked(p_form_id)` -> boolean: a response exists.

### Management

- `create_feedback_form(p_session_token, p_title, p_description, p_scope, p_unit_ids, p_unit_types, p_access_mode, p_identity_mode)` -> `{ ok, formId }`.
- `update_feedback_form(p_session_token, p_form_id, p_title, p_description, p_scope, p_unit_ids, p_unit_types, p_access_mode, p_identity_mode)` -> `{ ok }`. Title and description can change after responses; scope, access, and identity cannot. Audience cannot change after the form opens.
- `save_feedback_questions(p_session_token, p_form_id, p_questions jsonb)` -> `{ ok, questions }`. Replaces the ordered question list atomically. Refuses when the form is locked or already has responses. Replacement regenerates question ids, which is safe because it is only allowed while no response exists.
- `set_feedback_form_status(p_session_token, p_form_id, p_status)` -> `{ ok, status }`. Valid transitions: draft -> open, open -> closed, closed -> open. Opening requires at least one question.
- `regenerate_feedback_link(p_session_token, p_form_id)` -> `{ ok, publicPath }`. Only for `public_link` forms.
- `delete_feedback_form(p_session_token, p_form_id)` -> `{ ok }`. Only when no responses exist.
- `list_feedback_forms(p_session_token)` -> forms visible to the caller. USG sees all organization forms; LSG sees forms it created. Includes counts, audience summary, status, `canManage`, `canReview`, and the public path only for managers.
- `get_feedback_form(p_session_token, p_form_id)` -> form, questions, scopes, counts, `canManage`, `canReview`, `questionsLocked`, and `publicPath` only for managers.

### Responding

- `list_available_feedback_forms(p_session_token)` -> open signed-in forms whose audience matches the caller. Public-link forms are not listed.
- `get_feedback_form_for_response(p_session_token, p_form_id)` -> form and questions after audience and status checks.
- `submit_feedback_response(p_session_token, p_form_id, p_answers, p_respondent_name, p_respondent_email)` -> `{ ok, responseId }`. Rate limited per account and form. Signed-in identified responses store the account name and email. Anonymous responses store no account, name, or email.
- `get_public_feedback_form(p_slug)` -> form and questions for an open public-link form. No reviewer data.
- `submit_public_feedback_response(p_slug, p_answers, p_respondent_name, p_respondent_email)` -> `{ ok, responseId }`. Rate limited per slug. Identified forms require a valid name and email; anonymous forms ignore them.

### Reviewing

- `list_feedback_responses(p_session_token, p_form_id)` -> responses ordered newest first, with respondent fields only when identified.
- `acknowledge_feedback_response(p_session_token, p_response_id)` -> `{ ok, status }`. Reviewer only.

Legacy `create_feedback`, `list_feedback`, `get_feedback`, and `acknowledge_feedback` remain unchanged.

## Validation

- Title: trimmed, 3-200 characters.
- Description: trimmed, max 4000 characters.
- Form status/access/identity/scope values: closed enums in SQL.
- At least one question before opening; max 50 questions.
- Question title: trimmed, 1-200 characters.
- Question description: max 1000 characters.
- Choice options: 2-20 for multiple choice, checkbox, and dropdown; each option trimmed, 1-120 characters, unique within the question.
- `rating`: no options; scale is fixed 1-5.
- `linear_scale`: min 1-10, max 1-10, min < max; optional labels max 80 characters.
- Date answers: `YYYY-MM-DD`. Time answers: `HH:MM` or `HH:MM:SS`.
- Text answers: short text max 500, long text max 5000.
- Checkbox answers: array of valid option strings, max 50.
- Answers may contain only the form's current question ids. Unknown keys are rejected. The shape is `{ "<question-id>": "text" | 4 | ["a", "b"] | "2026-11-19" | "14:30" }`.
- Required questions must have a non-empty answer; checkbox requires at least one selection.
- Public identified submissions: name trimmed, 2-120 characters; email trimmed, valid address, max 200 characters.
- Public slug: 24 random bytes encoded base64url, 32 characters; validate exact shape.
- Response JSON: max 100,000 characters.
- Rate limits: signed-in submissions use `feedback:submit:<account-id>:<form-id>` at 10 per 10 minutes; public submissions use `feedback:public:<slug>` at 120 per 10 minutes. No IP address is used.
- Audience: every unit id must belong to the caller's organization. LSG may use its own unit, or any active unit in the organization only when `can_target_units` is held. University and unit-type scopes are USG-only.
- Public endpoints return generic `not_found` for missing, closed, or non-public forms.
- CSV export prefixes any cell beginning with `=`, `+`, `-`, or `@` with an apostrophe to prevent spreadsheet formula injection.
- CSV columns are `submitted_at`, `status`, `respondent_name`, `respondent_email`, then one column per question in order. Anonymous responses leave the identity columns empty.
- Add `src/lib/auth/messages.ts` copy for the new reasons: `invalid_form_title`, `invalid_form_description`, `no_questions`, `questions_locked`, `form_not_open`, `invalid_audience`, `invalid_answers`, `invalid_slug`, and `invalid_respondent`.

## Routes

### Management and review

- `GET /api/feedback/forms` -> list feedback forms.
- `POST /api/feedback/forms` -> create a form.
- `GET /api/feedback/forms/[id]` -> form detail.
- `PATCH /api/feedback/forms/[id]` -> update metadata.
- `DELETE /api/feedback/forms/[id]` -> delete a form with no responses.
- `POST /api/feedback/forms/[id]/questions` -> replace questions.
- `POST /api/feedback/forms/[id]/status` -> open or close.
- `POST /api/feedback/forms/[id]/link` -> regenerate the public link.
- `GET /api/feedback/forms/[id]/responses` -> response list.
- `POST /api/feedback/forms/[id]/responses/[responseId]/acknowledge` -> acknowledge.
- `GET /api/feedback/forms/[id]/export` -> CSV download.

### Responding

- `GET /api/feedback/available` -> signed-in forms available to the caller.
- `GET /api/feedback/forms/[id]/respond` -> signed-in form for response.
- `POST /api/feedback/forms/[id]/respond` -> submit a signed-in response.
- `GET /api/feedback/public/[slug]` -> public form.
- `POST /api/feedback/public/[slug]` -> submit a public response.

### Legacy

- `GET/POST /api/feedback` and the existing `[id]` routes stay as they are.

All management routes require a session. Public routes accept no session. Route handlers validate with Zod, map RPC reasons to HTTP statuses, and never return raw database errors.

## UI

### Feedback workspace

Replace the single `FeedbackPanel` render with a small workspace that has four sub-tabs:

- **Forms** — list cards with title, status, audience summary, response count, and actions (open builder, open/close, copy link, regenerate link, delete when empty).
- **Responses** — pick a form, then read responses, filter by status, acknowledge, and export CSV.
- **Answer** — open signed-in forms available to the caller. This is how officers and members with accounts find a form instead of needing a public link.
- **Direct messages** — the existing `FeedbackPanel` behavior. USG keeps review mode; LSG keeps submit mode.

The workspace is used in both `/usg/manage?tab=feedback` and `/lsg/manage?tab=feedback`. LSG's tab no longer only sends a direct message; it becomes the LSG form manager and keeps direct messages as a sub-tab.

### Builder

`FeedbackFormBuilder` is a client component in the existing paper/ink/brass visual language:

- Header: title, description, status badge, save draft, open/close, preview toggle.
- Access card: signed-in vs public link; identity mode; for public link, a copyable URL and regenerate action.
- Audience card:
  - USG: university, unit type, selected units, or one unit.
  - LSG: own unit by default; a unit picker appears when `can_target_units` is held.
- Questions card: ordered list with edit, duplicate, delete, required toggle, and move up/down. Quick-add chips for common student fields. Question editor supports all question types in this design.
- Locked state after the first response: question controls are disabled with a clear note; title and description remain editable.
- Save uses one metadata PATCH and one questions POST; the builder reports which part failed.

### Public responder

New route `/feedback/f/[token]/page.tsx`, a public client page using the site's visual system without the dashboard shell:

- Loading, invalid/closed, form, and submitted states.
- SmartGov mark and title.
- Identified public forms show required name and email fields above the questions.
- Anonymous public forms show a short privacy note.
- Submit error handling and a success screen.
- No reviewer names, counts, or other responses are exposed.

### Accounts

Add a USG-only "Cross-unit feedback" toggle to `AccountsPanel` for LSG accounts. It uses the existing `/api/permissions` route with `can_target_units`. The feedback builder reads the caller's `permissions` from the existing workspace role to decide whether to show the unit picker.

## Security and privacy

- Identity and scope are resolved in SQL from the session, never from the request body.
- LSG targeting is denied by default and widened only by the USG grant.
- Review access is checked on every read, acknowledge, and export.
- Public endpoints expose only the requested open form and its questions.
- Public forms are not enumerable; a slug is required.
- Anonymous responses do not store the account, name, or email.
- Rate limits use the existing table and do not store IP addresses.
- CSV output is escaped and formula-injection protected.
- Audit events are written for form create, open, close, question save, link regenerate, response submit, and response acknowledge. The audit detail contains no answer text or respondent identity.

## What is left to the builder

- Exact component decomposition and styling details inside the existing design system.
- Exact Zod schema placement and shared types in `src/lib/feedback.ts`.
- Whether the responses list uses inline expansion or a dialog.
- Whether the form list uses cards or a table, as long as it fits the current dashboard.
- Test fixture details for the check scripts.

## Validation plan

Add or extend:

- `scripts/check-feedback-forms.mjs` for create, save questions, audience checks, open/close, public submission, signed-in submission, acknowledge, export, and permission denial.
- `scripts/check-authority.mjs` for anonymous and cross-unit denial paths.
- `scripts/check-e2e.mjs` for USG and LSG builder access.
- `scripts/check-interactions-ui.mjs` for the new sub-tabs and builder controls.
- `scripts/check-smoke.mjs` for the public responder route and feedback APIs.
- `scripts/check-dashboard-audit.mjs` for orphaned forms, questions, scopes, and responses.

Run sequentially: lint, typecheck, webpack build, feature checks, authority, e2e, interactions UI, smoke, dashboard audit. Then deploy by pushing to `main`; the existing Supabase workflow applies the migration.

## Migration and rollout

- New migration: `supabase/migrations/20260101003300_feedback_forms.sql`.
- The migration is additive and re-runnable with `create table if not exists`, `create or replace`, and guarded constraint changes.
- No existing feedback rows are migrated or rewritten.
- The public route and new APIs ship together; the old feedback endpoints remain available.
- After deploy, verify `/login` returns 200, `/usg` and `/lsg` still redirect when signed out, the new public route rejects a bad slug, and all management endpoints return 401 anonymously.

## Risks and mitigations

- **Public link abuse:** capability slug, rate limit, close/regenerate controls, no enumeration.
- **Scope escalation:** SQL derives the caller and checks unit membership plus the `can_target_units` grant; the route check is only a fast failure.
- **Privacy mistakes:** per-form identity mode; anonymous submissions store no identity; reviewer payloads omit identity for anonymous responses.
- **Data loss from edits:** questions lock after the first response; the builder shows the locked state before disabling controls.
- **CSV injection:** prefix dangerous leading characters and quote all cells.
- **Survey regression:** no changes to survey tables, RPCs, routes, or pages.
- **Migration reapply:** guarded DDL and `create or replace` throughout.
