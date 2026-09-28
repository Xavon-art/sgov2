# Federated USG-Only Registration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the federated setup wizard register the USG only — no campus or college fields, no role picker — so Local Student Governments enter by invitation instead.

**Architecture:** The wizard stops collecting campus and college, and the account role is resolved through an `effectiveRole(model, role)` helper rather than trusted from persisted state. The helper is the invariant; `setModel` is just a convenience that writes the same answer. No database migration: the columns stay because `accounts.campus_name` is still how an invited LSG receives their campus.

**Tech Stack:** Next.js 16.3.6 (App Router, Turbopack), React 19.2.8, TypeScript 5, Tailwind 4, zustand 5. No test runner — verification is `tsc` + `eslint` + `next build` + a Node assertion script, matching the existing `scripts/check-reveal.mjs` pattern.

**Design doc:** `docs/plans/2026-09-28-federated-usg-only-registration-design.md`

---

## Context you need before starting

The repo has no test framework. `scripts/check-reveal.mjs` is the precedent: a plain Node ESM script that reads source files, asserts invariants with regex, prints PASS/FAIL, and calls `process.exit`. Follow that shape. Do not introduce a test framework for this work.

`npm run` scripts available: `dev`, `build`, `start`, `lint`, `check:reveal`.

### The bug being fixed

`src/lib/submit.ts:133` hardcodes the account kind for federated models:

```ts
accountKind: draft.model === "unitary" ? "central" : "usg",
```

and `src/lib/submit.ts:74` always creates a `unit_type: "usg"` unit. Meanwhile the account step let the user pick `lsg_officer`, and the institution step required them to name a campus. So a person could register as an "LSG Officer" and the system would still build them a USG account, while a required field asked for a campus that a USG cannot have.

### Why `setModel` alone is not enough

`setModel` is live — `src/app/create/governance-model/page.tsx:91` calls it from the radio `onChange`. But it fires **only on change**. It never runs on mount. A persisted draft that already carries `lsg_officer` and is resumed without the user touching the model card would keep that role. This is why `effectiveRole` exists and is the thing to test.

---

### Task 1: Add `effectiveRole` and its assertions

**Files:**
- Create: `scripts/check-federated.mjs`
- Modify: `src/lib/store.ts` (add the export, near `rolesForModel` at `store.ts:83`)

**Step 1: Write the failing test**

Create `scripts/check-federated.mjs` with this structure. Adapt `scripts/check-reveal.mjs` for the path handling — note that `fileURLToPath` is required, not `.pathname`, because the repo path contains a space.

```js
/**
 * Guards the federated USG-only invariant.
 *
 * The bug: submit.ts hardcodes accountKind to "usg" for federated, while the
 * wizard let a person register as an "LSG Officer" and required them to name a
 * campus. The form offered a local claim the write path never honoured.
 *
 * The contract:
 *   1. effectiveRole("federated", ...) is always "usg_officer".
 *   2. effectiveRole("unitary", ...) passes the stored role through.
 *   3. No federated validation branch demands a campus or college.
 *   4. The institution step no longer references campusName or college.
 *   5. submit.ts sends neither field.
 *
 * Run: node scripts/check-federated.mjs
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

let failures = 0;
let checks = 0;

function check(label, condition, detail = "") {
  checks += 1;
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`);
  }
}

const store = readFileSync(join(ROOT, "src/lib/store.ts"), "utf8");
const submit = readFileSync(join(ROOT, "src/lib/submit.ts"), "utf8");
const institution = readFileSync(
  join(ROOT, "src/app/create/institution/page.tsx"),
  "utf8",
);

console.log("\nfederated USG-only contract\n");

// --- 1. effectiveRole exists and forces the USG role ---
check("store.ts exports effectiveRole", /export function effectiveRole/.test(store));

const body = store.match(/export function effectiveRole[\s\S]*?\n\}/)?.[0] ?? "";
check(
  "effectiveRole returns usg_officer for federated",
  /federated[\s\S]*usg_officer/.test(body),
  body ? `body: ${body.trim()}` : "effectiveRole body not found",
);
check(
  "effectiveRole passes the stored role through for unitary",
  /unitary[\s\S]*role/.test(body),
);
check(
  "effectiveRole falls back to usg_officer when federated has no model",
  /return\s+"usg_officer"/.test(body),
);

