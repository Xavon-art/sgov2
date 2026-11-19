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
- 71 foreign keys still lack a leading index; `orphan_fk_rows 0` was verified.
- `check:federated` create-flow items (unitary model gating) pre-existing.

## Dashboard customisation + demo environment
- Per-account tile layout persisted through `smartgov.dashboard_layouts`, `get_dashboard_layout`, `save_dashboard_layout` and `GET/PUT /api/dashboard/layout`. Tiles follow each side's own nav; order, width, and visibility survive sign-out and a fresh browser session.
- `scripts/seed-demo.mjs` builds one federated demo university (1 USG + 5 college councils), 14 active accounts, a submitted structure chart, 2 proposals, a budget, 3 tasks, 2 events, 2 surveys with responses, 2 personal requests (1 granted), a conversation, notifications, and org customisation. Re-run with `--purge` for a clean demo.
- Demo accounts and the one shared password live in `C:\Users\Julius M. Matro\Desktop\sir tonie projects\credentials\smartgov-test-accounts.txt` (test-only; rotate or delete before real use).
- Pre-change database backup: `C:\Users\Julius M. Matro\Desktop\sir tonie projects\backups\smartgov-backup-20261117-142618.sql`.
- Seed guard: `truncate ... cascade` empties `gov_structure_templates` through its organization foreign key, so the seeder snapshots and restores the 10 built-in blueprints around the purge.

## Dashboard audit and overview widgets
- Added `npm run check:dashboard` (`scripts/check-dashboard-audit.mjs`) as a repeatable real-browser/API gate for the dashboard role audit; it is self-resetting and does not expose account content.
- Owner keeps the Umbrella/Invites/Structure child links; USG officers see only their own profile path because `src/components/dashboard/usg-nav.ts` gates those children on `role.accountScope === "owner"`.
- `GET /api/units` is now available to scoped non-owners; authorization remains in `unit_chart` SQL. Write operations and `/api/umbrella` stay owner-only.
- USG officer Request and Events sections no longer produce 403 responses: both read units through `/api/units` instead of the owner-only umbrella endpoint.
- LSG officers can file a personal request from either Request tab; the File request control is no longer limited to the personal tab.
- `/api/overview` calls `list_my_tasks` and `list_personal_requests` with the current two-argument SQL contract, reads the fields those RPCs actually return, and exposes a `breakdown` object for tasks, requests, events, and surveys.
- Added per-user overview widgets under `[data-tour="workspace-widgets"]`: At a glance, Report summary, Task status, Request status, and Workflow. Summaries and charts are CSS/SVG only; no chart dependency was added.
- Widget visibility persists through `supabase/migrations/20260101003194_dashboard_widget_preferences.sql`, `get_dashboard_preferences`, `save_dashboard_preferences`, and the existing `GET/PUT /api/dashboard/layout` surface. No direct table grants or RLS policies were introduced.
- The USG and LSG overview tours now include the widget area and were bumped to version `2`.

## Interactive control hardening
- Added `npm run check:interactions` (`scripts/check-interactions.mjs`) as a failing-first source-contract gate for high-risk controls; 22/22 pass.
- Added `npm run check:interactions:ui` (`scripts/check-interactions-ui.mjs`) to exercise injected failures in a real browser; 14/14 pass.
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

## Verification
- `npx tsc --noEmit`: clean.
- `npm run lint`: 0 errors; 11 warnings (unused variables/imports).
- `npm run build`: success after the dashboard audit and widget work.
- `npm run check:dashboard`: 25/25 pass against the production `next start` build (role links, scoped units, no forbidden Request/Events responses, LSG file control, overview totals and breakdown, all five widgets, hide/save/navigation persistence, reset).
- `npm run check:tours`: 312/312 pass after adding the `workspace-widgets` tour steps.
- `npm run check:tours:ui`: final rerun 2894/2894 pass; public home step 4 passes at all three viewports.
- `git diff --check`: clean after the final tour visual fixes.
- `npm run check:compliance`: ALL PASS.
- `npm run check:units`: 291/291 pass.
- `npm run check:reveal`: 21/21 pass.
- `npm run check:federated`: 20/20 pass.
- `npm run check:interactions`: 22/22 pass.
- `npm run check:interactions:ui`: 14/14 pass (failed logout, notification read/link failures, request failure feedback, partial survey duplication, event cancel guard/error, no unexpected browser console errors).
- `npm run check:smoke`: 25/25 pass against the production `next start` build (anonymous 401/307 walls, owner/LSG role separation, cookie attributes, UI sign-in/nav/sign-out, zero console errors).
- `npm run test:authority`: 47/47 pass (T1/T2/T4/T5, invalid-token fail-closed, anon table denial, forged IDs, org-chart RPC/HTTP role boundaries, owner/LSG/anonymous chart-page walls).
- `npm run test:e2e`: 31/31 pass (owner and LSG navigation, dialog cancel, validation, no console errors, 12 screenshots).
- `npm run audit:connections -- --verbose`: PASS, exit 0; `definer_without_search_path 11` remains, `direct_untrusted_table_grants 0`, `token_ignoring_wrappers 0` (also `otp_caller_controlled_pattern no`, `orphan_fk_rows 0`).
- Screenshots: `C:\Users\Julius M. Matro\Desktop\sir tonie projects\screenshots\audit\` (USG/LSG overview and survey at mobile, tablet, and desktop).
- Vercel deployment: READY (sgov.vercel.app); deploy by pushing `main`, not direct CLI.

## Ambiguity decisions
- Public wrapper grants were left as the PostgREST entry surface because removing `anon`/`authenticated` would break the custom-auth transport. The DB functions still derive identity from the session token.
- RLS-without-policy tables are retained as a deliberate fail-closed wrapper-only architecture; the audit script guards against future direct untrusted grants.
- `definer_without_search_path 11` was left for a separate migration rather than editing applied migration 03192; no unqualified-object exploit was demonstrated.
- Native confirmation dialogs and missing archive/restore vocabulary were recorded as product/UX follow-ups rather than changed under this audit.
- Real email delivery was not exercised locally because Gmail credentials are absent; queue generation and drain logic were verified instead.
- The P0 authorization and dashboard-icon work was committed as `0db6afe` and pushed to `main`; the interactive-control, shell, and guided-tour work is included in the follow-up change set.
