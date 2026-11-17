/**
 * Guards the federated USG-only invariant.
 *
 * The bug this was written for: submit.ts hardcodes accountKind to "usg" for
 * federated, while the wizard once let a person register as an "LSG Officer"
 * and *required* them to name a campus. The form offered a local claim the write
 * path never honoured.
 *
 * The contract has since settled differently from that first draft of the fix.
 * Campus and college stayed in the wizard as optional answers -- a USG that is
 * attached to one should be able to say so, and `create_organization` accepts
 * all three name fields -- while the units roster moved out of the wizard
 * entirely: the RPC derives the USG root and the dashboard's org chart is where
 * colleges and campuses are added later. So this file now guards what the code
 * is meant to do, not the retired "send empty strings" shape:
 *
 *   1. effectiveRole("federated", ...) is always "usg_officer".
 *   2. effectiveRole("unitary", ...) passes the stored role through.
 *   3. No federated validation branch demands a campus, college, or unit.
 *   4. The institution step still offers campus/college, clearly as optional.
 *   5. submit.ts forwards the institution's trimmed values rather than dropping
 *      them, and attaches the units roster only to a federated payload.
 *   6. The draft still carries a units array, seeded empty, so the type and the
 *      submit path agree even though nothing in the wizard fills it yet.
 *   7. setModel settles the federated role instead of clearing an invalid one.
 *   8. validateStep and submit.ts both derive the role through effectiveRole, so
 *      a hand-edited draft cannot claim LSG Officer for a USG organization.
 *   9. The account step gates the role picker on the governance model.
 *  10. The units step validates the organization's own fields and does not
 *      require a roster it no longer collects.
 *
 * Run: node scripts/check-federated.mjs
 *
 * These assertions are only worth their green if they can go red, so the field
 * checks were mutation-tested against reintroduction of the bug in every shape:
 * a property read under an arrow function, a JSX prop, a type key, an
 * EMPTY_DRAFT seed, a validateStep branch, a setModel that stops forcing the
 * role, and submit.ts re-forwarding the draft role
 * instead of the effective one. A check that cannot fail is decoration.
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
 * Strips comments and string literals: the two places a field name survives as
 * copy rather than as a reference. JSX text is deliberately left in place; the
 * assertions below match binding *shapes* via `bindsField`, which prose does
 * not produce, rather than trying to remove prose wholesale.
 */
function withoutStrings(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
    .replace(/`(?:[^`\\]|\\.)*`/g, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, " ")
    .replace(/'(?:[^'\\]|\\.)*'/g, " ");
}

/** Strips comments only, for assertions that must not be satisfied by prose. */
function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/**
 * Matches a real reference to a field -- a property read, an object or type
 * key, a shorthand, a destructuring target, or a JSX attribute -- rather than
 * the word merely appearing in a sentence.
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
const storeLive = withoutComments(store);

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

// --- 2. No federated validation may demand campus, college, or units ---
// The units branch's error copy names the organization, not its local tier, so
// a federated requirement that mentions campus or college would have to come
// from a branch that should not exist.
const validate = storeCode.match(/export function validateStep[\s\S]*$/)?.[0] ?? "";
check(
  "validateStep never pairs federated with a campus, college, or unit requirement",
  !/federated[\s\S]{0,80}(campus|college|unit)/i.test(validate),
  "validateStep still gates federated on campus, college, or a units roster",
);

// --- 3. Institution step keeps campus/college, as optional answers ---
check(
  "institution step renders the campus input",
  /\bid="campusName"/.test(institution),
  "the optional campus answer disappeared from the institution step",
);
check(
  "institution step renders the college input",
  /\bid="college"/.test(institution),
  "the optional college answer disappeared from the institution step",
);
check(
  "institution step labels campus and college optional",
  (institution.match(/Optional\./g) ?? []).length >= 2,
  "campus/college are not marked optional, so they read as required",
);
// Read raw: the id lives inside a string literal, which withoutStrings removes.
check(
  "institution step still binds the university name as required",
  /institution\.universityName\.trim\(\)\.length/.test(
    withoutStrings(storeLive.match(/if \(id === "institution"\)[\s\S]*?\n {2}\}/)?.[0] ?? ""),
  ),
  "the required university name check went missing",
);

// --- 4. Submit forwards the institution values and a federated roster ---
check(
  "submit.ts forwards the campus value rather than dropping it",
  /campusName:\s*draft\.institution\.campusName\.trim\(\)/.test(submit),
  "submit.ts no longer forwards draft.institution.campusName",
);
check(
  "submit.ts forwards the college value rather than dropping it",
  /college:\s*draft\.institution\.college\.trim\(\)/.test(submit),
  "submit.ts no longer forwards draft.institution.college",
);
check(
  "submit.ts attaches the units roster only to a federated payload",
  /units:\s*federated\s*\?\s*draft\.units\.map\(/.test(submit),
  "submit.ts sends the units roster outside the federated branch",
);

// --- 5. The draft still carries the units array, seeded empty ---
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

// --- 6. The units step validates the organization, not a roster ---
const unitsBranch = storeLive.match(/if \(id === "units"[\s\S]*?\n {2}\}/)?.[0] ?? "";
check(
  "validateStep's units branch checks the organization's name",
  /organizationName\.trim\(\)\.length/.test(unitsBranch),
  unitsBranch
    ? `branch: ${unitsBranch.trim()}`
    : 'no live `if (id === "units")` branch was found in validateStep',
);
check(
  "validateStep's units branch does not require a units roster",
  unitsBranch !== "" && !bindsField(withoutStrings(unitsBranch), "units"),
  "the units step still demands a roster the wizard no longer collects",
);

// --- 7. setModel writes the forced role ---
const setModel = store.match(/setModel:[\s\S]*?\}\),\n/)?.[0] ?? "";
check(
  "setModel forces usg_officer when federated",
  /federated[\s\S]*usg_officer/.test(setModel),
  "setModel still only clears an invalid role",
);

// --- 9. The forced role is actually consumed, not merely exported ---
// An exported helper nothing calls defends nothing. setModel already writes
// "usg_officer" when the model is picked, but a hand-edited draft skips
// setModel entirely, so the role has to be re-derived at the point of use.
check(
  "validateStep reads the role through effectiveRole",
  /effectiveRole\(/.test(validate),
  "validation ignores the forced federated role",
);
check(
  "submit.ts derives the account role through effectiveRole",
  /officerRole:\s*effectiveRole\(/.test(submit),
  "a forged draft could still claim LSG Officer for a USG organization",
);

// --- 10. The account step does not ask a federated registrant to pick a role ---
check(
  "the account step gates the role picker on the governance model",
  /\{!federated\s*\?/.test(account) && /<fieldset/.test(account),
  "the role picker is not conditional, so a federated registrant can still pick LSG Officer",
);

console.log(
  failures === 0
    ? `\nall ${checks} checks passed\n`
    : `\n${failures} of ${checks} checks FAILED\n`,
);

process.exit(failures === 0 ? 0 : 1);
