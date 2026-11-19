# SmartGov Audit & Remediation — Final Report

## Completed in this audit

### Critical wiring fixed
- Personal requests: removed broken `/api/personal-requests` (referenced dropped columns); all traffic now uses the working `/api/requests` system. Dedicated pages redirect to the Request section's personal tab. Status mismatch `open` -> `submitted` fixed so Grant/Decline/Withdraw buttons render.
- Task answers: UI now reads `verdicts` (USG review) and `myAnswer` (LSG) from `task_detail` instead of the non-existent `answers` array.
- Task requirement file uploads: switched from proposal claim target to `task_requirement` claim (correct storage path + RPC).
- Personal request file uploads: implemented via `personal_request` claim target.
- Task creation: added unit picker (defaults to LSG units only, excluding USG root) and timezone picker; backend excludes USG root from default assignment and evaluates deadlines in the supplied timezone.

### Events v2 UI
- Rebuilt both USG and LSG Events pages with a shared `EventsWorkspace`: list + month calendar views, status filters, create form (date, time, IANA timezone via TimezonePicker, venue, scope by university/unit_type/selected units/one unit, support links), detail, claim (LSG, "Claimed as approved" warning), honour/not-honour (USG, required reason), cancel.

### Surveys
- Shared `SurveysListPage` and `SurveyDetailEditor`: create, edit question, reorder (up/down), duplicate question, duplicate survey, publish/close/delete, results with bar charts, CSV export, branching (show_if), public link.
- Email-OTP access mode: new `email_otp` access mode, OTP send/verify endpoints, public survey OTP gate.

### Task board
- Requirement constraints: max size, rules, template file persisted.
- Extensions: request (LSG) + approve/deny (USG) with due-date extension.
- Answer version history: snapshot trigger on update.
- ZIP download route for all answers in a task.
- Task requirement file download route.
- SSE live updates for task thread.

### Global
- Maroon/gold/ivory theme applied to light-mode tokens (globals.css).
- Dead placeholder routes `/usg/survey` and `/lsg/survey` redirect to `/surveys`.
- Dead `/api/personal-requests` removed.

### Navigation and UX hardening
- Removed the remaining hard navigations that the session guard treats as a cold load (and therefore a sign-out): survey title links, post-create survey redirect, post-delete survey redirect, and notification links. They now use `next/link` or `router.push` / `router.replace`.
- Filing a personal request now defaults "Needed on" to tomorrow, refuses to submit without it, and shows the server's reason inline instead of closing silently on a failed write.
- Mobile pass at 390px across every USG and LSG top-level route: no horizontal overflow, no page errors, no stuck loading state.
- Captured fresh dashboard, customise, LSG surveys/requests, USG mobile, and member screenshots after the fixes.

## P0 authorization remediation
- Applied `supabase/migrations/20260101003192_p0_authorization_fixes.sql` after verified backup `C:\Users\Julius M. Matro\Desktop\sir tonie projects\backups\smartgov-backup-20261117-192735.sql`.
- Replaced token-ignoring requirement-answer-version access with authenticated and unit-scoped `smartgov.list_requirement_answer_versions(p_session_token, p_requirement_id, p_unit_id)`.
- Moved survey OTP generation/hashing/TTL into SQL. Public contract is now `create_survey_otp(p_survey_id, p_email)` and `verify_survey_otp(p_survey_id, p_email, p_code)`; the verified result is a one-use proof token.
- Server-enforced the proof for `get_survey` and `submit_survey_response`; direct reads without proof return `needsOtp` with no questions, and replayed/spent proof returns `otp_required`.
- Wired Next.js routes and the public survey page to the server-issued proof; fixed `/api/audit-log` to return 401/403 with a machine-readable reason instead of blanket 400.
- Added `npm run test:authority` and `npm run test:e2e` as repeatable regression suites.

## End-to-end verification
- Organization creation: federated wizard -> review -> verification -> activation email in `/dev/outbox` -> `/activate?token=` -> dashboard -> sign out -> password sign-in.
- Invitation acceptance: owner invites into a new unit -> outbox invite link -> password set -> OTP verify -> sign in -> lands in the LSG workspace.
- Officer lifecycle: deactivate shows the success note, purge requires the typed email, frees seats, and removes the row.
- Request lifecycle: LSG files a personal request -> USG grants it -> status updates for both sides.
- Event lifecycle: USG creates an event -> card renders -> cancel -> card reads cancelled.
- Survey lifecycle: create inline -> client-side route to detail (no sign-out) -> add question -> publish -> delete with confirmation -> returns to the list.
- Conversation delete: create -> open -> "Delete for me" -> conversation disappears from the inbox.

