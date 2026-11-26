# SmartGov Redesign Plan (USG + LSG)

Status model for every phase: **PENDING, DRAFT, UNDER REVIEW, RETURNED, APPROVED, REJECTED, OVERDUE**, plus a **LATE SUBMISSION** flag.

Source of truth: `SYSTEM_FEATURE_MAP.txt` (Phase 0 analysis, 2026-11-26, HEAD b6dc39d plus working tree).

## Why this plan starts with a status fix

`supabase/migrations/20260101004600_unified_status_model.sql` is the newest migration. It rewrites status constraints to `pending / draft / under_review / approved / rejected / overdue`, but almost every RPC, API route, lib, and panel still writes or filters the old values (`submitted`, `returned`, `published`, `open`, `claimed`, `acknowledged`, `granted`, `superseded`). It also has no `returned`, which the brief requires.

That means the system is currently inconsistent in one of two ways:

- If 04600 is not applied: the TS/libs already speak unified statuses, but the database produces legacy rows.
- If 04600 is applied: most review and submit paths fail, and public feedback forms stop accepting responses.

P1 reconciles this before any new feature is added. Nothing in P2-P10 is safe until P1 ships.

## Working rules for every phase

- Keep the stack, folder structure, auth model, and `AppShell`/tile/badge/modal/table patterns.
- Every data change is a new numbered migration. Never edit an applied migration; supersede it.
- Every button either works or is removed/disabled with "No functionality yet".
- Merge duplicates; redirect old URLs instead of breaking them.
- Reuse existing components; no new visual theme.
- Run typecheck and lint on every phase that changes code; run the Playwright suite on P10.
- Append a summary to `CHANGELOG_SYSTEM_REDESIGN.txt` after each phase (see Open Questions for the Phase 0 exception).

---

## P1. Unified status model and Submit for Review

**Goal:** one status vocabulary in SQL, TS, API, and UI, including `RETURNED`, with one explicit submit transition.

**Data (new migration `20260101004700_status_model_reconcile.sql`)**
- Supersede 04600 with a canonical check that includes `returned` and keeps values the running features still need:
  - Core: `pending`, `draft`, `under_review`, `returned`, `approved`, `rejected`, `overdue`.
  - Per-module sub-states that must survive: `published_at` for resolutions/proposals (prefer a timestamp over a status), `open`/`closed` for feedback forms and surveys, `cancelled` for events, `superseded` for structures, `acknowledged` for accomplishment (or map it to `approved` in the same migration).
- Add shared columns where missing: `submitted_at`, `submitted_by`, `reviewed_at`, `reviewed_by`, `returned_at`, `returned_reason`, `late_submission boolean not null default false`.
- Backfill every legacy value to the canonical set and keep the legacy text in a `legacy_status` column only where audit needs it.
- Add one transition function `smartgov.submit_for_review(p_session_token, p_entity_type, p_entity_id, p_note)` with a whitelist of entity types, plus thin per-entity wrappers so existing routes keep working. It sets `submitted_at`, computes `late_submission` from the due date, writes `under_review` or `pending` per module, and emits an audit row.
- Add `smartgov.review_item(...)` as the single return/approve/reject path, or keep per-entity RPCs but make them all accept `returned`.

**Code**
- `src/lib/status.ts`: add `returned`; export one `STATUS_LABEL`, `STATUS_CLASS`, `LEGACY_TO_STATUS`, `normalizeStatus`, `isReviewable`, `isOpen`, `isLate`. Delete per-panel status maps.
- Add `src/lib/submit.ts` with a typed `submitForReview(entityType, id, note)` client helper and the entity-type union.
- Replace local status unions/maps in `RequestSection.tsx`, `RequirementsPanel.tsx`, `ResolutionPanel.tsx`, `AccomplishmentPanel.tsx`, `EventsWorkspace.tsx`, `MonitoringPanel.tsx` with `src/lib/status.ts`.
- Fix the API filters that drop rows: `/api/tasks` must include `submitted` and the unified set; `/api/overview` must stop filtering `submitted/claimed/upcoming/open`; budget open counts must use the unified set.
- Add a "Submit for review" button to every reviewable item: tasks (per-unit assignment), proposals, personal requests, resolutions, budgets, structures, accomplishment reports. Reuse one confirmation modal.
- Make the review decisions consistent: `under_review`, `returned`, `approved`, `rejected` (and `published` only through the publication action, not a raw status).