// --- 2. No federated validation may demand campus or college ---
const validate = store.match(/export function validateStep[\s\S]*$/)?.[0] ?? "";
check(
  "validateStep never pairs federated with a campus or college requirement",
  !/federated[\s\S]{0,80}(campus|college)/i.test(validate),
  "validateStep still gates federated on campus or college",
);

// --- 3. Institution step is free of the removed fields ---
check(
  "institution step no longer binds campusName",
  !/campusName/.test(institution),
);
check("institution step no longer binds college", !/\bcollege\b/.test(institution));
check(
  "institution step no longer renders the federated details block",
  !/Federated details/.test(institution),
);

// --- 4. Submit stops sending both fields ---
const federatedPayload = submit.match(/campusName:[\s\S]{0,120}?sealName/)?.[0] ?? "";
check(
  "submit.ts sends an empty campusName rather than a draft value",
  /campusName:\s*federated\s*\?\s*draft/.test(submit) === false &&
    /campusName:\s*""/.test(submit),
  "submit.ts still forwards draft.institution.campusName",
);
check(
  "submit.ts sends an empty college",
  /college:\s*""/.test(submit),
);

console.log(
  failures === 0
    ? `\nall ${checks} checks passed\n`
    : `\n${failures} of ${checks} checks FAILED\n`,
);

process.exit(failures === 0 ? 0 : 1);
```

**Step 2: Run it to verify it fails**

Run: `node scripts/check-federated.mjs`
Expected: FAIL on the `effectiveRole` checks and the institution step checks. The script must exit non-zero.

**Step 3: Implement `effectiveRole`**

In `src/lib/store.ts`, add this immediately after `rolesForModel` (which ends at `store.ts:87`):

```ts
/**
 * The role an account actually gets.
 *
 * Under federated only the USG can register, so the role is known rather than
 * asked -- asking would offer a choice with exactly one correct answer. This
 * resolves it from the model instead of reading it back from the draft, because
 * `setModel` only runs on the model card's onChange and never on mount, so a
 * resumed draft could otherwise carry a stale "LSG Officer" straight through.
 */
export function effectiveRole(
  model: GovernanceModel | null,
  role: MemberRole | "",
): MemberRole | "" {
  if (model === "federated") return "usg_officer";
  return role;
}
```

**Step 4: Run it to verify it passes**

Run: `node scripts/check-federated.mjs`
Expected: still FAIL — the institution step and submit.ts are not touched yet. Only the `effectiveRole` checks should flip to PASS. That partial pass is expected and confirms the assertions are wired to the right source.

**Step 5: Commit**

```bash
git add scripts/check-federated.mjs src/lib/store.ts
git commit -m "Add the federated role invariant and its assertions"
```

---

### Task 2: Drop the campus and college fields from the draft

**Files:**
- Modify: `src/lib/store.ts:22-27` (`InstitutionDraft`), `src/lib/store.ts:52-57` (`EMPTY_DRAFT.institution`), `src/lib/store.ts:118-128` (`setModel`)
- Test: `scripts/check-federated.mjs`

**Step 1: Write the failing test**

Add to `scripts/check-federated.mjs`, after the `effectiveRole` block:

```js
// --- 5. The draft no longer carries the removed fields ---
check(
  "InstitutionDraft no longer declares campusName",
  !/type InstitutionDraft[\s\S]*?campusName[\s\S]*?\}/.test(store),
  "campusName is still part of the draft type",
);
check(
  "InstitutionDraft no longer declares college",
  !/type InstitutionDraft[\s\S]*?\bcollege\b[\s\S]*?\}/.test(store),
);
check("EMPTY_DRAFT seeds neither field", !/campusName:\s*""/.test(store));

// --- 6. The persist key is bumped so stale drafts cannot resurrect them ---
check(
  "persist key is bumped off v1",
  /name:\s*"smartgov\.draft\.v2"/.test(store),
  "stale v1 drafts would still carry campusName and lsg_officer",
);

// --- 7. setModel writes the forced role ---
const setModel = store.match(/setModel:[\s\S]*?\}\),\n/)?.[0] ?? "";
check(
  "setModel forces usg_officer when federated",
  /federated[\s\S]*usg_officer/.test(setModel),
  "setModel still only clears an invalid role",
);
```

**Step 2: Run it to verify it fails**

Run: `node scripts/check-federated.mjs`
Expected: FAIL on the draft and persist key checks.

**Step 3: Remove the fields from the draft**

In `src/lib/store.ts`, narrow `InstitutionDraft` to:

```ts
export type InstitutionDraft = {
  universityName: string;
  sealName: string;
};
```

And `EMPTY_DRAFT.institution` to:

```ts
  institution: {
    universityName: "",
    sealName: "",
  },
