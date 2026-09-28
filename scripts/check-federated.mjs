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

/**
 * Strips everything a reader sees but a binding cannot be.
 *
 * The wizard still has to explain campuses and colleges -- to a unitary
 * registrant, and to a USG told where to add them later -- and the v2 persist
 * comment has to name the fields it retires. A raw grep for "college" would
 * fail on that copy while the code was clean, so the field assertions read
 * source with comments, string literals, and JSX text removed. Identifiers,
 * attributes, and expressions survive, which is where a real reference lives.
 *
 * `id` attributes are carried across the string strip: an id is a handle on a
 * field rather than copy, so a leftover `id="campusName"` stays visible.
 */
function withoutProse(source) {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
    .replace(/`(?:[^`\\]|\\.)*`/g, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, " ")
    .replace(/'(?:[^'\\]|\\.)*'/g, " ")
    .replace(/>(?:[^<>{}]|\{[^{}]*\})*</g, "><");
  return [stripped, ...(source.match(/\bid="[^"]*"/g) ?? [])].join(" ");
}

const store = readFileSync(join(ROOT, "src/lib/store.ts"), "utf8");
const submit = readFileSync(join(ROOT, "src/lib/submit.ts"), "utf8");
const institution = readFileSync(
  join(ROOT, "src/app/create/institution/page.tsx"),
  "utf8",
);
const storeCode = withoutProse(store);
const institutionCode = withoutProse(institution);

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
const validate = store.match(/export function validateStep[\s\S]*$/)?.[0] ?? "";
check(
  "validateStep never pairs federated with a campus or college requirement",
  !/federated[\s\S]{0,80}(campus|college)/i.test(validate),
  "validateStep still gates federated on campus or college",
);

// --- 3. Institution step is free of the removed fields ---
check(
  "institution step no longer binds campusName",
  !/campusName/.test(institutionCode),
);
check(
  "institution step no longer binds college",
  !/\bcollege\b/.test(institutionCode),
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
  !/type InstitutionDraft[\s\S]*?campusName[\s\S]*?\}/.test(storeCode),
  "campusName is still part of the draft type",
);
check(
  "InstitutionDraft no longer declares college",
  !/type InstitutionDraft[\s\S]*?\bcollege\b[\s\S]*?\}/.test(storeCode),
);
// Read raw, not through withoutProse: the assertion needs the `""` literal, and
// no comment or copy in store.ts writes `campusName: ""`.
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

console.log(
  failures === 0
    ? `\nall ${checks} checks passed\n`
    : `\n${failures} of ${checks} checks FAILED\n`,
);

process.exit(failures === 0 ? 0 : 1);
