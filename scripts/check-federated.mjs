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

import { existsSync, readFileSync } from "node:fs";
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
const governanceModelPage = readFileSync(
  join(ROOT, "src/app/create/governance-model/page.tsx"),
  "utf8",
);
const unitsPage = readFileSync(join(ROOT, "src/app/create/units/page.tsx"), "utf8");
const usgNav = readFileSync(join(ROOT, "src/components/dashboard/usg-nav.ts"), "utf8");
const usgManage = readFileSync(join(ROOT, "src/app/usg/manage/ManageClient.tsx"), "utf8");
const lsgNav = readFileSync(join(ROOT, "src/components/dashboard/lsg-nav.ts"), "utf8");
const usgLayout = readFileSync(join(ROOT, "src/app/usg/layout.tsx"), "utf8");
const lsgLayout = readFileSync(join(ROOT, "src/app/lsg/layout.tsx"), "utf8");
const dashboardContext = readFileSync(
  join(ROOT, "src/components/dashboard/dashboard-context.tsx"),
  "utf8",
);
const centralPagePath = join(ROOT, "src/app/central/page.tsx");
const centralCatchAllPath = join(ROOT, "src/app/central/[...slug]/page.tsx");
const centralPage = existsSync(centralPagePath) ? readFileSync(centralPagePath, "utf8") : "";
const centralCatchAll = existsSync(centralCatchAllPath)
  ? readFileSync(centralCatchAllPath, "utf8")
  : "";
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

const governanceLive = withoutComments(governanceModelPage);
check(
  "the setup offers a selectable unitary model labelled Centralized",
  /id:\s*"unitary"[\s\S]{0,200}(name:\s*"Centralized"|alias:\s*"Centralized")/.test(
    governanceLive,
  ),
  "the centralized card is still missing from the model choices",
);
check(
  "the Coming soon centralized card is gone",
  !/Coming soon/.test(governanceLive) && !/aria-disabled/.test(governanceLive),
  "a disabled placeholder still stands in for the centralized model",
);
check(
  "the centralized card explains that it has no LSG tier",
  /No LSG tier/i.test(governanceLive),
  "the no-LSG-tier promise disappeared from the selectable card",
);
check(
  "the setup copy does not present a single supported model",
  /[Cc]entralized/.test(unitsPage) && /org chart/i.test(unitsPage),
  "the organization step still reads as federated-only",
);

check(
  "effectiveRole defaults an empty unitary role to council_officer",
  /model === "unitary"[\s\S]{0,80}return\s+role\s*\|\|\s*"council_officer"/.test(body),
  body ? `body: ${body.trim()}` : "effectiveRole body not found",
);
check(
  "rolesForModel keeps the unitary council/advisor pair",
  /if \(model === "unitary"\) return \["council_officer", "advisor"\];/.test(storeLive),
  "the unitary role list changed",
);
check(
  "setModel settles a valid centralized role",
  /model === "unitary"[\s\S]{0,200}council_officer/.test(
    store.match(/setModel:[\s\S]*?\}\),\n/)?.[0] ?? "",
  ),
  "switching to centralized can leave an invalid role in the draft",
);
check(
  "submit sends one council root for the centralized model",
  /:\s*\[\{\s*name:\s*draft\.organizationName\.trim\(\),\s*unitType:\s*"council"\s*\}\]/.test(
    submit,
  ),
  "the centralized branch no longer sends a single council root",
);
check(
  "registerAccount maps the unitary model to a central account",
  /accountKind:\s*draft\.model === "unitary"\s*\?\s*"central"\s*:\s*"usg"/.test(submit),
  "centralized accounts are not registered on the central account kind",
);