**MERGE:** all status labels/classes/normalizers into `src/lib/status.ts`; all submit buttons into one `SubmitForReviewButton`.

**REMOVE:** duplicate status maps in panels; legacy literals in API filters; the dead `status === "submitted"` branches.

**ADD:** `returned` end to end; submit transition; audit row per transition; late flag at submit.

**Reason:** without this, every later phase would be built on contradictory states. The brief explicitly requires RETURNED and late submission; 04600 currently deletes both semantics.

**Done when:** a unit can submit, USG can return with a reason, the unit can resubmit, and the item appears as RETURNED/LATE in the list for all four roles. No module writes a value outside the canonical set. Typecheck and lint pass.

---

## P2. Deadlines, extensions, overdue, and late submission

**Goal:** every reviewable item has a real deadline, a derived overdue state, a late flag, and an extension request flow.

**Data (new migration `20260101004800_deadlines_and_extensions.sql`)**
- Add `due_at timestamptz` (or keep `due_date` where it exists) to tasks, proposals, personal requests, resolutions, budget requests, structures, accomplishment reports.
- Create `deadline_extensions` with `entity_type`, `entity_id`, `requested_by`, `requested_due_at`, `reason`, `status` (`pending/approved/rejected`), `decided_by`, `decided_at`, `decision_note`.
- Backfill `deadline_extensions` from `task_extensions`; keep the old table readable until the UI moves, then drop it in a later migration.
- Add `smartgov.request_deadline_extension(...)` and `smartgov.decide_deadline_extension(...)`, and one `smartgov.list_overdue(...)` view/function that computes overdue from the effective due date (original or approved extension).
- Compute `late_submission` in the submit function from the effective due date; never store a separate "late" status.

**Code**
- Add `src/lib/deadlines.ts` for effective due date, overdue, late label, and countdown formatting. Replace scattered logic in `src/lib/tasks.ts` and panels.
- Show due date, extension state, OVERDUE badge, and LATE flag on every list row and detail.
- Add "Request extension" and "Decide extension" actions (unit and USG respectively) using the existing modal/table patterns.
- Add filters: Overdue, Due soon, Late.

**MERGE:** all overdue math into `src/lib/deadlines.ts`; extension UI into one component used by tasks, proposals, and requests.

**REMOVE:** the task-only extension assumption; duplicate overdue derivations in components.

**ADD:** generic extensions; late flag; overdue filters; deadline columns on the items that lack them.

**Reason:** the brief requires deadlines, extensions, overdue, and late submission. Today only tasks have extensions and overdue, and late submission is not modeled at all.

**Done when:** approving an extension moves the effective due date everywhere; an item submitted after the effective due date is LATE and not APPROVED; overdue items appear in the review queue and Overview.

---

## P3. USG review queue and timeline

**Goal:** one place where USG sees everything waiting on it, with a consistent timeline.

**Data (new migration `20260101004900_review_queue.sql`)**
- Add `smartgov.list_review_queue(p_session_token, p_filters)` returning a union of pending/under-review items across tasks, proposals, personal requests, resolutions, budgets, structures, accomplishment reports, events (honour), and documents, with `entity_type`, `entity_id`, `title`, `unit`, `status`, `submitted_at`, `due_at`, `late_submission`, `href`.
- Add `smartgov.list_item_timeline(p_session_token, p_entity_type, p_entity_id)` returning actor, action, from/to status, note, timestamp from audit rows.
- Ensure the submit/review functions from P1 write the audit rows this reads.

**Code**
- Add `/usg/review` (new route) and a "Review queue" nav entry under Manage. Reuse `AppShell`, badges, tables, filters, and the existing review modals.
- Overview gets a "Needs your review" card that links into the queue with the right filter.
- Add `src/components/dashboard/ReviewQueue.tsx` and `src/components/dashboard/ReviewTimeline.tsx`; both are generic and reused by each module's detail.
- Each module list keeps its own filters but links to the same timeline.

**MERGE:** structure queue, document approvals, budget review, proposal review, resolution review, accomplishment review, event honour, and personal requests into one queue view. Keep the module lists as filtered views of the same data.

**REMOVE:** duplicate "review" surfaces that only re-list pending items (for example the standalone structure queue panel) once the queue covers them.

