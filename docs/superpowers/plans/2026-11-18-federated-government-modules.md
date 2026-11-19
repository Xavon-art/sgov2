# Federated Government Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the missing LSG/USG government functions from the supplied docs and screenshots as child tabs inside the current workspace without changing dashboard arrangement or saved layouts.

**Architecture:** Keep the six top-level nav tiles and overview widgets fixed. Add migrations with `security definer` RPCs and public wrappers, add typed route handlers, then add client panels under `Request`, `Events`, and `Manage`. Reuse existing proposal, budget, event, upload, and dashboard systems instead of restoring deleted screens.

**Tech Stack:** Next.js 16.3.6 App Router, React 19.2.8, TypeScript, Supabase/Postgres RPCs, Tailwind, Playwright-based `scripts/*.mjs` gates.

**Spec:** `docs/superpowers/specs/2026-11-18-federated-government-modules-design.md`

## Global Constraints

- Do not commit unless the user explicitly asks.
- No visual redesign or screenshot reproduction.
- No new top-level nav tiles.
- No changes to `src/components/dashboard/FederatedOverview.tsx` widget ids, default widget list, or dashboard card order.
- No changes to `supabase/migrations/20260101003194_dashboard_widget_preferences.sql`.
- Do not reorder, rename, or remove existing top-level nav ids in `src/components/dashboard/usg-nav.ts` or `src/components/dashboard/lsg-nav.ts`.
- Append child links only, after existing children.
- No RLS policies, direct table grants, direct table reads from client code, or `service_role`.
- All new data access resolves identity from `p_session_token`; never trust client-supplied organization, unit, role, author, or reviewer fields.
- Route Handlers use Web `Request`/`Response`; a `route.ts` cannot share a segment with `page.tsx`.
- Dynamic route params are promises in Server Components; use `RouteContext<'/api/.../[id]'>` and `await ctx.params` in route handlers.
- Add `'use client'` only to interactive leaf components, at the top before imports.
- Run all gates sequentially, never in parallel.
- Never print credentials, `.env.local` values, or the `git remote` URL/token.
- Leave `paperworks/` untracked and unchanged.

## Review Focus

- Saved dashboard layout must remain byte-stable: add assertions to the Task 2 static gate that widget ids, default order, and SQL whitelist are unchanged, and keep `npm run check:dashboard` green.
- Cross-role or cross-account leakage must be rejected: add anonymous/wrong-side/wrong-unit API denials in Task 11 using `npm run test:authority`.
- Status vocabulary drift must not produce unknown labels: add status-map assertions in Task 2 and UI label assertions in Tasks 3–10.
- Client-supplied totals or identity must never be accepted: add Task 5 and Task 8 tests asserting SQL computes totals and RPCs derive author/reviewer from session.
- Empty search/filter and missing record states must render useful UI: add Task 4 and Task 11 browser assertions for empty results and visible error states.

## File Structure

Create:

- `scripts/check-federated-features.mjs`
- `docs/superpowers/plans/2026-11-18-federated-government-modules.md`
- `supabase/migrations/20260101003200_resolutions.sql`
- `supabase/migrations/20260101003210_document_catalog_and_search.sql`
- `supabase/migrations/20260101003220_event_budget_link.sql`
- `supabase/migrations/20260101003230_unified_calendar.sql`
- `supabase/migrations/20260101003240_monitoring_by_campus.sql`
- `supabase/migrations/20260101003250_accomplishment_reports.sql`
- `supabase/migrations/20260101003260_feedback.sql`
- `supabase/migrations/20260101003270_officer_profile_fields.sql`
- `src/lib/resolutions.ts`
- `src/lib/document-search.ts`
- `src/lib/monitoring.ts`
- `src/lib/accomplishment-reports.ts`
- `src/lib/feedback.ts`
- `src/app/api/resolutions/route.ts`
- `src/app/api/resolutions/[id]/route.ts`
- `src/app/api/resolutions/[id]/review/route.ts`
- `src/app/api/documents/route.ts`
- `src/app/api/documents/[submissionId]/route.ts`
- `src/app/api/documents/[submissionId]/approve/route.ts`
- `src/app/api/monitoring/route.ts`
- `src/app/api/accomplishment-reports/route.ts`
- `src/app/api/accomplishment-reports/[id]/route.ts`
- `src/app/api/accomplishment-reports/[id]/review/route.ts`
- `src/app/api/feedback/route.ts`
- `src/app/api/feedback/[id]/route.ts`
- `src/app/api/feedback/[id]/acknowledge/route.ts`
- `src/app/api/profile/officer/route.ts`
- `src/components/dashboard/ResolutionPanel.tsx`
- `src/components/dashboard/RequirementDeskPanel.tsx`
- `src/components/dashboard/DocumentLibraryPanel.tsx`
- `src/components/dashboard/DocumentSearchPanel.tsx`
- `src/components/dashboard/BudgetPanel.tsx`
- `src/components/dashboard/CalendarPanel.tsx`
- `src/components/dashboard/MonitoringPanel.tsx`
- `src/components/dashboard/AccountsPanel.tsx`
- `src/components/dashboard/AccomplishmentPanel.tsx`
- `src/components/dashboard/FeedbackPanel.tsx`
- `src/components/dashboard/OfficerProfileFields.tsx`