```

**Step 4: Make `setModel` write the forced role**

Replace the `setModel` implementation (currently `store.ts:119-128`):

```ts
      setModel: (model) =>
        set((state) => ({
          model,
          // Federated is USG-only, so the role is settled here rather than
          // asked. Unitary keeps the picker, so a role that is no longer
          // available under the new model is cleared.
          account: {
            ...state.account,
            role:
              model === "federated"
                ? "usg_officer"
                : rolesForModel(model).includes(state.account.role as MemberRole)
                  ? state.account.role
                  : "",
          },
        })),
```

**Step 5: Bump the persist key**

In the `persist` options (currently `store.ts:145`), change:

```ts
      name: "smartgov.draft.v1",
```

to:

```ts
      // Bumped from v1: those drafts carry campusName, college, and possibly an
      // "LSG Officer" role, none of which can survive this change. Discarding
      // them is the only way to be sure no stale federated draft reaches the
      // charter step.
      name: "smartgov.draft.v2",
```

**Step 6: Run the check**

Run: `node scripts/check-federated.mjs`
Expected: the draft and persist key checks now PASS. The institution step and submit checks still FAIL — that is Task 3 and Task 4.

**Step 7: Run the type checker**

Run: `npx tsc --noEmit`
Expected: this WILL fail, because `institution/page.tsx`, `submit.ts`, and `review/page.tsx` still reference the removed fields. Note the errors and continue — the remaining tasks clear them. Do not commit a broken build; the commit happens in Task 5.

**Step 8: Commit**

Do not commit yet. `tsc` is red and the repo must not sit on a broken commit. Continue to Task 3.

---

### Task 3: Remove the federated details block from the institution step

**Files:**
- Modify: `src/app/create/institution/page.tsx:47-76`
- Test: `scripts/check-federated.mjs`

**Step 1: Run the check to see it fail**

Run: `node scripts/check-federated.mjs`
Expected: FAIL on "institution step no longer binds campusName" and the two related checks.

**Step 2: Remove the block**

In `src/app/create/institution/page.tsx`, delete the entire federated branch — from `{federated ? (` at line 47 through the closing `)}` at line 76 — and replace the whole `{federated ? (...) : (...)}` expression with just the unitary box, losing the ternary.

The result is:

```tsx
        <div className="flex items-start gap-3 rounded-xl border border-line-strong/80 bg-canvas/60 px-4 py-3.5">
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brass" />
          <p className="text-[0.8125rem] leading-relaxed text-muted">
            Because you chose a unitary model, SmartGov will not ask for
            campus or college units. There is no local tier to configure.
          </p>
        </div>
```

But that box is unitary-specific copy, and it would now show to federated users too. Gate it on the model and give federated users the correct explanation instead. Replace with:

```tsx
        {federated ? (
          <div className="flex items-start gap-3 rounded-xl border border-line-strong/80 bg-canvas/60 px-4 py-3.5">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brass" />
            <p className="text-[0.8125rem] leading-relaxed text-muted">
              You are registering as the University Student Government, so there
              is no campus to choose here — the USG sits above all of them. Once
              setup is done you can add your colleges and campuses, then invite
              a local council into each one.
            </p>
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-xl border border-line-strong/80 bg-canvas/60 px-4 py-3.5">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brass" />
            <p className="text-[0.8125rem] leading-relaxed text-muted">
              Because you chose a unitary model, SmartGov will not ask for
              campus or college units. There is no local tier to configure.
            </p>
          </div>
        )}
```

**Step 3: Update the federated lede**

Replace the lede at `institution/page.tsx:28-31` so it stops implying the registrant is a local body:

```tsx
      lede={
        federated
          ? "Your university sits at the top of the federated structure. You are registering as the USG, which sits above every local council."
          : "Your institution is served by a single student council, so campus and college fields are not needed."
      }