**ADD:** queue route, nav item, unified filters, timeline.

**Reason:** USG reviewers currently hunt through five tabs; the brief asks for a review queue and a timeline. One query also removes the risk of each module drifting again.

**Done when:** every pending item of every type appears in `/usg/review`; acting on it updates the module list, Overview, and timeline; no item is visible to the wrong side/role.

---

## P4. Budget data model

**Goal:** move from request-only budgets to allocation vs request vs expense, with periods.

**Data (new migration `20260101005000_budget_model.sql`)**
- Add `budget_periods` (`id`, `organization_id`, `name`, `starts_on`, `ends_on`, `is_active`).
- Add `budget_allocations` (`period_id`, `unit_id`, `category`, `amount`, `note`).
- Add `budget_requests.period_id`, `category`, and the P1 review columns.
- Add `budget_items.category`; link `budget_expenses` to request/item and period.
- Backfill: one active period from the current school year; allocate existing approved totals so remaining math is not negative on day one.
- Add `smartgov.budget_summary(period, unit)` returning allocated, requested, approved, spent, remaining, by category.
- Tighten RLS/grants so a unit reads only its allocations/requests and USG reads all.

**Code**
- `src/lib/budgets.ts`: replace the local totals with the SQL summary; keep the unified status types.
- `BudgetPanel`: use the summary; stop computing "requested less approved" as remaining.
- Add period selector and category fields to the request form.

**MERGE:** USG and LSG budget views into one role-aware component; one summary source.

**REMOVE:** the incorrect `remaining = requested - approved` math; duplicate totals computed in the component.

**ADD:** periods, allocations, categories, expense linkage, summary RPC.

**Reason:** the brief asks for a budget data model; the current schema cannot answer "how much is left for this unit this period", which is the core budget question.

**Done when:** a unit sees allocation, approved, spent, and remaining for the active period; USG sees the same across units; every total comes from SQL, not the client.

---

## P5. Budget UI

**Goal:** make the P4 model usable for both sides without adding a second budget surface.

**Data (new migration `20260101005100_budget_views.sql` only if views/indexes are needed)**
- Add indexes on `budget_requests(period_id, unit_id, status)` and `budget_expenses(request_id)`.
- Add a read view for the LSG compact card if it avoids a second query.

**Code**
- `BudgetPanel` tabs: Overview, Requests, Allocations, Expenses.
- USG: edit allocations, review requests (approve/return/reject with remark), see per-unit and per-category breakdown.
- LSG: file a request, see allocation/remaining, see decisions and remarks.
- Reuse the existing tiles and tables; add one small bar/stacked chart using the current chart primitives.
- The LSG Request page gets a compact budget card that links to Manage > Budget instead of a second full form.

**MERGE:** `LsgRequestBudgetPanel` into the shared `BudgetPanel`; keep only a summary card on Request.

**REMOVE:** the duplicate budget form on the Request page; duplicate total cards that disagree with SQL.

**ADD:** allocation editor, category breakdown, expense view, period switcher.

**Reason:** two budget surfaces already disagree; the brief says merge duplicates and keep one working path.

**Done when:** there is exactly one budget screen per side; the Request page card and Manage > Budget show identical numbers; approve/return works with the unified statuses.

---

## P6. Request section (Tasks, Requirements, Personal, Resolutions)

**Goal:** one Request section with consistent statuses, submit/return loops, deadlines, and timelines.

### Phase 6 decision (resolved from code)

- Tasks and Requirements are merged at the data/lifecycle level: requirements remain children of tasks, and the Requirements tab is only a flat filter view that opens the parent task.
- Personal Requests and Resolutions are not merged into one data flow or tab. The code shows different tables/data paths (`/api/requests` vs `/api/resolutions`), different schemas (`needed_on`/`link` vs `resolution_no`/`date_passed`/`proposed_budget`/`scope`), different visibility rules, and different decision and reply/resubmit behavior. Keep four explicit tabs: Tasks, Requirements, Personal Requests, Resolutions.
- Old URLs are preserved as redirects. Canonical tab URLs use `?tab=tasks|requirements|personal|resolutions`.

