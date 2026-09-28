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
