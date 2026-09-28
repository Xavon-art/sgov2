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
 *   6. The draft type carries neither field, and nothing seeds one.
 *   7. The persist key is bumped, so a v1 draft cannot carry them forward.
 *   8. setModel settles the federated role instead of clearing an invalid one.
 *   9. The institution step renders no input bound to either retired field.
 *  10. The draft carries a units array, and validateStep refuses an empty one
 *      when the model is federated.
 *  11. The persist key is NOT bumped for units: zustand's shallow merge hands a
 *      pre-existing v2 draft the empty default for free.
 *
 * Run: node scripts/check-federated.mjs (11 items, 25 assertions)
 *
 * These assertions are only worth their green if they can go red, so the field
 * checks were mutation-tested against reintroduction of the field in every
 * shape: a property read under an arrow function, a JSX prop, a type key, an
 * EMPTY_DRAFT seed, a validateStep branch, a reverted persist key, a setModel
 * that stops forcing the role, and submit.ts re-forwarding either value. The
 * two units items were mutation-tested the same way: dropping the
 * `model === "federated"` gate, dropping the `validateUnits` call, deleting the
 * type key or its EMPTY_DRAFT seed, and renaming the key to v3 each turn the
 * script red. A check that cannot fail is decoration.
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

/**
 * Strips comments and string literals: the two places a retired field name
 * survives as copy rather than as a reference.
 *
 * JSX text is deliberately left in place. An earlier version stripped it by
 * matching `>` ... `<`, which cannot tell the `>` of an arrow function or a
 * comparison from the `>` that opens JSX text -- the arrow above paired with a
 * later `<` and swallowed live code, so a real `draft.institution.campusName`
 * became invisible and these checks reported PASS. The assertions below
 * therefore match binding *shapes* via `bindsField`, which prose does not
 * produce, rather than trying to remove prose wholesale.
 */
function withoutStrings(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\*/g, " ")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
    .replace(/`(?:[^`\\]|\\.)*`/g, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, " ")
    .replace(/'(?:[^'\\]|\\.)*'/g, " ");
}

/**
 * Strips comments only, for assertions that must not be satisfied by prose: a
 * commented-out guard is not a guard. String literals are deliberately kept,
 * because the units and persist-key checks are specifically about comparing
 * against "units", "federated", and a key by value.
 */
function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/**
 * Matches a real reference to a retired field -- a property read, an object or
 * type key, a shorthand, a destructuring target, or a JSX attribute -- rather
 * than the word merely appearing in a sentence. Leaving the name in a JSX-text
 * sentence is fine; binding it is not.
 */
function bindsField(code, name) {
  return new RegExp(
    `\\.${name}\\b` + // draft.institution.campusName
      `|\\b${name}\\s*:` + // campusName: string
      `|\\b${name}\\s*[,}=]`, // { campusName } / campusName= / campusName,
    "i",
  ).test(code);
}

const store = readFileSync(join(ROOT, "src/lib/store.ts"), "utf8");
const submit = readFileSync(join(ROOT, "src/lib/submit.ts"), "utf8");
const institution = readFileSync(
  join(ROOT, "src/app/create/institution/page.tsx"),
  "utf8",
);
const account = readFileSync(join(ROOT, "src/app/create/account/page.tsx"), "utf8");
const storeCode = withoutStrings(store);
const institutionCode = withoutStrings(institution);

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
  // Asserts the behaviour, not the word "unitary": the helper never names it,
  // because unitary is handled by an unconditional fall-through. Requiring the
  // closing brace right after proves the return is not nested in a branch.
  /return\s+role;\s*\n\}/.test(body),
  "no unconditional fall-through `return role`; unitary would not pass the role through",
);
check(
  "effectiveRole falls back to usg_officer when federated has no model",
  /return\s+"usg_officer"/.test(body),
);

// --- 2. No federated validation may demand campus or college ---
// The units branch (item 10) names all three unit types in its error copy and
// is legitimately gated on federated, so the 80-character window is what keeps
// the two apart. Widening that window to "read the whole branch" would fail on
// that message; narrowing it below ~30 would let a real campusName requirement
// back in. Do not reword the units message to a single unit type without
// re-measuring this.
const validate = storeCode.match(/export function validateStep[\s\S]*$/)?.[0] ?? "";
check(
  "validateStep never pairs federated with a campus or college requirement",
  !/federated[\s\S]{0,80}(campus|college)/i.test(validate),
  "validateStep still gates federated on campus or college",
);

// --- 3. Institution step is free of the removed fields ---
check(
  "institution step no longer binds campusName",
  !bindsField(institutionCode, "campusName"),
  "a live reference to campusName is still in the institution step",
);
check(
  "institution step no longer binds college",
  !bindsField(institutionCode, "college"),
  "a live reference to college is still in the institution step",
);
// Read raw: the id lives inside a string literal, which withoutStrings removes.
check(
  "institution step renders no campusName or college input",
  !/\bid="(campusName|college)"/.test(institution),
  "a leftover id attribute still points at a retired field",
);
check(
  "institution step no longer renders the federated details block",
  !/Federated details/.test(institution),
);

// --- 4. Submit stops sending both fields ---
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

// --- 5. The draft no longer carries the removed fields ---
check(
  "InstitutionDraft no longer declares campusName",
  !bindsField(storeCode, "campusName"),
  "campusName is still part of the draft type",
);
check(
  "InstitutionDraft no longer declares college",
  !bindsField(storeCode, "college"),
  "college is still part of the draft type",
);
check(
  "EMPTY_DRAFT seeds neither field",
  !bindsField(storeCode, "campusName") && !bindsField(storeCode, "college"),
);

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

// --- 8. The forced role is actually consumed, not merely exported ---
// An exported helper nothing calls defends nothing. setModel already writes
// "usg_officer" when the model is picked, but a hand-edited v2 draft skips
// setModel entirely, so the role has to be re-derived at the point of use.
check(
  "validateStep reads the role through effectiveRole",
  /effectiveRole\(/.test(validate),
  "validation ignores the forced federated role",
);
check(
  "submit.ts derives the account role through effectiveRole",
  /officerRole:\s*effectiveRole\(/.test(submit),
  "a forged v2 draft could still claim LSG Officer for a USG organization",
);

// --- 9. The account step does not ask a federated registrant to pick a role ---
check(
  "the account step gates the role picker on the governance model",
  /\{!federated\s*\?/.test(account) && /<fieldset/.test(account),
  "the role picker is not conditional, so a federated registrant can still pick LSG Officer",
);

// --- 10. The draft carries units, and federated must declare at least one ---
// A USG with nothing under it is not the shape this design describes, so the
// empty roster is refused at the wizard rather than surfacing later as a
// government with no local tier.
//
// Everything below is matched against `storeLive` rather than `store`, and the
// order matters: strip comments over the whole file *first*, then carve out the
// region. Carving first and stripping after leaves a commented-out guard
// looking live, because the `//` sits outside the match. That was not a
// hypothetical -- the first version of these checks passed a branch that had
// been commented out wholesale.
const storeLive = withoutComments(store);