**Data (new migration `20260101005200_request_unification.sql`)**
- Apply the P1 columns and P2 deadlines to tasks, proposals, personal requests, and resolutions.
- Normalize proposal requirement states to `pending/submitted/accepted/waived` and expose them through the unified status labels.
- Add `published_at` to resolutions/proposals if publication is kept as a timestamp (see Open Questions).
- Fix the task assignment default so `create_task` does not depend on a legacy default; insert `pending` explicitly.
- Add indexes for the Request lists: `(unit_id, status)`, `(status, submitted_at)`.

**Code**
- Tabs: Tasks, Requirements, Personal Requests, Resolutions. Rename "Requirements" in the UI to "Requirements & Proposals" so the table behind it is clear.
- Use `src/lib/status.ts` everywhere; delete the local `PROPOSAL_STATUS` and the `PersonalReq` status union.
- Add Submit for Review, Return with remark, Resubmit, and Timeline to each tab.
- Fix the resolution review contract: `ResolutionDecision` includes `under_review` and `published` (or publication becomes a separate action), and rows go through `normalizeStatus`.
- Fix accomplishment review: decision values become `approved/returned/rejected` (or keep `acknowledged` if the product wants it) and match SQL.
- Task list: include `submitted`; show per-unit assignment status and late flag.
- Proposals: show requirement progress; verify action only when all requirements are submitted/accepted.
- Personal requests: map `granted/declined/needs_revision` to `approved/rejected/returned` in the UI and keep the reason visible.
- Resolutions: keep the public record; publication is a distinct action.

**MERGE:** personal-requests alias routes already redirect into `request?tab=personal`; keep the redirects and remove the duplicate page components. Merge the resolution "letter dashboard" widget into the Resolutions tab.

**REMOVE:** local status maps; the stale `/api/tasks` filter; the `approved/rejected` accomplishment mismatch; duplicate review buttons that call different endpoints for the same transition.

**ADD:** submit/return/resubmit loops; deadlines and late flags; timeline; requirement progress.

**Reason:** the Request section is the core of the system, and it currently has four different status dialects. Unifying it is the main user-visible win of P1.

**Done when:** a task, proposal, personal request, and resolution can each go submit -> under review -> returned -> resubmit -> approved/rejected, with the same badges and timeline, and no panel owns a private status map.

---

## P7. Dashboards (USG/LSG Overview and Monitoring)

**Goal:** dashboards are linear action paths, not decorative totals: a short header, one status strip, then the next decisions and deadlines.

**Data**
- No new migration for the dashboard rewrite. `GET /api/overview?side=lsg|usg` derives the payload from existing list endpoints/RPCs: `list_my_tasks`, `list_review_queue`, `lsg_budget_dashboard`, and `budget_summary`.
- Keep the legacy `counts`/`breakdown` contract for existing audit scripts while adding side-specific `lsg`/`usg` payloads.
- Late remains separate from overdue; no status count conflates them.

**Code**
- `FederatedOverview`: shared component with `nav`-derived links only; no hard-coded side routes and no `useRouter`.
- LSG path: status strip, next action banner with countdown, five due-soon items, recent USG decisions, unit budget snapshot, Request/Events/Inbox shortcuts.
- USG path: status strip, "Needs review now" with Review Queue action, LSGs falling behind, per-task submission progress, university budget summary, Create Task/Events/Inbox shortcuts.
- `RequestSection` accepts `?status`, `?unit`, and `?task` deep links so overview actions land on the exact filtered list or task.
- Tours use the new overview anchors: `workspace-header`, `workspace-tiles`, `workspace-overview-action`, `workspace-overview-list`, `workspace-overview-budget`, `workspace-shortcuts`.

**MERGE:** monitoring counts into the same `/api/overview` contract; one metric definition per number.

**REMOVE:** saved-layout/widget customization from the overview; duplicate overview widgets; decorative numbers without a click path.

**ADD:** side-aware overview API, status strip deep links, action banners, deadline/decision lists, overdue-unit drill-down, task progress, budget drill-down.

**Reason:** the user rejected the old decorative widget grid; the overview must move work forward in one direction and every number must point to the exact list behind it.

**Done when:** LSG and USG overviews match their linear paths, every status/progress/budget action opens the matching filtered Request or Manage surface, old widget tour/script assertions are gone, and typecheck/lint/check scripts pass at the existing baseline.

---

## P8. Merges, cleanup, and redirects

**Goal:** remove duplicate surfaces and dead code, with redirects instead of broken links.

**Data (new migration `20260101005400_people_merge.sql` only if account/officer views are needed)**
- Add a `people` read view that unions accounts and officers if the merged screen needs it.
- No destructive table drops in this phase.