Modify:

- `package.json`
- `scripts/check-dashboard-audit.mjs`
- `scripts/check-units.mjs`
- `scripts/check-authority.mjs`
- `scripts/check-e2e.mjs`
- `scripts/check-smoke.mjs`
- `scripts/check-tours-ui.mjs`
- `src/components/dashboard/RequestSection.tsx`
- `src/components/dashboard/EventsWorkspace.tsx`
- `src/components/dashboard/usg-nav.ts`
- `src/components/dashboard/lsg-nav.ts`
- `src/app/usg/manage/page.tsx`
- `src/app/lsg/manage/page.tsx`
- `src/app/api/budgets/route.ts`
- `src/app/api/feed/route.ts`
- `src/lib/budgets.ts`
- `src/lib/auth/messages.ts`
- `src/lib/tours/pages/usg-*.ts`
- `src/lib/tours/pages/lsg-*.ts`
- `docs/final-report.md`

---

## Task 1: Feature contract gate and Next.js docs check

**Files:**
- Create: `scripts/check-federated-features.mjs`
- Modify: `package.json:5-27`

**Interfaces:**
- Consumes: none.
- Produces: `npm run check:features`; helpers `assertFile(path)`, `assertIncludes(path, snippets[])`, `assertNoIncludes(path, snippets[])`, `assertRouteContract(path, methods[])`, `assertNavStable(side, expectedIds)`.

- [ ] **Step 1: Read the installed Next.js guides**

