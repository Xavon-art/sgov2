# Design — LSG requirement submission & review, with USG/LSG dashboards

Date: 2026-09-29
Status: Approved
Scope: A new operational layer on top of the dashboard — programs, requirement
submissions (file or link), versioned review with remarks, and a redesigned
non-typical dashboard for the USG owner and the LSG officer. Existing invite
and unit management stays.

## Problem

The dashboard today is an onboarding console: unit list, invites, and an
account card. There is no way to run the actual governance work — an LSG
proposing an activity and a USG approving it. The owner is also funneled into
"setup" with no way to see the operational dashboard until the tree is built,
and the page looks like a plain admin console rather than something alive.

## Decisions (confirmed with the owner)

1. **A "program" is created by the USG and listed directly — no review.**
   Each program carries its own requirements template. The USG may also author
   a program proposal (an entry it runs itself); those are published directly,
   without the review flow, because the USG is top of the hierarchy.
2. **An LSG submits proposals.** A proposal is either attached to a program the
   USG opened, or a **standalone activity proposal** (which uses a USG-editable
   default requirements template). Multiple officer accounts of the same LSG
   unit can submit on its behalf.
3. **Requirement items are set by the USG and can ask for a file or a link.**
   Each item has a `kind` chosen by the USG: `file` (with an allowed file-type
   list, e.g. PDF/JPG/DOCX) or `link` (a pasted URL, e.g. Google Drive). All
   items are required; there are no optional items yet.
4. **Real file uploads.** Submissions are actual files, not checkboxes. Files
   go to a private Supabase Storage bucket. The browser never talks to Storage
   directly with a service key; the server mints **signed upload URLs**
   (validated against the item, the unit, the size, and the expected type) and
   short-lived **signed download URLs** for the review UI. Supabase Storage RLS
   is fully locked to `anon`; a **server-only service-role key** is added to
   .env.local / Vercel (never committed, never shipped to the browser — same
   discipline as `SMTP_PASS`). Files are capped at 10 MiB each with the bucket
   `file_size_limit`, and type-list + size checks run server-side before a
   signed URL is issued.
5. **Versioned review with remarks ("lahat").** A proposal begins at
   **v1**. The USG can `approve`, `return` (with remarks; the LSG then
   resubmits — each resubmit is a new version), or `reject` (with remarks,
   terminal). Every decision and remark is kept on the thread, and the versions
   can be compared side by side. The overall proposal status is tracked and
   shown to both sides.
6. **Two dashboard modes.** The USG owner sees the review inbox (proposals
   awaiting action, with version diff), its programs and templates, its own
   published program proposals, plus the existing invites/units. The LSG
   officer sees programs to browse, the unit's proposals with status and
   remarks, and a form to submit a new proposal or resubmit a returned one.
7. **Skip-setup gate.** When the owner has no LSG units yet, the dashboard
   shows setup with a "Proceed to dashboard anyway" action that opens the
   operational dashboard, which in turn carries a "Go back to setup" button —
   re-entering setup is always one click away.
8. **Visual redesign — deliberately not a typical dashboard.** The existing
   shader-field identity is pushed harder (WebGL background, floating field,
   glass/brass surfaces, `Seal`/`Reveal` motion), with bento stat cards,
   animated counters, an icon per activity type (sports, culture, academic,
   community, wellness, special), and an approval timeline in the proposal
   detail. No new design-token system — the current brass/canvas/ink palette
   carries it.

## Architecture

### Storage (Supabase Storage)

- Bucket `proposal-documents`, private, `file_size_limit = 10485760`
  (10 MiB), `allowed_mime_types` for the common document set
  (pdf, jpeg/png/webp, docx, xlsx, zip). No `anon` policies; service role only.
- Object layout: `<org>/proposals/<proposal_id>/v<version>/<item_id>/<name>`.
- Upload flow: LSG client POSTs the file (multipart) to our route
  `/api/uploads` → route validates session, unit ownership of the proposal,
  the requirement item, extension against the item's allowed list, and the
  declared size → mints a signed **upload URL** via the service-role client and
  returns it to the client → the client uploads straight to Storage → the
  client confirms via `/api/proposals/{id}/submit` (link items and the
  confirmed file paths are written together). This keeps multi-MiB bytes off
  the Next.js function and the Vercel body limit.
- Download flow: every file link in the UI resolves through `/api/files/<id>`
  which re-checks the caller's scope and redirects to a freshly signed,
  5-minute URL.

### Database — migration `20260101002000_lsg_requirement_submissions.sql`

New tables in `smartgov`, all RLS-enabled with **no policies** (the standing
"no feature migration creates a policy" rule), accessed only through pinned
`security definer` functions with thin `public` forwarders:

- `programs` — id, organization_id, name, description, icon (activity type),
  created_by, created_at.
- `requirement_items` — id, organization_id, program_id (nullable: `NULL` =
  the standalone default template), label, item_kind (`file`|`link`),
  allowed_extensions (text[], for `file`), position, created_at.
- `proposals` — id, organization_id, program_id (nullable), unit_id (the LSG,
  nullable for an own-unit author none), author_kind (`lsg`|`usg`), title,
  description, activity_type, event_date, venue, status
  (`submitted`|`returned`|`approved`|`rejected`|`published`), created_by,
  created_at. `author_kind = 'usg'` rows are written directly as `published`.
- `proposal_versions` — id, proposal_id, version_number, submitted_by,
  submission_note, submitted_at.