**Code and routes**
- **MERGE Accounts + Officers into "People":** one Manage tab (`?tab=people`) and one page. It lists accounts with permission level and officer state, and supports suspend/purge/deactivate. `/usg/officers` redirects to `/usg/manage?tab=people`.
- **MERGE Published chart into Structure:** remove the separate nav entry; add a "View published chart" button in Structure that opens `/org-chart`. Keep `/org-chart` as the public read.
- **MERGE LSG Unit details into Profile:** remove the `?tab=unit` tab; move unit identity fields into Profile. Keep `/lsg/manage?tab=unit` as a redirect to `?tab=profile`.
- **MERGE classic feedback messages into Inbox:** remove the `messages` tab from `FeedbackWorkspace`; keep forms/responses/answer. Keep classic feedback entries only if the product keeps them (Open Questions).
- **MERGE duplicate overview widgets** into the P7 tiles.
- **REMOVE** unused `SectionPlanned`/dead components only after a usage check; remove `/api/dashboard` if unused; remove stale nav hints and the mojibake character in `usg-nav.ts` ("A�").
- **REDIRECT** all aliases: `/usg/survey`, `/lsg/survey`, `/usg/personal-requests`, `/lsg/personal-requests`, `/usg/structure`, `/usg/officers`.

**Reason:** the brief says merge duplicates and remove redundancy; Accounts/Officers, Unit details/Profile, Published chart/Structure, and feedback messages/Inbox are the four clear duplicates.

**Done when:** every old URL resolves to the new surface; no nav item points to a dead route; the People screen covers everything the two old screens did.

---

## P9. Notifications

**Goal:** the right person hears about submit, return, approve, reject, overdue, and late submission.

**Data (new migration `20260101005500_notification_triggers.sql`)**
- Add triggers or outbox writes on the P1 submit/review functions for: submitted, returned, approved, rejected, overdue (daily), late submission.
- Add dedupe keys so a cron tick does not spam.
- Deep-link each notification to the item's detail or the review queue.

**Code**
- Reuse `src/lib/notifications-server.ts` and the existing outbox/cron.
- Add in-app and email templates; respect the existing preference/settings model if present.
- Add unread badges for the review queue and returned items.

**MERGE:** all transition notifications through the submit/review functions; no per-route ad hoc notifications.

**REMOVE:** any duplicate notification writes once the triggers are live.

**ADD:** triggers, templates, deep links, dedupe.

**Reason:** the brief lists notifications; today transitions do not notify anyone.

**Done when:** submit notifies USG reviewers; return/approve/reject notifies the unit; overdue and late notify both sides once per item; links land on the right screen.

---

## P10. QA, hardening, and release

**Goal:** prove every role/side path works and leave no placeholders.

**Data**
- No new feature migration. Add indexes found during query review; fix any backfill gaps with a new migration if needed.

**Code and tests**
- Playwright E2E for: owner/reviewer/self on USG; LSG unit; submit/return/resubmit; budget approve/return; public feedback form; public survey; review queue filters; redirects.
- Migration test on a fresh database: run all migrations, then seed and exercise every transition.
- Typecheck, lint, and build.
- Accessibility pass on the new tabs, modals, and tables (labels, focus, keyboard).
- Empty/loading/error states for every new list.
- Security review: RPC grants, RLS on new tables (`deadline_extensions`, `budget_periods`, `budget_allocations`), no cross-unit leakage in the queue/timeline.
- Performance: explain the review queue and overview queries; add indexes.
- Remove every placeholder button or label it "No functionality yet".
- Append the final summary to `CHANGELOG_SYSTEM_REDESIGN.txt`.

**MERGE:** no new merges; verify P8 redirects.

**REMOVE:** placeholders, dead code, unused routes confirmed by search.

**ADD:** tests, indexes, docs, changelog entry.

**Reason:** the brief requires no placeholders and working buttons; this is the gate.

**Done when:** the E2E suite is green, the fresh-migration test is green, typecheck/lint/build are green, and the changelog is updated.

---

## Phase order and dependencies