## Remaining gaps (not fully implemented)
- Chat typing indicators, seen/read receipts, and message attachments for conversations (backend tables/RPCs not yet added).
- Survey templates library (built-in templates) and result-viewer management UI.
- File storage versioning UI (backend snapshots exist for task answers).
- The committed checks are `npm run check:smoke` (read-only boundaries), `npm run test:authority` (RPC/HTTP boundaries including org-chart), `npm run test:e2e` (role navigation, validation, cancellation, responsive screenshots), `npm run check:interactions` (high-risk interaction source contracts), and `npm run check:interactions:ui` (browser fault injection). Deep create/invite/lifecycle scripts were run ad hoc against the demo and are not kept in the repository.
- OTP DB-side per-email and per-IP throttling is still advisory; application rate limits remain process-local.
- `definer_without_search_path 11` remains after migration 03192; an optional future migration can pin `search_path` without touching applied migrations.
- The final Task 11 audit reports `fks_without_leading_index 82` (the earlier 71 figure is superseded) with `orphan_fk_rows 0` verified.
- `check:federated` create-flow items (unitary model gating) remain pre-existing and accepted.

## Dashboard customisation + demo environment
- Per-account tile layout persisted through `smartgov.dashboard_layouts`, `get_dashboard_layout`, `save_dashboard_layout` and `GET/PUT /api/dashboard/layout`. Tiles follow each side's own nav; order, width, and visibility survive sign-out and a fresh browser session.
- `scripts/seed-demo.mjs` builds one federated demo university (1 USG + 5 college councils), 14 active accounts, a submitted structure chart, 2 proposals, a budget, 3 tasks, 2 events, 2 surveys with responses, 2 personal requests (1 granted), a conversation, notifications, and org customisation. Re-run with `--purge` for a clean demo.
- Demo accounts and the one shared password live in `C:\Users\Julius M. Matro\Desktop\sir tonie projects\credentials\smartgov-test-accounts.txt` (test-only; rotate or delete before real use).
- Pre-change database backup: `C:\Users\Julius M. Matro\Desktop\sir tonie projects\backups\smartgov-backup-20261117-142618.sql`.
- Seed guard: `truncate ... cascade` empties `gov_structure_templates` through its organization foreign key, so the seeder snapshots and restores the 10 built-in blueprints around the purge.

## Dashboard audit and overview widgets
- Added `npm run check:dashboard` (`scripts/check-dashboard-audit.mjs`) as a repeatable real-browser/API gate for the dashboard role audit; it is self-resetting and does not expose account content.
- Task 11 made a harness-only adjustment in `scripts/check-dashboard-audit.mjs`: the LSG Request tour check navigates with `window.next.router.push("/lsg/request")` after sign-in. No product behavior, dashboard layout, widget ids, or saved-layout behavior changed.
- Owner keeps the Umbrella/Invites/Structure child links; USG officers see only their own profile path because `src/components/dashboard/usg-nav.ts` gates those children on `role.accountScope === "owner"`.
- `GET /api/units` is now available to scoped non-owners; authorization remains in `unit_chart` SQL. Write operations and `/api/umbrella` stay owner-only.
- USG officer Request and Events sections no longer produce 403 responses: both read units through `/api/units` instead of the owner-only umbrella endpoint.
- LSG officers can file a personal request from either Request tab; the File request control is no longer limited to the personal tab.
- `/api/overview` calls `list_my_tasks` and `list_personal_requests` with the current two-argument SQL contract, reads the fields those RPCs actually return, and exposes a `breakdown` object for tasks, requests, events, and surveys.
- Added per-user overview widgets under `[data-tour="workspace-widgets"]`: At a glance, Report summary, Task status, Request status, and Workflow. Summaries and charts are CSS/SVG only; no chart dependency was added.
- Widget visibility persists through `supabase/migrations/20260101003194_dashboard_widget_preferences.sql`, `get_dashboard_preferences`, `save_dashboard_preferences`, and the existing `GET/PUT /api/dashboard/layout` surface. No direct table grants or RLS policies were introduced.
- The USG and LSG overview tours now include the widget area and were bumped to version `2`.

