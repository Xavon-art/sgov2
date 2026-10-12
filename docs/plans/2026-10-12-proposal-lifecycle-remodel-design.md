# Design — Proposal / Activities & Events lifecycle remodel (under-review state, progress bar, responded + requirements)

Date: 2026-10-12
Status: Approved
Scope: Remodel of the existing proposal review flow (introduced in
`20260101002000_lsg_requirement_submissions.sql`) inside the Activities & Events
section. Adds an explicit **Under Review** stage, a **progress bar**, a
**Responded** grouping (`approved` / `rejected` with reason / `approved with
additional requirements`), and an **additional-requirements loop** that sends a
proposal back to the submitting unit until the USG verifies it complete. Budget
and breakdown documentation become visible to the USG in the review view.

## Problem

Today the proposal flow jumps straight from `submitted` to a decision
(`approved`/`returned`/`rejected`). The LSG cannot tell when the USG has opened
their submission; there is no visual progress through the lifecycle; and there
is no way for the USG to approve *conditionally* — saying "yes, but here are the
additional things we still need from your unit" — without those items being
tracked back to the unit and verified before the approval is final.

## Decisions (confirmed with the owner)

1. **Lifecycle:** Draft → **Pending Review** (`submitted`) → **Under Review**
   (`under_review`) → **Responded** = `approved` (final) | `rejected` (reason
   required) | `approved with additional requirements` (`requirements_requested`)
   → loop: LSG responds to each requirement → **Under Review** again → USG
   verifies each → **Approved** (final) → optionally `published` to the feed.
2. **Build on the existing tables/RPCs** in place — no parallel proposal system.
   Extend `smartgov.proposals.status` and `smartgov.reviews.decision` with the
   new states; reuse `proposal_versions`, `item_submissions`, `budget_requests`,
   `budget_items`, and the existing file upload/download machinery.
3. **"Review Proposal" button** (USG) flips the proposal to `under_review` via a
   recorded review action, so the LSG's progress bar updates immediately.
4. **Reject requires a reason.** Approve with no extras is terminal. Approve with
   extras writes a **requirements list** the unit must satisfy.
5. **Additional requirements reuse the file/link submission pattern.** Each
   requested item accepts a file (via the existing signed-upload flow) or a link;
   the USG accepts/waives each item; when all are accepted the proposal is
   `approved`.
6. **Budget + breakdown docs show inline in the USG review view** via the
   existing budget RPCs; the LSG attaches a budget to a proposal as today.

## Architecture

### Database — migration `20260101003050_proposal_review_flow.sql`

All access stays behind pinned `security definer` functions with thin `public`
forwarders; no new policies (standing rule; `scripts/check-units.mjs` guards it).

- **Extend `smartgov.proposals.status`** CHECK to add `under_review` and
  `requirements_requested` (drop + re-add the constraint with the full set:
  `submitted, under_review, returned, requirements_requested, approved, rejected,
  published`).
- **Extend `smartgov.reviews.decision`** CHECK to add `requirements` (drop +
  re-add: `approved, returned, rejected, requirements`). A `requirements` review
  row records the "approved conditionally" decision and carries the remark.
- **New table `smartgov.proposal_requirements`:**
  - `id uuid pk`, `proposal_id uuid references smartgov.proposals on delete cascade`,
    `version_id uuid references smartgov.proposal_versions on delete set null`
    (the version the request was made against), `created_by uuid references
    smartgov.accounts`,
    `position int`, `label text`, `detail text`,
    `status text check (status in ('requested','submitted','accepted','waived'))`,
    `link_url text`, `storage_path text`, `original_name text`, `mime_type text`,
    `size_bytes bigint`, `submitted_at timestamptz`, `decided_at timestamptz`,
    `decided_by uuid`, `remark text`, `created_at timestamptz`.
  - File vs link shape enforced by a CHECK (either link_url set, or the
    storage_path/original_name trio set), mirroring `item_submissions`.
- **New RPCs** (org-scoped, rate-limited, `security definer`):
  - `start_proposal_review(p_session_token, p_proposal_id)` — reviewer/owner
    only; `submitted` → `under_review`.
  - `review_proposal(p_session_token, p_proposal_id, p_decision, p_remark,
    p_requirements jsonb)` — extended: `rejected` (remark required) → status
    `rejected`; `returned` → status `returned` (unchanged content-revision
    path); `approved` with no requirements → status `approved`;
    `approved` with `p_requirements` → status `requirements_requested` and the
    requirement rows are written atomically (decision recorded as
    `requirements`).
  - `submit_requirement_response(p_session_token, p_proposal_id, p_items jsonb)`
    — author's unit only, while `requirements_requested`; validates one response
    per open requirement (file rows carry a storage path, link rows a URL),
    creates a new `proposal_version`, sets each requirement to `submitted`, and
    flips status back to `under_review`.
  - `verify_proposal_requirements(p_session_token, p_proposal_id, p_decisions
    jsonb)` — reviewer/owner only, while `under_review` with submitted
    requirements; accepts or waives each; when all are accepted the proposal
    becomes `approved`, capped by the pending `requirements` review thread.
  - `match_proposal_requirement(p_session_token, p_requirement_id)` — scope
    check used by the upload route before minting a signed upload URL for a
    requirement response (analogue of the existing `match_requirement_item`).
  - Extend `proposal_detail` to nest `proposal_requirements` (with response
    metadata) and to surface the attached budget summary so the review view can
    render budget + breakdown inline.
  - Thin `public.*` forwarders for each new/changed function, `revoke all` from
    `public`, grant execute to `anon, authenticated` (existing ceremony).