| Phase | Depends on | Ships |
|---|---|---|
| P1 | none | status model, returned, submit |
| P2 | P1 | deadlines, extensions, overdue, late |
| P3 | P1, P2 | review queue, timeline |
| P4 | P1 | budget model |
| P5 | P4 | budget UI |
| P6 | P1, P2, P3 | Request section unification |
| P7 | P1-P3, P5 | dashboards, monitoring |
| P8 | P3, P6, P7 | merges, redirects, cleanup |
| P9 | P1, P3 | notifications |
| P10 | all | QA, hardening, release |

P4/P5 can run in parallel with P2/P3 after P1. P8 must wait for P3/P6/P7 so it does not redirect into surfaces that are about to change.

## Explicit non-goals

- No new visual theme or component library.
- No framework, database, or auth-model change.
- No deletion of historical rows; supersede and redirect.
- No new feature outside the brief (for example, no AI features beyond the existing survey summary).
- No edits to applied migrations; every change is a new numbered migration.

## Open questions that block P1

1. Does 04600 run in production? If yes, P1 must repair data as well as constraints.
2. Is `published` a status or a `published_at` timestamp? Recommendation: timestamp, so the canonical set stays at seven states.
3. Do feedback forms and surveys merge? Recommendation: keep both for now; remove only the duplicate messages surface.
4. Are classic feedback entries still needed? Recommendation: keep until forms cover anonymous entries; remove the messages tab now.
5. Does "Submit for Review" apply to every reviewable type? Recommendation: yes, via one transition function.
6. Budget period model: school year plus semesters, or fiscal year only? Recommendation: school year with two semesters, configurable per organization.
7. Late source of truth: per-item `due_at` plus approved extensions. Recommendation: effective due date from `deadline_extensions`.
8. Can Accounts and Officers become one "People" screen? Recommendation: yes, with `/usg/officers` redirected.

## Phase 0 note

Phase 0 output is `SYSTEM_FEATURE_MAP.txt` and this `PLAN.md` only. No code was changed, so no typecheck/lint was run. Whether to append a Phase 0 entry to `CHANGELOG_SYSTEM_REDESIGN.txt` is left to the user because the phase instruction says "only" these two files, while the standing rule says append at the end.

## Phase 8 progress

- Item 1 complete: Survey + Feedback are merged into one Forms surface at `/usg/forms` and `/lsg/forms`; canonical public links use `/forms/survey/[key]` and `/forms/feedback/[key]`.
- Legacy survey, feedback, and `manage?tab=feedback` URLs still resolve. Full dead-code deletion and final redirect verification remain later Phase 8 items.
- Item 2 complete: Documents and Search are merged into one Documents surface with a single filter bar for query, type, status, group kind, and originating unit; `?tab=search` redirects to `?tab=documents` while preserving `?q=`.
- The old `DocumentSearchPanel` file remains in the tree for staged cleanup; no nav or manage page renders it. Final dead-code deletion is a later Phase 8 item.
- Item 3 complete: removed the aggregate-only Monitoring surface from USG navigation and Manage; legacy `?tab=monitoring` now redirects to the USG overview. The RPC/API/panel/migration remain staged for the later cleanup item.
- Item 4 complete: kept Accomplishment reports inside Events, clarified reportable-event and open-report labels, added a reports refresh action, and enforced the advertised 10-file upload limit.
- Item 5 complete: USG People & Units is one owner-only Manage tab with internal Units, Officers, Invites, and Feedback access views; the old umbrella/invites/accounts tabs and `/usg/officers` redirect into it while reusing all existing actions.
- Item 6 complete: the separate Published chart nav child is gone; Manage > Government structure now opens `/org-chart` through a View published chart action, with the same owner/non-central gate on USG and the unit-scoped read preserved for LSG.
- Item 7 complete: all merged legacy paths and tabs resolve to canonical People/Forms/Documents/Structure/Profile surfaces; LSG Unit details and classic feedback Direct messages are gone, and stale nav, tour, More-link, and feature-map wording is retargeted.
- Item 8 complete: removed dead DocumentSearchPanel, FeedbackPanel, MyUsgPanel, SectionPlanned, MonitoringPanel, `/api/monitoring`, and `/api/dashboard`; retained the monitoring migration/RPC and CSV library for authority/compliance checks, and fixed the navigation audit to validate API route hrefs.
- Item 9 complete: rechecked owner/reviewer, LSG scope, and centralized/unitary gates; `/api/officers` GET now requires owner scope, centralized owners cannot open People & Units by URL, and static checks assert both gates.