## Interactive control hardening
- Added `npm run check:interactions` (`scripts/check-interactions.mjs`) as a failing-first source-contract gate for high-risk controls; final count 27/27 pass.
- Added `npm run check:interactions:ui` (`scripts/check-interactions-ui.mjs`) to exercise injected failures in a real browser; final count 18/18 pass.
- Sign-out now checks the logout response, keeps the dialog open on failure, and shows a readable error instead of redirecting a still-authenticated user.
- Notification read actions now require `res.ok` and `data.ok`; external notification links open in a new tab with `noopener,noreferrer` instead of hard-navigating the authenticated app.
- Survey question reorder checks both PATCH responses before reloading, so a partial failure cannot be reported as success.
- Org-chart photo upload uses one file input per node, so choosing a photo no longer risks writing to the last rendered node.
- Structure helper rejects non-OK HTTP responses and surfaces the API message.
- Request/task/extension/decision/withdraw actions share a response-checking `mutate` helper and show inline errors; 12 mutation paths are covered.
- Event cancellation is guarded against duplicate submits and disables its button while in flight.
- Survey duplication checks every question-copy response and shows an inline error instead of a false success toast.
- Structure save/renew/submit/template-save and review-decision actions catch server failures and keep the error visible in the workspace.
- Umbrella pause/cancel actions check HTTP status and payload together and catch network failures.
- Profile saves check HTTP status and all four profile actions surface network/server failures inline.
- Message read polling cannot produce an unhandled rejection; unsend and conversation delete are guarded and disabled while in flight.
- Org-chart position templates, unit seat toggles, and seat invite/assign/release contracts check responses, guard duplicate submits, roll back optimistic seat state, and refresh the chart only after success; unit-scoped callers are redirected to `/my-council`.

