# Federated Government Modules Design

Date: 2026-11-18

## Intent

Add the missing government-facing functions described in `FOR LSG.docx`, `FOR USG.docx`, and their embedded screenshots without changing the current dashboard arrangement. The screenshots are a function/style reference only. The workspace shell, card order, widget order, saved layout behavior, and visual language stay as they are.

The work completes the federated flow: LSG and USG can exchange requirements and resolutions, propose events with dates and budgets, track statuses, find approved documents, and review cross-campus monitoring data.

## Goals

- Preserve the six top-level dashboard tiles and their order exactly.
- Preserve saved widget order, visibility, and width behavior.
- Add functionality inside existing role sections as child tabs, panels, and links.
- Keep all data scoped by authenticated session, organization, role, and unit.
- Use the existing `security definer` → private `smartgov` RPC → public wrapper → route handler → UI pattern.
- Reuse existing backend work for proposals, budgets, feed/calendar, uploads, and dashboard where possible.
- Add new backend only for genuinely missing domains: resolutions, document catalog/search, event-budget link, unified calendar, monitoring by campus, accomplishment reports, feedback, and officer profile fields.

## Non-goals

- No visual redesign or screenshot reproduction.
- No new top-level nav tiles.
- No changes to `FederatedOverview` widget ids, default widget list, SQL whitelist, or saved-layout merge order.
- No reordering, renaming, or removal of existing nav ids.
- No RLS policies, direct table grants, direct table reads from the client, or `service_role`.
- No changes to the current dashboard card arrangement; only the data behind it may become more complete.
- No commit or push.

## Constraints

- Follow `AGENTS.md`: read the relevant guide in `node_modules/next/dist/docs/` before writing code.
- Route handlers use Web `Request`/`Response`; dynamic route params are promises in Server Components; client-only interactivity uses leaf `'use client'` components.
- Tests and UI gates must run sequentially because parallel gates can fight over `.next`.
- Runtime/UI gates use the local server and credentials file; never print credentials or the remote URL/token.
- Current worktree already has uncommitted dashboard/widget changes and untracked `paperworks/`; leave them intact.

## Approaches

### A. Restore deleted screens from git history

Recover `RequirementWorkspace`, `ReviewInbox`, `ProposalForm`, budget pages, and mockdashboard panels from `2b6fd82^` and reconnect them.

Tradeoff: fastest reuse, but old components contain stale task status vocabulary and obsolete route assumptions, and would bring back retired top-level routes that conflict with the current IA.

### B. Finish modules inside the current UI shell

Use the existing role layouts, nav structure, panels, and APIs; add missing migrations/routes/components and expose them as child tabs under existing sections.

Tradeoff: more integration work, but it preserves the current dashboard arrangement and visual language, keeps all new code on the current security pattern, and avoids resurrecting retired routes.

### C. Dashboard-only wiring

Surface existing backend counts in overview cards and add links, without full module screens.

Tradeoff: smallest change, but does not deliver resolutions, document search, event budgets, monitoring, or accounts. Rejected as incomplete.

## Selected approach

Approach B. Existing deleted components may be read as reference, but not restored wholesale. New modules are built as tabs under `Request`, `Events`, and `Manage`; no top-level nav ids or dashboard widgets change.

## UI surface mapping

| Function | Surface | Notes |
|---|---|---|
| Requirements from USG | `Request` → existing Tasks panel | Keep existing task UI. Extend labels/statuses only where needed. |
| Requirements from LSG | `Request` → Requirements tab | Use proposals/program submissions; show submitted requirements from the caller's unit and org-wide approved ones where appropriate. |
| Resolutions | `Request` → Resolutions tab | Create form, list, detail, and USG review controls. |
| Status tracking | `Request` → Status tab | Consolidated list with type/status/campus filters. |
| Event proposals | `Events` → Proposals tab | Existing Events workspace; add budget entry and explicit event date calendar. |
| Shared/future calendar | `Events` → Calendar and Future tabs | Unified approved events from proposals and events, with upcoming/past split. |
| Budget | `Manage` → Budget tab | Existing budget APIs; include event-linked rows, requested/approved/remaining totals. |
| Documents | `Manage` → Documents tab | Approved document library using the new catalog. |
| Search | `Manage` → Search tab | Title/description/keyword search; results show title and download link. |
| Monitoring | `USG Manage` → Monitoring tab | USG-only status counts by campus and export CSV. |
| Accomplishment reports | `Events` → Accomplishment tab | Per-event reports for both LSG- and USG-conducted events, with attachment and review state. |
| Feedback | `Manage` → Feedback tab | In-app student feedback form, stored entries, and acknowledgement. |
| Accounts | `USG Manage` → Accounts tab | List/deactivate plus the required full name, campus/department, program, and position fields. |