const orgDraft = storeLive.match(/export type OrgDraft[\s\S]*?\n\};/)?.[0] ?? "";
check(
  "OrgDraft declares units as an array of DraftUnit",
  /units:\s*DraftUnit\[\]/.test(orgDraft),
  orgDraft ? `OrgDraft: ${orgDraft.trim()}` : "the OrgDraft type was not found",
);

const emptyDraft = storeLive.match(/export const EMPTY_DRAFT[\s\S]*?\n\};/)?.[0] ?? "";
check(
  "EMPTY_DRAFT seeds an empty units array",
  /^\s*units:\s*\[\],\s*$/m.test(emptyDraft),
  emptyDraft ? `EMPTY_DRAFT: ${emptyDraft.trim()}` : "EMPTY_DRAFT was not found",
);

// Matched on comment-stripped source, so "units" here is a live step id. The
// strings themselves survive because withoutComments leaves literals alone.
const unitsBranch = storeLive.match(/if \(id === "units"[\s\S]*?\n {2}\}/)?.[0] ?? "";
check(
  "validateStep checks the units step through validateUnits",
  /validateUnits\(\s*units\s*\)/.test(unitsBranch),
  unitsBranch
    ? `branch: ${unitsBranch.trim()}`
    : 'no live `if (id === "units")` branch was found in validateStep',
);
check(
  "the units check is gated on the federated model",
  /model\s*===\s*"federated"/.test(unitsBranch),
  "a unitary organization would be made to declare a local tier it does not have",
);

// --- 11. The key is not bumped, because nothing needs discarding ---
// Both halves can go red, and they fail differently on purpose. Item 6 above
// asks that the key is off v1; that check would still pass at v3, so the
// absence of a bump needs its own assertion rather than borrowing that one. A
// v3 named only in a comment leaves both green, which is the point: this is
// about the key, not about the word.
check(
  "the persist key is still smartgov.draft.v2, unbumped by units",
  /name:\s*"smartgov\.draft\.v2"/.test(storeLive),
  "units was given a version bump of its own, discarding every in-flight draft",
);
check(
  "no later persist key version is declared",
  !/smartgov\.draft\.v[3-9]/.test(storeLive),
  "a v3 key throws away every v2 draft over a field that already defaults to []",
);

console.log(
  failures === 0
    ? `\nall ${checks} checks passed\n`
    : `\n${failures} of ${checks} checks FAILED\n`,
);

process.exit(failures === 0 ? 0 : 1);