```

**Step 4: Clean up the now-unused import**

`IconLayers` was only used by the removed block header. Check with:

```bash
Select-String -Path src\app\create\institution\page.tsx -Pattern "IconLayers"
```

If it now appears only in the import statement, remove `IconLayers` from the import at `institution/page.tsx:6`, leaving:

```tsx
import { IconBuilding, IconUpload } from "@/components/ui/Icons";
```

**Step 5: Run lint to confirm no unused symbols**

Run: `npx eslint src/app/create/institution/page.tsx`
Expected: clean. If `federated` is now unused, it is still used by the lede and the new box, so it stays.

**Step 6: Run the check**

Run: `node scripts/check-federated.mjs`
Expected: the institution step checks now PASS.

**Step 7: Commit**

Still not yet — `submit.ts` and `review/page.tsx` are still broken. Continue to Task 4.

---

### Task 4: Stop sending the fields and clean the review step

**Files:**
- Modify: `src/lib/submit.ts:64-65`, `src/lib/submit.ts:136`
- Modify: `src/app/create/review/page.tsx:96`, `src/app/create/review/page.tsx:168-174`
- Test: `scripts/check-federated.mjs`

**Step 1: Run the check to see it fail**

Run: `node scripts/check-federated.mjs`
Expected: FAIL on the submit.ts checks.

**Step 2: Stop sending campus and college in the organization payload**

In `src/lib/submit.ts`, replace lines 64-65:

```ts
        campusName: federated ? draft.institution.campusName.trim() : "",
        college: federated ? draft.institution.college.trim() : "",
```

with:

```ts
        // A USG has no single campus, and the columns are still needed for
        // invited local councils. The API coerces an absent value to "".
        campusName: "",
        college: "",
```

**Step 3: Stop sending campus on the account**

In `src/lib/submit.ts` at line 136, replace:

```ts
      campusName: draft.institution.campusName.trim(),
```

with:

```ts
      campusName: "",
```

**Step 4: Remove the campus and college rows from the charter review**

In `src/app/create/review/page.tsx`, delete the two detail rows at lines 168-174 (the "Campus or branch" row and the "College or department" row). Keep the surrounding `details`/`rows` structure and every other row.

**Step 5: Remove the campus suffix from the charter title**

In `src/app/create/review/page.tsx` at line 96, the title is built with a campus suffix:

```tsx
{federated && inst.campusName ? ` · ${inst.campusName}` : ""}
```

Remove that fragment so the title is just the organization name.

**Step 6: Check for orphaned references**

Run:

```bash
Select-String -Path src\app\create\review\page.tsx,src\app\create\institution\page.tsx,src\lib\submit.ts -Pattern "campusName|college|federated"
```

Expected: `campusName` and `college` return no matches. `federated` may still appear in the institution page (lede and box) and is fine there.

**Step 7: Run the full gate**

```bash
npx tsc --noEmit
npx eslint .
npm run build
node scripts/check-federated.mjs
```

Expected: all four clean. This is the first point where the repo builds — the earlier tasks deliberately left it red.

**Step 8: Run the check**

Run: `node scripts/check-federated.mjs`
Expected: all checks PASS.

**Step 9: Commit**

```bash
git add src/lib/submit.ts src/app/create/review/page.tsx
git commit -m "Stop forwarding campus and college from the setup wizard"
```

---

### Task 5: Hide the role picker under federated

**Files:**
- Modify: `src/app/create/account/page.tsx:160-231`
- Modify: `src/lib/store.ts:161-171` (`validateStep`, the account role error)
- Test: `scripts/check-federated.mjs`

**Step 1: Add the failing assertion**

Add to `scripts/check-federated.mjs`:

```js
// --- 8. The role picker is federated-aware ---
const account = readFileSync(join(ROOT, "src/app/create/account/page.tsx"), "utf8");
check(
  "account step gates the role fieldset on the model",
  /draft\.model\s*===\s*"federated"[\s\S]{0,200}?(fieldset|roleFieldset)/.test(account) ||
    /roleFieldset/.test(account),
  "the role fieldset still renders for federated users",
);
check(
  "account step explains the forced role",
  /usg_officer|USG/i.test(account),
);