Child links are appended after existing children in each nav builder. Existing first-four top-level nav ids remain untouched.

## Data design

### Resolutions

New migration `supabase/migrations/20260101003200_resolutions.sql`:

- `smartgov.resolutions`: organization, unit, creator, title, body, status, timestamps.
- `smartgov.resolution_reviews`: decision, remark, reviewer, timestamp.
- Statuses: `submitted`, `under_review`, `approved`, `returned`, `published`.
- RPCs: create, list, detail, review.
- USG sees all organization resolutions; LSG sees its own unit plus org-wide `approved`/`published` rows.
- Only USG reviewers may review.
- Public wrappers with `revoke all` then `grant execute` to `anon, authenticated`.

### Document catalog and search

New migration `supabase/migrations/20260101003210_document_catalog_and_search.sql`:

- `smartgov.document_catalog` keyed by `item_submissions.id`.
- Metadata: `title`, `description`, `keywords`, `group_kind`, `group_id`, `group_label`, `approval_status`, approver, approval timestamp, timestamps.
- Search index over title, description, and keywords.
- RPCs: set metadata, approve document, list documents, search documents.
- Bytes remain in Postgres large objects; results return `submissionId` and download through `/api/files/[submissionId]`.
- Approved catalog rows are visible org-wide; non-approved rows are limited to author/unit/reviewers.
- `group_kind` is one of `requirement`, `resolution`, or `event`; `group_label` is shown in Documents and used as a filter so documents can be found per resolution or part.
- Extend `smartgov.get_document` so approved catalog rows are downloadable by users who can see them.

### Event budget link

New migration `supabase/migrations/20260101003220_event_budget_link.sql`:

- Add nullable `event_id` to `smartgov.budget_requests`.
- Guard that a budget request cannot reference both a proposal and an event.
- Add `submit_event_budget` RPC using the existing `budget_write_items` validation.
- Extend budget list/detail output with `eventId`, `eventTitle`, and `eventDate`.
- Keep totals computed in SQL; client never sends subtotals.
- Remaining budget uses the existing `requested`, `approved`, `remaining` summary model.

### Unified calendar

New migration `supabase/migrations/20260101003230_unified_calendar.sql`:

- Replace `smartgov.list_calendar` body with a union of proposal rows and event rows.
- Keep the existing SQL signature so current wrappers stay valid.
- Include source discriminator, item id, title, date/time, timezone, venue, campus, status, and honor status.
- Show `upcoming`, `claimed`, and `honored` approved events; exclude `cancelled`, `rejected`, and `not_honored`.
- No hard-coded `/usg` or `/lsg` links in SQL.

### Monitoring by campus

New migration `supabase/migrations/20260101003240_monitoring_by_campus.sql`:

- `smartgov.monitoring_by_campus(p_session_token)` returns JSON.
- USG-only; organization scoped.
- Group by canonical top-level campus/college/department in `public.governance_units`, not free-text campus names.
- Return status counts for proposals, budgets, events, documents, tasks, requests, surveys, structures, and resolutions.
- Public wrapper with revoke/grant.

### Accomplishment reports

New migration `supabase/migrations/20260101003250_accomplishment_reports.sql`:

- `smartgov.accomplishment_reports`: organization, event, reporting unit, author, narrative, highlights, attachments, status, review fields, timestamps.
- One report per event per reporting unit; report can be revised after return.
- Both LSG and USG may file for events they conducted; USG reviewers may acknowledge or return LSG reports.
- RPCs: list events eligible for reports, save draft, submit, review, detail.
- Public wrappers with revoke/grant.
- Attachments reuse the existing document upload/file access layer.

### Feedback

New migration `supabase/migrations/20260101003260_feedback.sql`:

- `smartgov.feedback_entries`: organization, submitter identity when available, subject, message, source, status, acknowledgement fields, timestamps.
- In-app submission and acknowledgement only; no Google Form dependency.
- RPCs: create entry, list entries, acknowledge, detail.
- Only reviewers may list/acknowledge; submitters can create only.
- Public wrappers with revoke/grant.

### Officer profile fields

New migration `supabase/migrations/20260101003270_officer_profile_fields.sql`:

- Add `full_name`, `campus_department`, `program`, and `position` to the existing officer/account profile surface without replacing current identity fields.
- Add controlled read/update RPCs so an officer can edit their own fields and USG owners can read all LSG officer fields.
- Keep login email and role immutable through these endpoints.
- Show the fields on the USG Accounts tab and the relevant Profile tab.

