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

## Remaining gaps (not fully implemented)
- Chat typing indicators, seen/read receipts, and message attachments for conversations (backend tables/RPCs not yet added).
- Survey templates library (built-in templates) and result-viewer management UI.
- File storage versioning UI (backend snapshots exist for task answers).
- Playwright E2E specs (smoke tests not yet written).
- `check:federated` create-flow items (unitary model gating) pre-existing.

## Verification
- `npx tsc --noEmit`: clean
- `npm run lint`: 0 errors
- `npm run build`: success
- `npm run check:units`: 282/282 pass
- Vercel deployment: READY (sgov.vercel.app)