// The role error must not be raised for federated.
const accountValidate = validate.match(/id === "account"[\s\S]*?\n  \}/)?.[0] ?? "";
check(
  "validateStep does not demand a role choice under federated",
  !/id === "account"[\s\S]*?federated[\s\S]{0,120}?Select your role/.test(validate),
  "federated users are still asked to pick a role",
);
```

**Step 2: Run it to verify it fails**

Run: `node scripts/check-federated.mjs`
Expected: FAIL on the role fieldset checks.

**Step 3: Make the role error unitary-only**

In `src/lib/store.ts`, the account validation block (currently `store.ts:161-171`) ends with:

```ts
    if (!account.role) errors.push("Select your role.");
```

Replace it with:

```ts
    // Federated is USG-only, so the role is forced rather than chosen. Only
    // unitary has a real choice to make.
    if (model === "unitary" && !account.role) errors.push("Select your role.");
```

**Step 4: Route validation through `effectiveRole`**

In the same function, the account block reads `if (!account.role)`. Change the
condition to resolve the role first. Add above the `if (id === "account")`
block:

```ts
  const role = effectiveRole(model, account.role);
```

then use `if (model === "unitary" && !role)`.

**Step 5: Hide the fieldset under federated**

In `src/app/create/account/page.tsx`, wrap the role fieldset (lines 160-231) so
it only renders for unitary. Extract the fieldset into a local component or
just guard it inline — the inline guard is the smaller diff:

```tsx
        {draft.model === "unitary" ? (
          <fieldset>
            {/* ...unchanged fieldset contents... */}
          </fieldset>
        ) : (
          <p className="rounded-xl border border-line-strong/80 bg-canvas/60 px-4 py-3.5 text-[0.8125rem] leading-relaxed text-muted">
            You are registering as the{" "}
            <strong className="font-semibold text-ink">
              University Student Government
            </strong>
            . Local councils are added by invitation once setup is complete, so
            there is no separate role to choose here.
          </p>
        )}
```

**Step 6: Update the account lede**

Replace the lede at `account/page.tsx:70`:

```tsx
      lede="This account owns the organization. You can invite treasurers, auditors, and council officers once setup is complete."
```

with a model-aware version:

```tsx
      lede={
        draft.model === "federated"
          ? "This account owns the University Student Government. You can invite local councils, treasurers, and auditors once setup is complete."
          : "This account owns the organization. You can invite treasurers, auditors, and council officers once setup is complete."
      }
```

**Step 7: Run the full gate**

```bash
npx tsc --noEmit
npx eslint .
npm run build
node scripts/check-federated.mjs
```

Expected: all clean, all checks PASS.

**Step 8: Commit**

```bash
git add src/app/create/account/page.tsx src/lib/store.ts scripts/check-federated.mjs
git commit -m "Hide the role picker under federated and settle the role in validation"
```

---

### Task 6: Wire the check into package.json and commit the wizard change

**Files:**
- Modify: `package.json:6-11`

**Step 1: Add the script**

In `package.json`, add alongside `check:reveal`:

```json
    "check:reveal": "node scripts/check-reveal.mjs",
    "check:federated": "node scripts/check-federated.mjs"
```

**Step 2: Run both checks through npm**

```bash
npm run check:reveal
npm run check:federated
```

Expected: both pass. If `check:reveal` fails, a previous commit broke the reveal
contract — fix that before continuing; it is not related to this work.

**Step 3: Final full gate**

```bash
npx tsc --noEmit
npx eslint .
npm run build
```

Expected: all clean.

**Step 4: Commit**

```bash
git add package.json
git commit -m "Expose the federated invariant check as a script"
```

---

### Task 7: Manual walkthrough, both models

This cannot be automated. It is the only way to confirm the wizard actually
behaves, because most of the failure modes are visual and involve a resumed
session.

**Step 1: Start the dev server**

Run: `npm run dev`
Expected: a local URL, normally `http://localhost:3000`.

**Step 2: Walk the federated path**

Go to `/create` and complete: Federated → account details → institution →
organization → review → charter.

Confirm at each step:
- Account: the role fieldset is NOT shown. The explanatory paragraph about the
  University Student Government IS shown.
- Account: password and email validation still work; `Continue` is blocked
  until they are valid.
- Institution: no "Campus or branch name", no "College or department", no
  "Federated details" heading. University name and seal are present.
- Institution: the federated explanatory paragraph appears and reads correctly.
- Review: no campus or college row. The charter title has no campus suffix.
- Charter: completes and issues a number.

**Step 3: Walk the unitary path**

Restart at `/create` (clear sessionStorage if needed to reset the draft) and
complete: Unitary → account details → institution → organization → review.