## Persistent adaptive shell and guided tours
- Replaced the shell with a persistent responsive layout: desktop left rail, tablet drawer, and mobile bottom navigation with a "More" menu. Collapse and nav state survive reloads and sign-in through per-account persistence.
- Layout targets 360px through 4K, with all touch controls at least 44px; no horizontal overflow or stuck states across breakpoints.
- Added context-aware guided tours on all 35 renderable non-API routes, with step copy keyed to the active role and workspace (USG/LSG/public).
- Built an in-house React tour engine; no `driver.js` or `react-joyride` dependency was added.
- Help entry point sits in the workspace nav slot and floats on public pages.
- Spotlight-and-tooltip step overlay supports keyboard navigation, focus management, ARIA labelling/announcements, and responsive repositioning on viewport changes.
- Spotlight placement scrolls instantly and clamps tall sections so the tour card keeps a visible gap; public home step 4 was verified at 360px, 768px, and 1440px with the real `landing-features` body and no centered fallback or card overlap.
- Browser verification targets the dialog's declared `data-tour` token and lets layout settle before screenshots, so logs and images reflect the intended step target.
- Progress is DB-backed via `supabase/migrations/20260101003193_tour_progress.sql`, with a localStorage fallback. Identity is derived from the app's custom auth token; no Supabase Auth and no direct table grants were introduced (wrapper-only access preserved).
- Auto-start prompt copy: "New: a 1-minute guide to this page is available." with Start tour / Not now / Don't ask again; dismissals and completion persist per user and route.
- Screenshots: `C:\Users\Julius M. Matro\Desktop\sir tonie projects\screenshots\tours\`.

## Federated government modules (Tasks 1–11)
- Scope: Tasks 1–11 on branch `feature/federated-government-modules` in `C:\Users\Julius~1.MAT\AppData\Local\Temp\opencode\smartgov-worktrees\federated-government-modules`. This final run created no commit, no push, no stash, and no branch switch. Task reports 1–10 are present; the controller-owned `.superpowers\sdd\2026-11-18-federated-government-modules\progress.md` exists and shows Tasks 1–11 complete. It was reviewed and reconciled by the controller.
- Dashboard stability: the dashboard arrangement, card order, widget ids/defaults/order, hidden/wide values, and saved-layout behavior were not changed. The real locked ids are `stats,reports,task-chart,request-chart,flow`; no new top-level tile or nav id was added. `npm run check:dashboard` remains 25/25. No new `page.tsx` route was added.

### Contract gate and Next.js doc conformance
- `scripts/check-federated-features.mjs` is the additive static contract gate for routes, nav, migrations, status vocabulary, and module files; final result 137/137. Dynamic route params use the installed Next.js awaited-params convention, route handlers use Web Request/Response APIs, and new dynamic API routes do not collide with `page.tsx` siblings. No `driver.js`/`react-joyride` or chart dependency was added.

### Resolutions
- Added `20260101003200_resolutions.sql`, `src/lib/resolutions.ts`, `/api/resolutions`, `/api/resolutions/[id]`, `/api/resolutions/[id]/review`, and `ResolutionPanel.tsx`. LSG creates unit-scoped resolutions; USG review is server-enforced. HTTP and authority checks cover anonymous denial, wrong-side denial, and cross-account/cross-unit reads.

### Document catalog and search
- Added `20260101003210_document_catalog_and_search.sql`, `src/lib/document-search.ts`, `/api/documents`, `/api/documents/[submissionId]`, `/api/documents/[submissionId]/approve`, `DocumentLibraryPanel.tsx`, and `DocumentSearchPanel.tsx`. Search returns `submissionId`; byte access remains in large objects. Missing/inaccessible file access maps to HTTP 400, matching the existing denial contract.

### Event budget link
- Added `20260101003220_event_budget_link.sql`, `BudgetPanel.tsx`, and `/api/budgets`. Budgets are created from event detail; unitless USG events file as `Standalone`; LSG standalone submission is intentionally unavailable. "Expenses" means approved-request total, not disbursements.

### Unified calendar
- Added `20260101003230_unified_calendar.sql`, `CalendarPanel.tsx`, and calendar/feed support behind `/api/feed`. The month grid lives in the Calendar tab; Future Events intentionally uses Upcoming/Past sections and no month-grid coverage is claimed for that tab.

### Monitoring
- Added `20260101003240_monitoring_by_campus.sql`, `src/lib/monitoring.ts`, `/api/monitoring`, and `MonitoringPanel.tsx`. Counts are per assignment, drafts count as pending, "Every USG unit" means top-level campuses plus All campuses, and the reviewer hint omits Budget/Monitoring. CSV export now neutralizes leading `=`, `+`, `-`, and `@` formula characters in `csvCell`; campus names remain organization-controlled. Multiple-USG-root fan-out, unitary-org empty monitoring, and top-level LSG grouping are accepted edge cases.

### Accomplishment reports
- Added `20260101003250_accomplishment_reports.sql`, `src/lib/accomplishment-reports.ts`, `/api/accomplishment-reports`, `/api/accomplishment-reports/[id]`, `/api/accomplishment-reports/[id]/review`, and `AccomplishmentPanel.tsx`. USG submission still rejects legacy `scope='org'` events; `source='usg'` already enforces the intended rule. `review_accomplishment_report` has no status guard, so repeated decisions can append duplicate timeline rows; accepted.

### In-app feedback
- Added `20260101003260_feedback.sql`, `src/lib/feedback.ts`, `/api/feedback`, `/api/feedback/[id]`, `/api/feedback/[id]/acknowledge`, and `FeedbackPanel.tsx`. A direct `acknowledge_feedback` RPC can re-acknowledge and overwrite fields; the UI prevents this and the behavior is accepted. The exported `FEEDBACK_STATUS_LABEL` is unused, with labels duplicated in the badge component; accepted as cosmetic.

### Officer profile fields and accounts
- Added `20260101003270_officer_profile_fields.sql`, `/api/profile/officer`, and the Accounts surface. Profile identity is session-derived; email and role remain immutable. Accounts is USG owner-only; no LSG Accounts surface, `/api/accounts`, or second deactivate endpoint was added. The roster comes from `/api/org-accounts` (active-only, caller-excluded), so Status always renders active and deactivated officers are not listed; accepted. The Role column shows raw `account_scope` and the `ProfileSection` doc comment is stale; accepted as non-functional.

### Task 11 authority, E2E, UI, and tour coverage
- `scripts/check-authority.mjs` now includes anonymous, wrong-side, cross-account, and cross-unit denials for `/api/resolutions`, `/api/documents`, `/api/budgets` with `eventId`, `/api/feed`, `/api/monitoring`, `/api/accomplishment-reports`, `/api/feedback`, and `/api/profile/officer`. Fixture teardown keeps accomplishment reports before events and restores profile values.
- `scripts/check-e2e.mjs` and `scripts/check-tours-ui.mjs` open every new tab for the correct side, verify the breadcrumb/tab selection, and verify the wrong-side role wall. No new `page.tsx` route was needed. `scripts/check-smoke.mjs` adds anonymous 401 checks for all eight new API surfaces.
- Empty search results, visible failed-submit errors, and a submit button that remains usable after failure are covered in browser checks.
- Existing USG/LSG Request, Events, and Manage tour steps were appended in Task 11 with only `request-tabs`, `events-toolbar`, and `manage-tabs` anchors; `workspace-widgets` and `workspace-breadcrumbs` already existed elsewhere. No existing step was reordered or removed, and the six Request/Events/Manage tour versions were left at their pre-Task-11 value `1` with no re-prompt behavior change. The overview tours remain at `2` from earlier widget work. All 18 federated tab client-navigation checks passed.

## Final whole-branch review fixes
- Fix 1: added `supabase/migrations/20260101003280_final_review_fixes.sql` as a new migration, replacing `smartgov.monitoring_by_campus` so monitoring documents derive campus linkage from submission/document rows rather than the wrong proposal join.
- Fix 2: the same migration replaces `smartgov.set_document_metadata` so an omitted or empty `p_group_kind` preserves the stored document linkage instead of being coerced to `requirement`.
- Fix 3: malformed resolution ids now fail closed with HTTP 400 through the shared `UUID_RE` guard in `/api/resolutions/[id]` and `/api/resolutions/[id]/review`.
- Fix 4: `/api/feed` now validates canonical `YYYY-MM-01` months by splitting the matched string, so the Calendar panel's canonical month is accepted.
- Fix 5: `src/lib/monitoring.ts` `csvCell` now neutralizes leading spreadsheet-formula characters in exported CSV fields.
- Fix 6: added static/runtime regression guards in `scripts/check-units.mjs`, `scripts/check-authority.mjs`, and `scripts/check-compliance.ts`; TDD red-green evidence was captured before implementation.
- Finding 7 is parked by controller ruling: it was already disclosed/accepted in `team-deferred-triage.md`, so accomplishment-review behavior was intentionally not changed.
- Migration `20260101003280_final_review_fixes.sql` was applied to the shared test database with the schema cache reloaded; no applied migration was edited.

### New migrations in this workstream
- `supabase/migrations/20260101003194_dashboard_widget_preferences.sql` (pre-existing widget baseline, preserved unchanged).
- `supabase/migrations/20260101003200_resolutions.sql`
- `supabase/migrations/20260101003210_document_catalog_and_search.sql`
- `supabase/migrations/20260101003220_event_budget_link.sql`
- `supabase/migrations/20260101003230_unified_calendar.sql`
- `supabase/migrations/20260101003240_monitoring_by_campus.sql`
- `supabase/migrations/20260101003250_accomplishment_reports.sql`
- `supabase/migrations/20260101003260_feedback.sql`
- `supabase/migrations/20260101003270_officer_profile_fields.sql`
- `supabase/migrations/20260101003280_final_review_fixes.sql`
- These migrations were applied to the shared test database without rollback, accepted as the test-environment workflow used across tasks. `src/lib/large-objects.ts` retains the Task 9 `POSTGRES_URL` → `DATABASE_URL` fallback that unblocked the authority runtime; this was outside the original brief and is disclosed rather than hidden.

## Verification (final whole-branch review fix run)
- All gates were run one at a time in the ordered list below. Counts and exit codes are from this final review-fix run; earlier figures in prior reports are superseded where they differ.
- A `next start` process from the earlier verification pass was stopped before the fixed rebuild, port 3000 was confirmed free, one production server was started from the rebuilt webpack build, and that server was stopped afterward with the port confirmed free. `POSTGRES_URL`, `SUPABASE_URL`, and `SUPABASE_ANON_KEY` were aliased from their public/local counterparts in the server process only; no values, `.env.local` contents, tokens, or remote URLs were printed. Seven API spot checks (`/api/resolutions`, `/api/documents`, `/api/budgets`, `/api/feed`, `/api/monitoring`, `/api/accomplishment-reports`, `/api/feedback`) answered HTTP 401 anonymously before the runtime gates.

| Order | Command | Captured result | Exit |
|---|---|---|---|
| 1 | `npm run lint` | 0 errors, 361 warnings (pre-existing plus added gate-script warnings); full lint completed with a 900s timeout budget, so no timeout ruling was needed | 0 |
| 2 | `npx tsc --noEmit` | clean, no diagnostics | 0 |
| 3 | `npm run build` | Turbopack failed with `Symlink [project]/node_modules is invalid, it points out of the filesystem root` | 1 |
| 3b | `npx next build --webpack` | recorded fallback: compiled successfully in 26.8s, TypeScript in 5.9s, 74/74 static pages generated in 6.9s | 0 |
| 4 | `npm run check:features` | 137/137 checks passed | 0 |
| 5 | `npm run check:reveal` | 21/21 checks passed | 0 |
| 6 | `npm run check:tours` | 312/312 tour checks passed | 0 |
| 7 | `npm run check:interactions` | 27/27 interaction checks passed | 0 |
| 8 | `npm run check:federated` | 20/20 checks passed | 0 |
| 9 | `npm run check:units` | 296/296 checks passed (supersedes 292/292) | 0 |
| 10 | `npm run check:compliance` | ALL PASS (7 items in 4841ms) | 0 |
| 11 | `npm run check:smoke` | 52/52 checks passed | 0 |
| 12 | `npm run test:authority` | 208/208 checks passed (supersedes 200/200) | 0 |
| 13 | `npm run test:e2e` | 70/70 checks passed | 0 |
| 14 | `npm run check:interactions:ui` | 18/18 interaction browser checks passed | 0 |
| 15 | `npm run check:tours:ui` | 3074/3074 tour browser checks passed, including 18 federated tab navigations; first 10-minute tool attempt timed out, full rerun completed | 0 |
| 16 | `npm run check:dashboard` | 25/25 checks passed | 0 |
| 17 | `npm run audit:connections -- --verbose` | PASS; `orphan_fk_rows 0`, `direct_untrusted_table_grants 0`, `token_ignoring_wrappers 0`, `definer_without_search_path 11` | 0 |
| 18 | `git diff --check` | passed with only pre-existing CRLF conversion warnings for `scripts/check-authority.mjs` and `src/components/dashboard/EventsWorkspace.tsx` | 0 |
| 19 | `git status --short` | expected Task 1–11 and final-fix modified/untracked files only, including `20260101003280_final_review_fixes.sql`; no commit created; `paperworks/` absent from this worktree and therefore not tracked or modified | 0 |

- Screenshots: `C:\Users\Julius M. Matro\Desktop\sir tonie projects\screenshots\audit\` (USG/LSG overview and survey at mobile, tablet, and desktop).
- Vercel deployment: READY (deployment URL intentionally omitted from this report); deploy by pushing `main`, not direct CLI.

### Rulings
- Webpack fallback: `npm run build` is defined as `next build`. Turbopack failed in this worktree with the exact symlink error shown in the table; `npx next build --webpack` was used in the same slot and succeeded. `npm run build` is not reported green.
- Lint timeout: an earlier short-timeout run was inconclusive, but this final full-repo `npm run lint` completed at 900s with exit 0; no targeted-substitution ruling is needed. The 361 warnings are pre-existing plus warnings in the added gate scripts and are accepted; no error was introduced.
- Env aliases and clean-port setup: `POSTGRES_URL` was derived from `DATABASE_URL` in-process for the server runtime only; values were never printed. Port 3000 was confirmed free, one server was used for the entire runtime block, and that server was stopped afterward.
- Audit baseline: `orphan_fk_rows 0` and `direct_untrusted_table_grants 0` are verified; `definer_without_search_path 11` remains accepted by the existing baseline.

### Deferred findings rollup
- Accepted (43): all 43 `accept` items from `.superpowers\sdd\2026-11-18-federated-government-modules\team-deferred-triage.md` are disclosed and accepted, not silently omitted. They include, by task: Task 1 gate helper blind spots (`readFileSync`, labels, `page.tsx`-only collision check, comment/string stripping, lowercase `request.json()`, hardcoded nav path, historical RED scaffolding); Task 2 duplicate nav-stability helper, load-bearing dashboard guard, real widget ids `stats,reports,task-chart,request-chart,flow`; Task 3 awaited `Promise<{ id: string }>` params and static-token limits covered by HTTP/UI gates; Task 4 HTTP 400 for missing file, `groupId` edit-modal caveat, inaccurate fallback comment, owner-only "More" tools, cosmetic checker formatting, POSTGRES alias history; Task 5 event-budget source predicates, cancelled-event direct API, no unmount abort, approved-total "Expenses", USG `Standalone`, no LSG standalone; Task 6 Future Events split and lint-warning-only result; Task 7 RSC-payload normalization, broader Suspense refactor, CSV formula caveat, count/copy caveats, monitoring edge cases; Task 8 legacy `scope='org'` rejection and no review status guard; Task 9 unused feedback label, re-acknowledge RPC, cosmetic formatting, `large-objects.ts` alias, shared test DB migrations; Task 10 Accounts active-only/caller-excluded roster, raw `account_scope`, stale doc comment; cross-task Turbopack fallback and stale-port caveats. Full per-item wording remains in the triage artifact.
- Final cleanup (15): `.server-3101.log` and `temp_fix.txt` were removed in the final review-fix wave; the remaining handoff-only items were not executed. These are `tsconfig.tsbuildinfo`, `.next/`, 30 review snapshot directories, 15 review-diff packages, six Task 1 scratch files, and the stale-count/claim reconciliations C8–C15. The stale counts in this report are reconciled from the captured final evidence; no other cleanup candidate was deleted or moved before sign-off.
- Out-of-scope (7): disclosed, not fixed in this workstream: the pre-existing `personal_requests` migration id conflict (`20260101003070` vs `20260101003110`), process-local advisory OTP throttling, `definer_without_search_path 11`, `fks_without_leading_index 82` with `orphan_fk_rows 0` (the earlier 71 figure is superseded), prior navigation/UX audit follow-ups, real email delivery not exercised locally, and deliberately untracked `paperworks/` plus pre-existing uncommitted dashboard/widget work.
- New Task 11 disclosures: brief/base figures `171/171`, `2894/2894`, `25/25` smoke, and `31/31` E2E were treated as reconciliation baselines, not targets; captured results are 200/200, 3074/3074, 52/52, and 70/70. The controller-owned `progress.md` exists and shows Task 11 complete; it was reviewed and reconciled by the controller. No credential/test-account contents were read or printed, and `paperworks/` was not read or modified. No new product-level finding required a source change during the original final run; Fix round 1 in the Task 11 report records the later review-driven corrections.
- Final review-fix disclosures: findings 1–6 required source, SQL, and test changes; finding 7 remains parked by the controller ruling. The final rerun supersedes `check:units 292/292`, `test:authority 200/200`, lint warnings `329`, and compliance `2727ms` with `296/296`, `208/208`, `361`, and `4841ms`. New migration `20260101003280_final_review_fixes.sql` was applied to the shared test database; no applied migration was edited. The first `check:tours:ui` attempt hit the tool timeout at 10 minutes, but a full rerun completed 3074/3074 with exit 0. No credentials or test-account contents were read or printed.

## Ambiguity decisions
- Public wrapper grants were left as the PostgREST entry surface because removing `anon`/`authenticated` would break the custom-auth transport. The DB functions still derive identity from the session token.
- RLS-without-policy tables are retained as a deliberate fail-closed wrapper-only architecture; the audit script guards against future direct untrusted grants.
- `definer_without_search_path 11` was left for a separate migration rather than editing applied migration 03192; no unqualified-object exploit was demonstrated.
- Native confirmation dialogs and missing archive/restore vocabulary were recorded as product/UX follow-ups rather than changed under this audit.
- Real email delivery was not exercised locally because Gmail credentials are absent; queue generation and drain logic were verified instead.
- The P0 authorization and dashboard-icon work was committed as `0db6afe` and pushed to `main`; the interactive-control, shell, and guided-tour work is included in the follow-up change set.