check(
  "USG nav derives centralized state from the shared role fields",
  /const centralized = role\.isCentral \|\| role\.governanceModel === "unitary"/.test(usgNav),
  "the USG nav has no shared-contract centralized predicate",
);
check(
  "USG nav hides People & Units when centralized",
  /!centralized \|\| index !== 0/.test(usgNav),
  "centralized owners still see the federated people links",
);
check(
  "USG manage hides People & Units when centralized",
  usgManage.includes("canManage && !centralized") &&
    usgManage.includes('!(centralized && requestedTab === "people")') &&
    usgManage.includes('tab === "people" && canManage && !centralized'),
  "centralized owners can still open the federated people panel by URL",
);
check(
  "USG nav has no Monitoring link",
  !usgNav.includes('label: "Monitoring"') && !usgNav.includes("?tab=monitoring"),
  "the merged Manage nav still exposes the removed aggregate view",
);
check(
  "USG structure keeps the published chart owner-only when federated",
  !usgNav.includes('label: "Published chart"') &&
    usgManage.includes('tab === "structure"') &&
    usgManage.includes("!centralized ? (") &&
    usgManage.includes('href="/org-chart"') &&
    usgManage.includes("View published chart"),
  "the federated owner lost the published-chart action in Government structure",
);
check(
  "USG nav keeps the non-federated sections",
  ["Government structure", "Profile and Customization", "Documents", "Budget"].every(
    (label) => usgNav.includes(`label: "${label}"`),
  ),
  "a required centralized section disappeared from the USG nav",
);
check(
  "LSG nav derives centralized state from the shared role fields",
  /const centralized = role\.isCentral \|\| role\.governanceModel === "unitary"/.test(lsgNav),
  "the LSG nav has no shared-contract centralized predicate",
);
check(
  "LSG nav hides the cross-unit resolution gate when centralized",
  /centralized \? \[\] : \[\{ label: "Resolutions"/.test(lsgNav) &&
    !lsgNav.includes('label: "Unit details"'),
  "centralized LSG nav still exposes cross-unit approval links",
);
check(
  "LSG nav keeps its working sections",
  ["Government structure", "Profile and Customization", "Documents", "Budget"].every(
    (label) => lsgNav.includes(`label: "${label}"`),
  ),
  "a required centralized section disappeared from the LSG nav",
);

check(
  "the USG layout keeps the anonymous and wrong-side server redirects",
  /if \(!account\) redirect\("\/login"\)/.test(usgLayout) &&
    /redirect\("\/lsg"\)/.test(usgLayout),
  "a server-side redirect disappeared from the USG layout",
);
check(
  "the USG layout refuses unit-bound LSG accounts",
  /isUnitAccount[\s\S]{0,160}redirect\("\/lsg"\)/.test(usgLayout),
  "a unit-bound LSG account can still be coerced into the USG shell",
);
check(
  "the LSG layout sends central accounts back to the USG shell",
  /isCentral[\s\S]{0,160}redirect\("\/usg"\)/.test(lsgLayout),
  "a central account is not redirected out of the LSG shell",
);
check(
  "both layouts mount the shared client workspace guard",
  /<WorkspaceGuard section="usg" \/>/.test(usgLayout) &&
    /<WorkspaceGuard section="lsg" \/>/.test(lsgLayout),
  "one of the workspaces has no client-side guard",
);
check(
  "the client guard redirects from live context using the shared contract fields",
  /usePathname/.test(dashboardContext) &&
    /useRouter/.test(dashboardContext) &&
    /router\.replace/.test(dashboardContext) &&
    /isCentral/.test(dashboardContext) &&
    /isUnitAccount/.test(dashboardContext),
  "the client guard cannot see the account and role identity fields",
);

check("the /central route exists", centralPage !== "", "src/app/central/page.tsx is missing");
check(
  "the /central root sends anonymous visitors to login and members to the USG workspace",
  /if \(!account\) redirect\("\/login"\)/.test(centralPage) &&
    /redirect\("\/usg"\)/.test(centralPage),
  "the /central root does not resolve cleanly into the centralized workspace",
);
check("the /central catch-all route exists", centralCatchAll !== "", "src/app/central/[...slug]/page.tsx is missing");
check(
  "the catch-all awaits its dynamic params",
  /params:\s*Promise<\{ slug: string\[\] \}>/.test(centralCatchAll) &&
    /await params/.test(centralCatchAll),
  "the catch-all reads params with the old synchronous convention",
);
check(
  "the catch-all only forwards allowlisted workspace paths",
  /ALLOWED_CENTRAL_SECTIONS/.test(centralCatchAll) &&
    /redirect\(target\)/.test(centralCatchAll) &&
    !/redirect\(`\/central/.test(centralCatchAll),
  "an unsafe /central path can produce a broken redirect",
);

console.log(
  failures === 0
    ? `\nall ${checks} checks passed\n`
    : `\n${failures} of ${checks} checks FAILED\n`,
);

process.exit(failures === 0 ? 0 : 1);