Confirm:
- Account: the role fieldset IS shown, offering only Council Officer and
  Faculty Advisor enabled, with USG Officer and LSG Officer disabled.
- Account: continuing without picking a role shows "Select your role."
- Institution: the unitary explanatory paragraph appears.
- Review and charter complete.

**Step 4: Verify no stale draft can survive the role change**

This is the case `effectiveRole` exists for, so it must be tested directly.

In the browser console on a fresh `/create`, seed a hostile draft directly:

```js
sessionStorage.setItem("smartgov.draft.v1", JSON.stringify({
  state: {
    model: "federated",
    account: { fullName: "Test", email: "t@u.edu", password: "password123", confirmPassword: "password123", role: "lsg_officer" },
    institution: { universityName: "Test University", campusName: "Palayan", college: "Engineering", sealName: "" },
    organization: { name: "Test USG", description: "A description long enough to pass.", accent: "#16324f", academicYear: "2026 – 2027" }
  },
  version: 0
}));
location.reload();
```

Expected after reload: the v1 key is ignored, because the store now reads
`smartgov.draft.v2`. The flow restarts clean. No "LSG Officer" survives, and no
campus field appears.

Then confirm the belt-and-braces path — seed a **v2** draft that already claims
`lsg_officer` under federated:

```js
sessionStorage.setItem("smartgov.draft.v2", JSON.stringify({
  state: {
    model: "federated",
    account: { fullName: "Test", email: "t@u.edu", password: "password123", confirmPassword: "password123", role: "lsg_officer" },
    institution: { universityName: "Test University", sealName: "" },
    organization: { name: "Test USG", description: "A description long enough to pass.", accent: "#16324f", academicYear: "2026 – 2027" }
  },
  version: 0
}));
location.reload();
```

Expected: the account step shows no role picker for federated, so the stale
`lsg_officer` is never presented and never submitted. If `submit.ts` were to
read `draft.account.role` directly instead of `effectiveRole`, this seeded draft
would submit `lsg_officer`. Confirm `submit.ts` uses `effectiveRole` for the
role it sends.

**Step 5: Stop the dev server**

Press Ctrl+C in the dev server terminal.

---

### Task 8: Push and deploy

Only after Task 7 passes. Do not skip the walkthrough.

**Step 1: Review the whole diff**

```bash
git status --short
git --no-pager diff origin/main...HEAD
```

Confirm the diff touches only: `package.json`, `scripts/check-federated.mjs`,
`src/lib/store.ts`, `src/lib/submit.ts`, `src/app/create/institution/page.tsx`,
`src/app/create/account/page.tsx`, `src/app/create/review/page.tsx`, and the
docs. No migration file. No change to any `api/` route. No change to
`InviteSetupForm.tsx` — the invite path is deliberately untouched.

**Step 2: Confirm the invariant still holds on the built output**

```bash
npm run check:federated
```

Expected: all checks PASS.

**Step 3: Push**

```bash
git push origin main
```

**Step 4: Verify the deployment**

The wizard is client-side, so verify the shipped bundle rather than the HTML.
Fetch the landing page, confirm it returns 200, then confirm the deployed CSS
and JS no longer carry the removed behaviour. Minimum check: `/`, `/login`, and
`/create` all return 200.

---

## Notes for the implementer

**Do not add a test framework.** The repo has none, and the change is small and
locus-contained. `scripts/check-federated.mjs` is the right shape for the
guard. If a real test runner is wanted later, that is its own decision.

**Do not touch the invite path.** `InviteSetupForm.tsx`, the four
`src/app/api/invites/*` routes, and the `create_invite` / `accept_invite` RPCs
already implement invite-time campus assignment. This change makes the wizard
consistent with them. Editing them risks breaking a path that works.

**Do not add a migration.** `organizations.campus_name`,
`organizations.college`, and `accounts.campus_name` all stay. The first two are
empty for a USG organization, which is correct. The third is how an invited LSG
receives their campus and is load-bearing for the next task.

**Tasks 2 through 4 leave the repo temporarily unbuildable** — the draft type
loses fields that pages still read. That is intentional: it makes the compiler
enumerate every reference that needs fixing, rather than letting a stale
reference survive to runtime. `tsc` is expected to be red between Task 2 and
Task 4. Do not commit during that window. The first commit that includes a
passing `tsc` is Task 4 step 9.