- `item_submissions` — id, version_id, requirement_item_id, submission_kind
  (`file`|`link`), storage_path + original_name + mime_type + size_bytes (for
  `file`), link_url (for `link`), submitted_at.
- `reviews` — id, proposal_id, version_id (the version reviewed), decided_by,
  decision (`approved`|`returned`|`rejected`), remark, created_at.

RPCs (all `security definer`, pinned `search_path`, `revoke all` from `public`,
thin `public` wrappers granted to `anon, authenticated`; each authenticates the
session token, org-scopes every row read/write, and consumes a rate-limit
bucket via `consume_rate_limit` like `001400`/`001500`):

- `create_program(p_session_token, p_name, p_description, p_icon, p_items jsonb)`
  — owner only; creates the program and its requirement items atomically.
- `set_default_requirements(p_session_token, p_items jsonb)` — owner only;
  replaces the `program_id IS NULL` item set (the standalone template).
- `list_programs(p_session_token)` — owner sees all; an LSG officer sees
  published programs only.
- `create_proposal(p_session_token, p_program_id, p_title, p_description,
  p_activity_type, p_event_date, p_venue, p_items jsonb, p_note)` — owner (with
  `author_kind = 'usg'` → `published`) or an LSG member of `unit_id`; creates
  the proposal and **v1**; validates one submission per required item
  (`file` rows carry a storage path from a prior `/api/uploads` pass, `link`
  rows carry a URL).
- `submit_revision(p_session_token, p_proposal_id, p_items jsonb, p_note)` —
  only while `status = 'returned'`; bumps the version number and re-runs the
  per-item validation.
- `list_proposals(p_session_token)` — owner: all org proposals (review inbox);
  LSG officer: proposals of their own units.
- `proposal_detail(p_session_token, p_proposal_id)` — nested versions, item
  submissions, and reviews with remarks; cross-org ids → `not_found`.
- `review_proposal(p_session_token, p_proposal_id, p_decision, p_remark)` —
  owner only; locks the latest version, records the review, sets
  `approved`/`returned`/`rejected`. Idempotent double-submit → `retry`-style
  `already_reviewed` for the current version.

### API routes (`src/app/api/…`, one route per capability)

- `/api/programs` GET/POST (list, create), `/api/programs/{id}` detail.
- `/api/requirements/default` GET/POST (the standalone template).
- `/api/proposals` GET/POST (list, create with v1).
- `/api/proposals/{id}` GET (nested detail incl. signed URLs for files),
  POST (submit revision), and `/api/proposals/{id}/review` POST (owner).
- `/api/uploads` POST (multipart → signed upload URL) and
  `/api/files/{submission-id}` GET (redirect to a signed download URL).
- Error shape follows the existing routes: `{ ok, message }` with
  `forbidden → 403`, `unauthenticated → 401`, `rate_limited → 429`, everything
  else `400`, transport bugs `500`. `messageFor()` gains the new reason codes.

### Dashboard

- `src/app/dashboard/page.tsx` keeps its server-side framing; it learns
  whether the visitor is an owner or an LSG member and renders the right
  workspace.
- New `RequirementWorkspace` above/beside the existing `Workspace` (invites +
  units stay for owners). USG shell: review inbox, programs & templates, own
  published proposals. LSG shell: programs browse, unit proposals, submit +
  resubmit forms.
- Skip-setup gate: when `units.length === 0` for an owner, render setup with a
  "Proceed to dashboard anyway" action that unlocks the operational view;
  the operational view gets a persistent "Go back to setup" button.
- Visuals per decision 8: shader field at higher strength, bento stat cards
  with `Reveal` + animated counters, an icon badge per `activity_type`, and an
  approval timeline (submitted → review → decision) in the proposal detail.
  The proposal card list reuses the invites-table ergonomics (inline confirm,
  busy flags, `role="status"`/`role="alert"` captions).

### Security & error handling

- Data access is only through the pinned RPCs; RLS stays on with no policies
  (the `check-units.mjs` guard "no feature migration creates a policy" stays
  green).
- Storage is opaque to `anon`; every file view is per-caller-checked and
  signed for 5 minutes; uploads are pre-validated (owner/unit/item/type/size)
  before a signed upload URL exists.
- The service-role key is server-only (`SUPABASE_SERVICE_ROLE_KEY`), lives in
  `.env.local` and Vercel, never in `.env.local.example` nor any doc.
- All user inputs are length/bounds-capped in the RPCs; activity type and icon
  come from a fixed enum, never free text.

### Testing

- `scripts/check-units.mjs` grows contract guards for 002000: tables + RLS en
  existe, no policies, every function pinned/revoked, only the intended
  `public` wrappers granted, org-scoping on every RPC, status-state machine
  (returned ↔ submitted, approve/reject terminal), and the owned-file
  submit-then-review sequencing.
- A temporary live-DB behavior test (rolled back) covering: create program +
  items, LSG create → v1, USG return w/ remark → LSG resubmit → v2, approve,
  reject terminal, cross-org `not_found`, non-owner `forbidden`, sign-flow
  contract (`/api/uploads` refuses a non-owned item).
- `npm run lint`, `npx tsc --noEmit`, `npm run build`; E2E against the live
  deployment.

## Non-goals (later)

- Email notifications on approve/return/reject.
- Optional requirement items; per-item remarks; editing a program's template
  after submissions exist (drop + recreate instead); budget/amount fields;
  MS Office preview; file versioning beyond the proposal version number.