### API routes (`src/app/api/…`)

- `POST /api/proposals/[id]/start-review` → `start_proposal_review`.
- `POST /api/proposals/[id]/review` — now accepts `requirements` array;
  `POST /api/proposals/[id]/requirements/submit` →
  `submit_requirement_response`; `POST /api/proposals/[id]/requirements/verify`
  → `verify_proposal_requirements`.
- `POST /api/uploads` — branch on target type: proposal item (existing) or
  requirement response (`match_proposal_requirement`), while keeping the same
  validation (type/size/scope) and storage path discipline.
- Existing routes stay: list/detail, budgets (`/api/budgets`, `/api/budgets/[id]`),
  files, reviewer probe.
- Error shape follows existing routes: `{ ok, message }` with
  `forbidden → 403`, `unauthenticated → 401`, `rate_limited → 429`, other
  business reasons `400`, transport bugs `500`; `messageFor()` gains the new
  reason codes.

### Shared progress bar

New `src/components/dashboard/requirement/ProgressStepper.tsx` renders the fixed
stages as a horizontal stepper with an active/current node and outcome chips:

`Pending Review → Under Review → Responded → Verified`

- `submitted` → stage 1 current.
- `under_review` → stage 2 current.
- `rejected` → stage 3 current, chip "Rejected".
- `approved` → stage 3 complete + stage 4 complete, chip "Approved".
- `requirements_requested` → stage 3 complete (chip "Additional requirements"),
  stage "Requirements" pending; after responses are in and under review again,
  the stepper reflects the loop; `approved` ends at Verified.

Status → label/color mappings live in `helpers.ts` (`statusLabel` extended for
`under_review` and `requirements_requested`).

### LSG side (`LsgShell`, `ProposalDetailFlow`)

- Proposal list rows show the **progress bar** + status badge.
- After submit the unit watches: Pending Review → Under Review → Responded.
- On `requirements_requested`: the detail view lists the USG's requested items
  with file/link response controls (reusing the signed-upload flow); submitting
  sends it back to Under Review.
- Budget creation for a proposal stays available (existing budget route).

### USG side (`UsgShell`, `ReviewInbox`, new `ReviewProposalPanel`)

- `ReviewInbox` rows get a **"Review Proposal"** action that calls
  `start-review` and opens the proposal.
- New `ReviewProposalPanel` (reviewer mode): shows everything the unit submitted
  (items + files), the **budget and line-item breakdown** (qty × unit cost) and
  breakdown documents, then decision controls:
  - **Reject** (reason textarea, required), or
  - **Approve** (no extras), or
  - **Approve + Additional requirements** (builder: one or more rows with label
    + detail) → writes the requirement list.
  - When a proposal is back Under Review after responses, the panel shows
    accept/waive controls per requirement; when all are accepted the proposal
    is Approved.

### Types / helpers

- `types.ts`: add `ProposalStatus` members `under_review`,
  `requirements_requested`; add `ProposalRequirement` (and nested response
  shape); extend `ProposalDetail` with `requirements` and `budget`.
- `helpers.ts`: `statusLabel`, badge tone, stepper mapping.

### Security & error handling

- New RPCs authenticate and org-scope exactly like the existing ones; reviewer
  checks reuse `is_org_reviewer`; author checks reuse `lsg_unit_ids` +
  `proposal_versions.submitted_by`.
- Requirement-response files use the same private bucket + signed-URL flow, so
  `anon` never talks to Storage directly; `match_proposal_requirement` gates the
  signed upload URL.
- All new inputs are length/bounds-capped in SQL; decision values come from the
  fixed CHECK set.

### Testing

- `scripts/check-units.mjs` gains contract guards for 003050: state-machine
  transitions (submitted→under_review→approved/rejected/requirements_requested;
  requirements_requested→under_review→approved), reason-required on reject,
  no-policies, pinned/revoked functions, org-scoping, `public` wrapper set.
- A temporary live-DB behavior test (rolled back) covering: start review, reject
  w/ reason, approve-with-requirements → LSG response (v2) → verify → approved,
  cross-org `not_found`, non-reviewer `forbidden`.
- `npm run lint`, `npx tsc --noEmit`, `npm run build`, then deploy to `sgov`.

## Non-goals (later)

- Email notifications per stage.
- Optional requirement items or per-item remarks beyond the accept/waive call.
- Editing or re-scoping a budget after approval.
- MS Office preview; requirement response file versioning beyond the proposal
  version number.