Read:
- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md`

Expected: route handlers use Web APIs, `route.ts` does not collide with `page.tsx`, dynamic params are awaited, and client components are leaf nodes.

- [ ] **Step 2: Write the failing contract gate**

Create `scripts/check-federated-features.mjs` with the helpers above and one initial assertion that expects `src/lib/resolutions.ts` to exist.

- [ ] **Step 3: Add the npm script**

Modify `package.json` scripts to add `"check:features": "node scripts/check-federated-features.mjs"` after `check:dashboard`.

- [ ] **Step 4: Run the gate and verify it fails**

Run: `npm run check:features`
Expected: FAIL because `src/lib/resolutions.ts` does not exist.

- [ ] **Step 5: Keep the gate ready for later tasks**

Do not implement resolutions here. Later tasks add assertions before implementation.

---

## Task 2: Dashboard and nav stability guard

**Files:**
- Modify: `scripts/check-federated-features.mjs`
- Modify: `scripts/check-dashboard-audit.mjs`
- Modify: `scripts/check-units.mjs`

**Interfaces:**
- Consumes: `assertIncludes`, `assertNoIncludes`, `assertNavStable` from Task 1.
- Produces: stable nav/widget assertions that every later task must keep green.

- [ ] **Step 1: Write the failing stability tests**

Add assertions that:
- `src/components/dashboard/usg-nav.ts` contains top-level ids in order `overview, manage, request, events, survey, settings`.
- `src/components/dashboard/lsg-nav.ts` contains the same six ids in the same order.
- `src/components/dashboard/FederatedOverview.tsx` is not modified by later tasks: assert the current widget id list is still `at-a-glance, report-summary, task-status, request-status, workflow`.
- `supabase/migrations/20260101003194_dashboard_widget_preferences.sql` still contains the same five widget ids.
- `scripts/check-dashboard-audit.mjs` still expects `25/25` dashboard checks.

- [ ] **Step 2: Run the gate and verify it passes**

Run: `npm run check:features`
Expected: PASS, proving the baseline is locked before new modules are added.

- [ ] **Step 3: Add status vocabulary assertions**

Add a test that a shared display map in `scripts/check-federated-features.mjs` contains `pending`, `under review`, `approved`, `returned`, `rejected`, and `cancelled`, and that every new panel uses only those display labels or module-native labels listed in the design.

- [ ] **Step 4: Run the gate again**

Run: `npm run check:features`
Expected: PASS.

---

## Task 3: Resolutions

**Files:**
- Create: `supabase/migrations/20260101003200_resolutions.sql`
- Create: `src/lib/resolutions.ts`
- Create: `src/app/api/resolutions/route.ts`
- Create: `src/app/api/resolutions/[id]/route.ts`
- Create: `src/app/api/resolutions/[id]/review/route.ts`
- Create: `src/components/dashboard/ResolutionPanel.tsx`
- Modify: `src/components/dashboard/RequestSection.tsx`
- Modify: `src/components/dashboard/usg-nav.ts`
- Modify: `src/components/dashboard/lsg-nav.ts`
- Modify: `src/lib/auth/messages.ts`

**Interfaces:**
- Consumes: `callRpc`, `getSessionToken`, existing tab pattern in `RequestSection.tsx`.
- Produces:
  - `ResolutionStatus = "submitted" | "under_review" | "approved" | "returned" | "published"`.
  - `ResolutionRow { id, title, status, unitName, createdAt, decidedAt, decisionRemark }`.
  - `ResolutionDetail extends ResolutionRow { body, timeline }`.
  - `GET /api/resolutions -> { ok, rows }`.
  - `POST /api/resolutions { title, body, unitId? } -> { ok, id }`.
  - `GET /api/resolutions/[id] -> { ok, item }`.
  - `POST /api/resolutions/[id]/review { decision, remark? } -> { ok }`.

- [ ] **Step 1: Write the failing feature assertions**

In `scripts/check-federated-features.mjs`, assert the migration, lib, three routes, and panel exist, and that the migration contains `create_resolution`, `list_resolutions`, `get_resolution`, `review_resolution`, `revoke all`, and `grant execute`.

- [ ] **Step 2: Run the gate and verify it fails**

Run: `npm run check:features`
Expected: FAIL with missing resolution files.

- [ ] **Step 3: Create the migration**

Create `20260101003200_resolutions.sql` with:
- `smartgov.resolutions` and `smartgov.resolution_reviews`.
- `smartgov.create_resolution(text, text, text, uuid default null) returns jsonb`.
- `smartgov.list_resolutions(text) returns jsonb`.
- `smartgov.get_resolution(text, uuid) returns jsonb`.
- `smartgov.review_resolution(text, uuid, text, text default null) returns jsonb`.
- Matching `public` wrappers with `revoke all` then `grant execute ... to anon, authenticated`.
- USG sees all organization rows; LSG sees own-unit rows plus org-wide `approved`/`published`.

- [ ] **Step 4: Apply the migration locally**

Run: `node scripts/apply-migration.mjs supabase/migrations/20260101003200_resolutions.sql`
Expected: success and migration recorded in `smartgov.applied_migrations`.

- [ ] **Step 5: Add client types and route handlers**

Create `src/lib/resolutions.ts` and the three route handlers. Use `RouteContext<'/api/resolutions/[id]'>` and await `ctx.params`.

- [ ] **Step 6: Add the Request tab panel**

Add a `Resolutions` tab to USG and LSG `RequestSection.tsx` using the existing tab classes, list card, status badge, create form, detail view, and review actions. Append child link `Resolutions` after existing children in both nav builders.

- [ ] **Step 7: Run feature and core gates**

Run sequentially:
`npm run check:features`, `npm run lint`, `npx tsc --noEmit`, `npm run check:units`, `npm run check:dashboard`
Expected: all PASS; dashboard remains `25/25`.

---

## Task 4: Document catalog and search

**Files:**
- Create: `supabase/migrations/20260101003210_document_catalog_and_search.sql`
- Create: `src/lib/document-search.ts`
- Create: `src/app/api/documents/route.ts`
- Create: `src/app/api/documents/[submissionId]/route.ts`
- Create: `src/app/api/documents/[submissionId]/approve/route.ts`
- Create: `src/components/dashboard/DocumentLibraryPanel.tsx`
- Create: `src/components/dashboard/DocumentSearchPanel.tsx`
- Modify: `src/app/usg/manage/page.tsx`
- Modify: `src/app/lsg/manage/page.tsx`
- Modify: `src/components/dashboard/usg-nav.ts`
- Modify: `src/components/dashboard/lsg-nav.ts`

**Interfaces:**
- Consumes: existing `item_submissions`, `document_uploads`, `/api/files/[submissionId]`.
- Produces:
  - `DocumentRow { submissionId, title, description, keywords, groupKind, groupLabel, type, unitName, status, submittedAt }`.
  - `GET /api/documents?q&type&status&limit -> { ok, rows }`.
  - `PATCH /api/documents/[submissionId] { title, description, keywords, groupKind, groupId, groupLabel } -> { ok }`.
  - `POST /api/documents/[submissionId]/approve { decision, remark? } -> { ok }`.

- [ ] **Step 1: Write failing assertions**

Assert new files exist and migration contains `document_catalog`, `search_documents`, `set_document_metadata`, `approve_document`, `group_kind`, `group_label`, `to_tsvector`, `revoke all`, and `grant execute`.

- [ ] **Step 2: Run the gate and verify it fails**

Run: `npm run check:features`
Expected: FAIL.

- [ ] **Step 3: Create and apply the migration**

Create the migration with approved-only org visibility, group metadata for requirement/resolution/event, and an extended `smartgov.get_document` allowing approved catalog rows to be downloaded by viewers.

Run: `node scripts/apply-migration.mjs supabase/migrations/20260101003210_document_catalog_and_search.sql`
Expected: success.

- [ ] **Step 4: Add types and routes**

Create the lib and three routes. Search returns `submissionId`, never bytes.

- [ ] **Step 5: Add Documents and Search tabs**

Add owner/reviewer approval controls only where allowed. Results show title first, then type, campus, date, status, group label, and a download link. Empty search renders the existing empty-state style.

- [ ] **Step 6: Append Manage child links**

Append `Documents` and `Search` after existing children in both nav builders. Do not change top-level nav ids.

- [ ] **Step 7: Run gates**

Run: `npm run check:features`, `npm run lint`, `npx tsc --noEmit`, `npm run check:units`, `npm run check:interactions`
Expected: all PASS.

---

## Task 5: Event budget link and budget reflection

**Files:**
- Create: `supabase/migrations/20260101003220_event_budget_link.sql`
- Create: `src/components/dashboard/BudgetPanel.tsx`
- Modify: `src/app/api/budgets/route.ts`
- Modify: `src/lib/budgets.ts`
- Modify: `src/components/dashboard/EventsWorkspace.tsx`
- Modify: `src/app/usg/manage/page.tsx`
- Modify: `src/app/lsg/manage/page.tsx`
- Modify: `src/components/dashboard/usg-nav.ts`
- Modify: `src/components/dashboard/lsg-nav.ts`

**Interfaces:**
- Consumes: `budget_write_items`, `submit_budget`, `list_budgets`, `budget_summary`, `DraftItem` from `src/lib/budgets.ts`.
- Produces:
  - `BudgetRow` gains `eventId`, `eventTitle`, `eventDate`.
  - `POST /api/budgets` accepts `{ eventId?, proposalId?, title, justification, items }`.
  - `smartgov.submit_event_budget(text, uuid, text, text, jsonb) returns jsonb`.
  - `BudgetPanel` shows requested, approved, expenses, and remaining totals.

- [ ] **Step 1: Write failing assertions**

Assert migration contains `event_id`, `submit_event_budget`, `budget_write_items`, `proposal_id is null`, and `eventId`; assert `src/lib/budgets.ts` contains `eventId`; assert budget route contains `eventId`.

- [ ] **Step 2: Run the gate and verify it fails**

Run: `npm run check:features`
Expected: FAIL.

- [ ] **Step 3: Create and apply the migration**

Add nullable `event_id`, a check preventing both `proposal_id` and `event_id`, an index, `submit_event_budget`, and re-create `list_budgets`/`budget_detail` with event fields. Do not edit the old migration.

Run: `node scripts/apply-migration.mjs supabase/migrations/20260101003220_event_budget_link.sql`
Expected: success.

- [ ] **Step 4: Extend budget API and types**

Modify `/api/budgets` so `eventId` routes to `submit_event_budget`; keep server-computed totals and reject client subtotals.

- [ ] **Step 5: Add budget UI**

Add a `Submit budget` action on event detail in `EventsWorkspace`. Add a `Budget` tab under Manage on both sides using existing table/form styles and `formatMoney`.

- [ ] **Step 6: Append Manage child link**

Append `Budget` after existing Manage children on both sides.

- [ ] **Step 7: Run gates**

Run: `npm run check:features`, `npm run lint`, `npx tsc --noEmit`, `npm run check:interactions`, `npm run check:units`
Expected: all PASS.

---

## Task 6: Unified calendar and future events

**Files:**
- Create: `supabase/migrations/20260101003230_unified_calendar.sql`
- Create: `src/components/dashboard/CalendarPanel.tsx`
- Modify: `src/app/api/feed/route.ts`
- Modify: `src/components/dashboard/EventsWorkspace.tsx`
- Modify: `src/components/dashboard/usg-nav.ts`
- Modify: `src/components/dashboard/lsg-nav.ts`

**Interfaces:**
- Consumes: `smartgov.list_calendar(text, date, int)`, `smartgov.events`, `smartgov.proposals`.
- Produces:
  - `CalendarEvent` gains `source`, `itemId`, `date`, `time`, `timezone`, `status`, `honorStatus`, `unitName`.
  - `POST /api/feed { month, days } -> { ok, days }`.
  - `CalendarPanel` shows Upcoming and Past sections.

- [ ] **Step 1: Write failing assertions**

Assert migration contains `create or replace function smartgov.list_calendar`, `source`, `itemId`, `honorStatus`, `smartgov.events`, and `smartgov.proposals`; assert feed route type contains `source`.

- [ ] **Step 2: Run the gate and verify it fails**

Run: `npm run check:features`
Expected: FAIL.

- [ ] **Step 3: Replace the calendar function body**

Keep the signature `smartgov.list_calendar(p_session_token text, p_month date, p_days int)`. Union approved proposal events and visible events; exclude `cancelled`, `rejected`, and `not_honored`; preserve organization and LSG unit scoping from `list_events`.

Run: `node scripts/apply-migration.mjs supabase/migrations/20260101003230_unified_calendar.sql`
Expected: success.

- [ ] **Step 4: Expand feed types and add UI**

Update `CalendarEvent` and add `CalendarPanel` with Upcoming/Past sections and a month grid using the existing event calendar style.

- [ ] **Step 5: Wire Events tabs and child links**

Add `Calendar` and `Future Events` tabs to `EventsWorkspace`. Append child links after existing event-related links in both nav builders.

- [ ] **Step 6: Run gates**

Run: `npm run check:features`, `npm run lint`, `npx tsc --noEmit`, `npm run check:tours`, `npm run check:dashboard`
Expected: all PASS.

---

## Task 7: Monitoring by campus

**Files:**
- Create: `supabase/migrations/20260101003240_monitoring_by_campus.sql`
- Create: `src/lib/monitoring.ts`
- Create: `src/app/api/monitoring/route.ts`
- Create: `src/components/dashboard/MonitoringPanel.tsx`
- Modify: `src/app/usg/manage/page.tsx`
- Modify: `src/components/dashboard/usg-nav.ts`

**Interfaces:**
- Consumes: canonical `public.governance_units`, existing module status vocabularies.
- Produces:
  - `MonitoringCampus { unitId, unitName, totals, modules }`.
  - `GET /api/monitoring -> { ok, campuses, totals }`.
  - `MonitoringPanel` with status bars and CSV export.

- [ ] **Step 1: Write failing assertions**

Assert migration contains `monitoring_by_campus`, `is_usg_side`, `governance_units`, `proposals`, `budgets`, `events`, `documents`, `resolutions`; assert route exists.

- [ ] **Step 2: Run the gate and verify it fails**

Run: `npm run check:features`
Expected: FAIL.

- [ ] **Step 3: Create and apply the migration**

Create `smartgov.monitoring_by_campus(text)` and a public wrapper. Group by top-level campus/college/department under the USG root. Return `forbidden` for LSG and `unauthenticated` for no session.

Run: `node scripts/apply-migration.mjs supabase/migrations/20260101003240_monitoring_by_campus.sql`
Expected: success.

- [ ] **Step 4: Add lib, route, and panel**

Add `monitoring.ts`, `GET /api/monitoring`, and `MonitoringPanel` using existing status bar/card styles. CSV export uses the same returned payload.

- [ ] **Step 5: Add USG Manage tab and child link**

Append `Monitoring` after existing Manage children in `usg-nav.ts`. Do not add an LSG nav item.

- [ ] **Step 6: Run gates**

Run: `npm run check:features`, `npm run lint`, `npx tsc --noEmit`, `npm run check:authority` equivalent `npm run test:authority`, `npm run check:units`
Expected: all PASS.

---

## Task 8: Accomplishment reports

**Files:**
- Create: `supabase/migrations/20260101003250_accomplishment_reports.sql`
- Create: `src/lib/accomplishment-reports.ts`
- Create: `src/app/api/accomplishment-reports/route.ts`
- Create: `src/app/api/accomplishment-reports/[id]/route.ts`
- Create: `src/app/api/accomplishment-reports/[id]/review/route.ts`
- Create: `src/components/dashboard/AccomplishmentPanel.tsx`
- Modify: `src/components/dashboard/EventsWorkspace.tsx`
- Modify: `src/components/dashboard/usg-nav.ts`
- Modify: `src/components/dashboard/lsg-nav.ts`
- Modify: `src/lib/auth/messages.ts`

**Interfaces:**
- Consumes: `smartgov.events`, existing upload/download APIs.
- Produces:
  - `AccomplishmentReportStatus = "submitted" | "acknowledged" | "returned"`.
  - `AccomplishmentReportRow { id, eventId, eventTitle, unitName, status, submittedAt }`.
  - `GET /api/accomplishment-reports?eventId -> { ok, rows }`.
  - `POST /api/accomplishment-reports { eventId, narrative, highlights, attachmentSubmissionId? } -> { ok, id }`.
  - `POST /api/accomplishment-reports/[id]/review { decision, remark? } -> { ok }`.

- [ ] **Step 1: Write failing assertions**

Assert migration contains `accomplishment_reports`, `event_id`, `reporting_unit`, `submit_accomplishment_report`, `review_accomplishment_report`, `revoke all`, and `grant execute`.

- [ ] **Step 2: Run the gate and verify it fails**

Run: `npm run check:features`
Expected: FAIL.

- [ ] **Step 3: Create and apply the migration**

Enforce one report per event per reporting unit. Derive author/unit from session. Allow only USG reviewers to acknowledge or return LSG reports.

Run: `node scripts/apply-migration.mjs supabase/migrations/20260101003250_accomplishment_reports.sql`
Expected: success.

- [ ] **Step 4: Add lib, routes, and panel**

Add typed client helpers and route handlers with awaited dynamic params. Add `AccomplishmentPanel` filtered by event.

- [ ] **Step 5: Wire Events tab and child links**

Add `Accomplishment` to `EventsWorkspace` tabs and append child links in both nav builders.

- [ ] **Step 6: Run gates**

Run: `npm run check:features`, `npm run lint`, `npx tsc --noEmit`, `npm run check:interactions`, `npm run test:authority`
Expected: all PASS.

---

## Task 9: In-app feedback

**Files:**
- Create: `supabase/migrations/20260101003260_feedback.sql`
- Create: `src/lib/feedback.ts`
- Create: `src/app/api/feedback/route.ts`
- Create: `src/app/api/feedback/[id]/route.ts`
- Create: `src/app/api/feedback/[id]/acknowledge/route.ts`
- Create: `src/components/dashboard/FeedbackPanel.tsx`
- Modify: `src/app/usg/manage/page.tsx`
- Modify: `src/app/lsg/manage/page.tsx`
- Modify: `src/components/dashboard/usg-nav.ts`
- Modify: `src/components/dashboard/lsg-nav.ts`
- Modify: `src/lib/auth/messages.ts`

**Interfaces:**
- Consumes: session identity when available.
- Produces:
  - `FeedbackStatus = "new" | "acknowledged"`.
  - `FeedbackEntry { id, subject, message, status, createdAt, acknowledgedAt, acknowledgedBy }`.
  - `POST /api/feedback { subject, message } -> { ok, id }`.
  - `GET /api/feedback -> { ok, rows }`.
  - `POST /api/feedback/[id]/acknowledge -> { ok }`.

- [ ] **Step 1: Write failing assertions**

Assert migration contains `feedback_entries`, `create_feedback`, `list_feedback`, `acknowledge_feedback`, `revoke all`, and `grant execute`; assert no file contains `docs.google.com`.

- [ ] **Step 2: Run the gate and verify it fails**

Run: `npm run check:features`
Expected: FAIL.

- [ ] **Step 3: Create and apply the migration**

Store organization, optional submitter identity, subject, message, status, acknowledgement fields, timestamps. Only reviewers may list/acknowledge; submitters may create only.

Run: `node scripts/apply-migration.mjs supabase/migrations/20260101003260_feedback.sql`
Expected: success.

- [ ] **Step 4: Add lib, routes, and panel**

Add the in-app submit form, reviewer list, and acknowledge action. Empty state uses existing styles. No external form script or link.

- [ ] **Step 5: Add Manage tabs and child links**

Append `Feedback` after existing Manage children on both sides. LSG sees submit form; USG reviewers see list/acknowledge.

- [ ] **Step 6: Run gates**

Run: `npm run check:features`, `npm run lint`, `npx tsc --noEmit`, `npm run check:interactions`, `npm run test:authority`
Expected: all PASS.

---

## Task 10: Officer profile fields and accounts

**Files:**
- Create: `supabase/migrations/20260101003270_officer_profile_fields.sql`
- Create: `src/app/api/profile/officer/route.ts`
- Create: `src/components/dashboard/OfficerProfileFields.tsx`
- Create: `src/components/dashboard/AccountsPanel.tsx`
- Modify: `src/app/usg/manage/page.tsx`
- Modify: `src/app/lsg/manage/page.tsx`
- Modify: `src/components/dashboard/usg-nav.ts`
- Modify: `src/components/dashboard/lsg-nav.ts`
- Modify: `src/lib/auth/messages.ts`

**Interfaces:**
- Consumes: current account/profile surface and existing account list RPC.
- Produces:
  - `OfficerProfile { fullName, campusDepartment, program, position }`.
  - `GET/PATCH /api/profile/officer`.
  - `AccountsPanel` shows full name, campus/department, program, position, email, role, status, and actions.

- [ ] **Step 1: Write failing assertions**

Assert migration contains `full_name`, `campus_department`, `program`, `position`, `update_officer_profile`, `revoke all`, and `grant execute`; assert route and panel exist.

- [ ] **Step 2: Run the gate and verify it fails**

Run: `npm run check:features`
Expected: FAIL.

- [ ] **Step 3: Create and apply the migration**

Add controlled profile fields and read/update RPCs. Officers edit their own fields; USG owners read all LSG officer fields. Email and role remain immutable.

Run: `node scripts/apply-migration.mjs supabase/migrations/20260101003270_officer_profile_fields.sql`
Expected: success.

- [ ] **Step 4: Add route and components**

Add `/api/profile/officer`, `OfficerProfileFields`, and `AccountsPanel` using existing table/form styles.

- [ ] **Step 5: Add Manage tabs and child links**

Add `Accounts` under USG Manage only. Show profile fields in the relevant Profile tabs on both sides.

- [ ] **Step 6: Run gates**

Run: `npm run check:features`, `npm run lint`, `npx tsc --noEmit`, `npm run check:units`, `npm run check:authority` equivalent `npm run test:authority`
Expected: all PASS.

---

## Task 11: Runtime authority, tours, final gates, and report

**Files:**
- Modify: `scripts/check-authority.mjs`
- Modify: `scripts/check-e2e.mjs`
- Modify: `scripts/check-smoke.mjs`
- Modify: `scripts/check-tours-ui.mjs`
- Modify: `src/lib/tours/pages/usg-*.ts`
- Modify: `src/lib/tours/pages/lsg-*.ts`
- Modify: `docs/final-report.md`

**Interfaces:**
- Consumes: all APIs and tabs from Tasks 3–10.
- Produces: complete sequential gate run and updated final report.

- [ ] **Step 1: Add API authority tests**

Extend `scripts/check-authority.mjs` with anonymous, wrong-side, and wrong-account denials for:
- `/api/resolutions`
- `/api/documents`
- `/api/budgets` with `eventId`
- `/api/feed`
- `/api/monitoring`
- `/api/accomplishment-reports`
- `/api/feedback`
- `/api/profile/officer`

Expected: unauthenticated requests fail; LSG cannot call USG-only routes; cross-account reads fail.

- [ ] **Step 2: Add browser navigation tests**

Extend `scripts/check-e2e.mjs` and `scripts/check-tours-ui.mjs` to open each new tab for the correct side, verify breadcrumb/tab highlight, and verify wrong-side role wall remains intact. Do not add new `page.tsx` routes.

- [ ] **Step 3: Add empty/error state tests**

Extend UI checks for empty search results, failed submit visible error, and submit button not stuck after failure.

- [ ] **Step 4: Update tours**

Add anchors for new tabs to existing USG/LSG Request, Events, and Manage tour files. Keep tour version bumps stable and do not reorder existing steps.

- [ ] **Step 5: Run static/build gates sequentially**

Run in order:
```powershell
npm run lint
npx tsc --noEmit
npm run build
npm run check:features
npm run check:reveal
npm run check:tours
npm run check:interactions
npm run check:federated
npm run check:units
npm run check:compliance
```
Expected: all PASS.

- [ ] **Step 6: Start production server**

Run: `npm start`
Expected: server on `http://localhost:3000`.

