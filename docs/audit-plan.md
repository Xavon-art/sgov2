# SmartGov Audit & Remediation Plan

## Scope
Audit every section/corner of both USG and LSG workspaces, confirm each control works
and coordinates across roles, and add missing functionality.

## Findings (critical)
1. `/api/personal-requests` + dedicated pages reference dropped columns (title, deadline,
   timezone, support_document) → runtime errors. Working system is `/api/requests`.
2. RequestSection personal requests check `status === "open"` but DB returns `"submitted"`
   → Grant/Decline/Withdraw buttons never render.
3. RequestSection task answers read `r.answers` but `task_detail` returns `verdicts`/`myAnswer`
   → USG never sees submissions; LSG never sees its own answer/status.
4. Task requirement file upload uses wrong claim target (`requirement` → proposal claim)
   → uploads fail.
5. Task creation UI has no unit picker → assigns to all units (incl. USG root).
6. Personal request file upload is a no-op (commented).
7. Events UI is the legacy basic version; v2 backend (time, timezone, venue, scope,
   files, honour reason) unused.
8. Surveys: no edit/reorder/duplicate/export/charts/templates/branching/OTP.
9. Task board: no extensions, version history, ZIP, max size/rules/template/support docs,
   live progress.
10. Chat: no SSE, typing/seen, attachments; polling only.
11. Theme still brass/navy, not required maroon/gold/ivory.
12. Dead placeholder routes `/usg/survey`, `/lsg/survey`.

## Execution phases
1. Critical wiring (personal requests, answers, uploads, unit picker, theme)
2. Events v2 UI
3. Survey enhancements
4. Task board enhancements
5. Chat enhancements (SSE, typing/seen, attachments)
6. Maroon theme + dead route cleanup
7. Playwright E2E + final report