## API design

Add or extend:

- `GET/POST /api/resolutions`, `GET /api/resolutions/[id]`, `POST /api/resolutions/[id]/review`.
- `GET /api/documents` with `q`, `type`, `status`, and `limit`.
- `PATCH /api/documents/[submissionId]` and `POST /api/documents/[submissionId]/approve` for reviewers.
- `POST /api/budgets` accepts `eventId`; existing decision routes unchanged.
- `POST /api/feed` remains the calendar endpoint; expand its `CalendarEvent` type.
- `GET /api/monitoring`.
- `GET /api/accounts` plus a deactivate action if no current endpoint exists.
- `GET/POST /api/accomplishment-reports`, `GET /api/accomplishment-reports/[id]`, `POST /api/accomplishment-reports/[id]/review`.
- `GET/POST /api/feedback`, `GET /api/feedback/[id]`, `POST /api/feedback/[id]/acknowledge`.
- `GET/PATCH /api/profile/officer` for the required officer profile fields.

Use `callRpc` with session token; never accept caller-supplied organization, unit, role, or author identity.

## UI implementation rules

- Do not modify `FederatedOverview.tsx`, widget defaults, layout route validation, or `20260101003194_dashboard_widget_preferences.sql`.
- Do not modify top-level nav ids or their order in `usg-nav.ts` and `lsg-nav.ts`; append child links only.
- Add tabs using the existing query-string-as-source-of-truth pattern in `manage/page.tsx`.
- Reuse existing tab button classes, section headers, cards, badges, tables, and empty states.
- New components go under `src/components/dashboard/` using the current naming convention.
- New client components are leaves; pages remain thin.
- Failure paths must render visible error states and must not leave submit buttons stuck.

## Status presentation

Do not force every module into one database enum. Display local statuses with a shared visual vocabulary:

- Pending: `submitted`, `assigned`, `awaiting`, `draft` where user-facing.
- Under review: `under_review`, `in_progress`, `claimed`.
- Approved: `approved`, `published`, `done`, `honored`, `verified`.
- Returned: `returned`, `queried`.
- Rejected/Cancelled remain distinct where the source module supports them.

Monitoring and status tracking count the source status families explicitly.

## Product calls

These defaults are builder calls, not pending questions:

- Approved document means explicit `approval_status = 'approved'` in the new catalog.
- LSG resolution visibility includes its own unit plus org-wide `approved`/`published` rows.
- Event budget is a separate budget request attached from the event detail view after the event exists.
- Calendar includes `upcoming`, `claimed`, and `honored` events, excluding cancelled/rejected/not-honored.
- Reporting campus includes top-level `campus`, `college`, and `department` units beneath the USG root.
- No new spending ledger; `remaining` comes from the existing approved-versus-requested summary.
- Accomplishment reports are filed per conducted event by the side that conducted it; LSG reports are reviewable by USG.
- Feedback is stored in-app; user confirmed in-app feedback on 2026-11-18.
- Officer profile fields are required in both the Accounts list and the officer's own profile.
- Overview cards keep their current labels and order; monitoring/status tabs own the new counts.

## Implementation order

1. Read relevant Next.js docs from `node_modules/next/dist/docs/`.
2. Add resolution schema/RPCs/wrappers, routes, client types, and Request tab.
3. Add document catalog/search schema/RPCs/wrappers, routes, client types, and Manage tabs.
4. Add event budget link, extend budget types/routes, and add event-detail budget entry.
5. Replace calendar function body, expand feed types, and add Calendar/Future tabs.
6. Add monitoring RPC/route and USG Manage tab.
7. Add accounts list/deactivate and officer profile fields under Manage.
8. Add accomplishment reports and feedback modules.
9. Add/extend static and runtime tests for role walls, API denials, nav stability, and saved dashboard layout stability.
10. Run all gates sequentially and update `docs/final-report.md`.

## Verification

Static/build gates:

```powershell
npm run lint
npx tsc --noEmit
npm run build
npm run check:reveal
npm run check:tours
npm run check:interactions
npm run check:federated
npm run check:units
npm run check:compliance
```

Runtime/UI gates after starting the production server:

```powershell
npm run check:smoke
npm run test:authority
npm run test:e2e
npm run check:interactions:ui
npm run check:tours:ui
npm run check:dashboard
npm run audit:connections
```

Passthrough criteria: all existing gates remain green, new endpoints reject anonymous/wrong-side/wrong-account calls, and a saved dashboard layout retains identical tile ids/order/hidden/wide values after deployment.