- [ ] **Step 7: Run runtime/UI gates sequentially**

Run in order:
```powershell
npm run check:smoke
npm run test:authority
npm run test:e2e
npm run check:interactions:ui
npm run check:tours:ui
npm run check:dashboard
npm run audit:connections
```
Expected: all PASS; dashboard remains `25/25`; connection audit has `orphan_fk_rows = 0`.

- [ ] **Step 8: Update the final report**

Update `docs/final-report.md` with the new modules, migration list, gate counts, and confirmation that dashboard arrangement and saved layouts were unchanged.

- [ ] **Step 9: Verify no unintended changes**

Run: `git diff --check` and `git status --short`.
Expected: no whitespace errors; `paperworks/` remains untracked; no commit created.

---

## Self-review notes

- Spec coverage: dashboard stability (Task 2), requirements split (Task 3 UI + existing task panel), resolutions (Task 3), documents/search (Task 4), event budgets (Task 5), calendar/future events (Task 6), monitoring (Task 7), accomplishment reports (Task 8), feedback (Task 9), officer/account profiles (Task 10), gates/report (Task 11).
- Review Focus coverage: layout stability (Task 2), role/account leakage (Task 11), status vocabulary (Task 2), server-computed totals/session identity (Tasks 3, 5, 8), empty/error states (Tasks 4, 9, 11).
- No new top-level nav ids or overview widgets are introduced.
- All client-supplied identity and totals are rejected at the RPC layer.
- No commit steps are included because the user has not requested a commit.
