# Federated registration is USG-only

**Date:** 2026-09-28
**Status:** Approved
**Scope:** Registration wizard only. The USG campus/department list and the invite UI are separate tasks.

## The problem

Under the federated model, the setup wizard let any person register and
declare which campus they belonged to. Two things are wrong with that.

**The registrant is not the thing that owns a campus.** The University Student
Government sits above every campus. It cannot be scoped to one. Asking a USG to
name a single campus is asking for a false answer, and the field was marked
required.

**The code already contradicted the form.** `submit.ts` hardcodes
`accountKind` to `"usg"` for federated and always creates a `unit_type = 'usg'`
unit, regardless of the role chosen in the account step. So a person could pick
"LSG Officer" at `create/account`, and the system would still build them a USG
account — while the form next to it claimed they were a local officer.

That combination is the vulnerability the earlier security pass flagged as the
F1 foreign-organization claim. The UI invited a claim the write path did not
honour.

## The model

Under federated, the registrant is always the USG. Local Student Governments do
not self-register. They enter through an invitation, and the USG assigns the
campus when it sends that invitation.

This is already the intended design elsewhere in the codebase:

- `dashboard/page.tsx:91` — "You sit above your local student governments.
  Invite an officer, name the campus they belong to, and they become part of
  your umbrella."
- `create_invite` (`20260101000200_auth_and_invitations.sql:385`) already takes
  `p_campus_name` and `p_unit_type`.
- `InviteSetupForm.tsx:104` already shows the campus to the invitee read-only,
  deliberately, so an invitee cannot point their account at a different campus
  than the one they were invited to.

So the registration wizard was the one place still describing the old model.

## Changes

### Institution step

Remove the "Federated details" block and both fields — "Campus or branch name"
and "College or department". What remains is university name and the university
seal.

`institution/page.tsx:47-76` is the block. The unitary explanation box
(`institution/page.tsx:77-85`) is unrelated and stays.

The federated lede should stop implying the registrant is a local body and say
that the USG will invite local councils per campus after setup.

### Account step

Hide the role fieldset entirely when the model is federated. Under unitary the
picker stays exactly as it is today (`council_officer` + `advisor`).

No information is lost by hiding it. Under federated there is only one possible
answer, so the role is known rather than asked. The account record still stores
`usg_officer`.

`lsg_officer` stays in `MemberRole`, `ROLE_LABELS`, and `ROLE_HINTS`. It is not
dead — it is the role an invited LSG officer will hold once invites work. It is
currently referenced only in `store.ts:10,68,76,84` and has no other
functional dependency, so hiding the picker is contained to one page.

### Review step

Remove the "Campus or branch" and "College or department" rows
(`review/page.tsx:168-174`) and the campus suffix in the charter title
(`review/page.tsx:96`).

### Draft store

`store.ts`:

- Drop `campusName` and `college` from `InstitutionDraft` and `EMPTY_DRAFT`.
- Drop the two federated validation errors at `store.ts:176-179`.
- Make the role error unitary-only.
- Bump the persist key `smartgov.draft.v1` → `v2`.

### Forcing the role

`setModel("federated")` must set `role: "usg_officer"`, and it is live — the
governance-model step calls it from the radio `onChange`
(`governance-model/page.tsx:91`).

That is necessary but **not sufficient**. `setModel` runs only on `onChange`, so
it never fires on mount. A draft that already carries `lsg_officer` and is
resumed without the user touching the model card would keep that role. The
persist key bump discards such drafts, but relying on that alone couples two
unrelated concerns.

So the role is resolved in two places:

1. `setModel` writes the correct value, so stored state is right after an
   explicit choice.
2. An `effectiveRole(model, role)` helper returns `"usg_officer"` for federated
   regardless of what was stored. `validateStep` and `submit.ts` both call it.

Point 2 makes the invariant hold no matter how the draft got into its current
state, which is what a persisted client-side store can never be trusted to do
on its own.

### Submit

`submit.ts` stops sending `campusName` and `college`. No server change is
needed: `/api/organization` already coerces both to `""` via
`text(body.campusName)`, so omitting them is sufficient.

## No database migration

The columns stay, and both are still load-bearing:

- `organizations.campus_name` / `.college` — empty for a USG organization. That
  is semantically correct; a USG has no single campus.
- `accounts.campus_name` — **still used.** This is how an invited LSG officer
  receives their campus, filled at invite time and carried through
  `accept_invite`.

Dropping either column would break the invite path that this change is
preparing for.

## Out of scope

1. The USG dashboard UI for managing the list of departments and campuses.
2. The invite UI with the campus/department picker.

The wizard stops asking the question; nothing new is built to answer it yet.
The backend already accepts the answer.

## Verification

There is no test runner in this repo, so the same script-based approach as
`scripts/check-reveal.mjs` applies.

- `npx tsc --noEmit`, `npx eslint .`, `npm run build`
- `scripts/check-federated.mjs`, asserting:
  - no federated validation branch requires a campus or college
  - `effectiveRole("federated", anything)` is `"usg_officer"`
  - `effectiveRole("unitary", ...)` passes the stored role through
  - the institution step no longer references `campusName` or `college`
  - `submit.ts` sends neither field
- Manual walkthrough of both models, federated and unitary, through to the
  charter, with a resumed draft to confirm no stale `lsg_officer` survives.
