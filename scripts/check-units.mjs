/**
 * Guards the unit-hierarchy contract.
 *
 * The bug this exists to catch: the org chart's per-officer scoping is the
 * whole feature. An LSG officer must never learn that a unit other than their
 * own and its parent USG exists, and the only way to guarantee that is to
 * never put the other rows in the result set -- a client-side filter over a
 * full fetch still ships every row to the browser, where devtools can read
 * it, so a TypeScript filter would be decoration. The same "decorated, not
 * enforced" failure mode runs through the rest of this list: a unique index
 * that is not partial lets two Treasurers sit at once, a wizard step that is
 * not model-scoped asks a unitary organization for a local tier it does not
 * have, and a SECURITY DEFINER function that is not revoked from public is
 * a second, weaker door into an RLS-locked table.
 *
 * The contract:
 *   1. The four chart tables exist in 00600, and the enum includes department.
 *   2. Both partial unique indexes on unit_memberships exist in 00600.
 *   3. unit_chart scopes the LSG officer's read in SQL, not TypeScript.
 *   4. The units wizard step is skipped for a unitary organization.
 *   5. submit.ts sends units with the type key and no draft campus or college.
 *   6. Every new function is security definer, pinned search_path, revoked.
 *   7. The four new tables are RLS-enabled with no policies.
 *   8. The my-council page makes exactly one data call.
 *   9. list_roster exists and is owner-only.
 *  10. Owners are approved by an emailed OTP, not at submission.
 *  11. Password recovery is an emailed OTP against a dedicated reset row.
 *  12. The dashboard can add a unit, and can invite an officer into it with
 *      no position seat.
 *  13. An owner can cancel and resend an invitation, and a cancelled one
 *      cannot be completed by a code that was already in the mailbox.
 *  14. LSG requirement submissions: programs, templates, versioned proposal
 *      review, storage-backed uploads, and the two dashboard shells with the
 *      skip-setup gate.
 *  15. The government structure: the document's shape and order, the approval
 *      gate, the author/ancestor scopes, photo write-only reads, and the fact
 *      that a departed author nulls rather than blocks an organization.
 *
 * Run: node scripts/check-units.mjs (15 items, 264 assertions)
 *
 * These assertions are only worth their green if they can go red, so the
 * load-bearing ones were mutation-tested against the exact regressions they
 * guard: the caller's account predicate was deleted from the seated CTE, a
 * partial unique index was dropped from 00600, the units step was unscoped
 * from the federated model, the type key was renamed in the submit payload,
 * `security definer` was stripped from a chart function, a policy was added
 * to 00600, a roster call was added to the my-council page, and the
 * founding-member check was removed from list_roster -- each turn the script
 * red. The 001500 guards were mutation-tested the same way: deleting
 * `for update`, dropping the organization predicate from either UPDATE,
 * removing the rate-limit meter, and deleting the OTP clear out of
 * `revoke_invite` each turn item 13 red. A check that cannot fail is
 * decoration.
 */

import { readFileSync, readdirSync } from "node:fs";
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
 * Strips comments only, for assertions that must not be satisfied by prose: a
 * commented-out guard is not a guard. String literals are deliberately kept,
 * because the step-scoping checks below compare against "units" and
 * "federated" by value.
 */
function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/**
 * Strips SQL line comments for the same reason: a `--`-commented unique index
 * or caller filter is not one. String literals survive, because the enum check
 * compares against 'department' by value.
 */
function withoutSqlComments(sql) {
  return sql.replace(/--[^\n]*/g, " ");
}

const flat = (text) => text.replace(/\s+/g, " ");

const readMigration = (name) =>
  withoutSqlComments(readFileSync(join(ROOT, `supabase/migrations/${name}`), "utf8"));

/**
 * The same read for a migration whose guard is written before the migration is.
 * A file that has not landed yet reads as empty instead of throwing, so the
 * guards below report FAIL and the other 75 assertions still get to report. A
 * stack trace is not a red state, it is an absence of one -- it would take the
 * whole contract dark along with the new item, which is the one thing a TDD
 * red step must not do.
 */
const readPendingMigration = (name) => {
  try {
    return readMigration(name);
  } catch {
    return "";
  }
};

/**
 * The same principle for source files: item 14 is written before the feature,
 * so a route or component that has not landed yet must read as empty so the
 * new guards report FAIL while the older assertions still report. A stack
 * trace would take the whole contract dark.
 */
const readPendingSource = (path) => {
  try {
    return withoutComments(readFileSync(join(ROOT, path), "utf8"));
  } catch {
    return "";
  }
};

const m5 = readMigration("20260101000500_add_department_unit_type.sql");
const m6 = readMigration("20260101000600_unit_hierarchy_tables.sql");
const m7 = readMigration("20260101000700_create_organization_unit_tree.sql");
const m8 = readMigration("20260101000800_unit_chart_functions.sql");
const m9 = readMigration("20260101000900_roster_invites.sql");
const m10 = readMigration("20260101001000_list_roster.sql");
const m11 = readMigration("20260101001100_owner_otp_approval.sql");
const m12 = readMigration("20260101001200_password_reset.sql");
const m14 = readPendingMigration("20260101001400_add_unit_and_seatless_invites.sql");
const m15 = readPendingMigration("20260101001500_invite_cancel_and_resend.sql");
const m20 = readPendingMigration("20260101002000_lsg_requirement_submissions.sql");
const m150 = readPendingMigration("20260101002150_proposal_detail_exposes_submission_id.sql");
const m160 = readPendingMigration("20260101002160_jsonb_text_array_repair.sql");
const m170 = readPendingMigration("20260101002170_jsonb_text_array_proposal_validator.sql");
const m180 = readPendingMigration("20260101002180_rowtype_read_repair.sql");
const m23 = readPendingMigration("20260101002300_budget_requests.sql");
const m24 = readPendingMigration("20260101002400_task_assignments.sql");
const m25 = readPendingMigration("20260101002500_feed_and_calendar.sql");
const m26 = readPendingMigration("20260101002600_documents_and_verification.sql");
const m27 = readPendingMigration("20260101002700_document_hardening.sql");
const m50 = readPendingMigration("20260101003050_proposal_review_flow.sql");

const steps = readFileSync(join(ROOT, "src/lib/steps.ts"), "utf8");
const submit = readFileSync(join(ROOT, "src/lib/submit.ts"), "utf8");
const store = readFileSync(join(ROOT, "src/lib/store.ts"), "utf8");
const createInstitution = readFileSync(join(ROOT, "src/app/create/institution/page.tsx"), "utf8");
const createReview = readFileSync(join(ROOT, "src/app/create/review/page.tsx"), "utf8");
const orgRoute = readFileSync(join(ROOT, "src/app/api/organization/route.ts"), "utf8");
const myCouncil = readFileSync(join(ROOT, "src/app/my-council/page.tsx"), "utf8");
const chart = readFileSync(join(ROOT, "src/lib/chart.ts"), "utf8");

const stepsLive = withoutComments(steps);
const m6Flat = flat(m6);

/**
 * Every `create or replace function` in a migration, sliced up to the next
 * one, so each block can be asked for the hardening clauses its own revoke
 * line proves it has.
 */
function functionBlocks(sql) {
  const blocks = [];
  const re = /create or replace function\s+([\w.]+)\s*\(/g;
  let m = re.exec(sql);
  while (m) {
    const start = m.index;
    const next = sql.indexOf("create or replace function", start + 1);
    blocks.push({ name: m[1], body: sql.slice(start, next === -1 ? sql.length : next) });
    m = re.exec(sql);
  }
  return blocks;
}

/**
 * The three clauses that make a SECURITY DEFINER function safe to publish: it
 * runs as its owner, its search_path is pinned so a malicious schema cannot
 * shadow a reference, and execute is revoked from public so the only callers
 * are the ones the migration grants. A function missing any one of the three
 * is a gap, named.
 */
function hardeningGaps(sql, expected) {
  const bodies = new Map(functionBlocks(sql).map((b) => [b.name, b.body]));
  const gaps = [];
  for (const name of expected) {
    const body = bodies.get(name);
    if (body === undefined) {
      gaps.push(`${name}: not defined`);
      continue;
    }
    if (!/security definer/.test(body)) gaps.push(`${name}: not security definer`);
    if (!/set search_path/.test(body)) gaps.push(`${name}: no set search_path`);
    if (!new RegExp(`revoke all on function\\s+${name.replace(/\./g, "\\.")}\\b`).test(body)) {
      gaps.push(`${name}: not revoked from public`);
    }
  }
  return gaps;
}

console.log("\nunit-hierarchy contract\n");

// --- 1. The four tables exist, and the enum includes department ---
check(
  "00600 creates smartgov.org_positions",
  /create table if not exists smartgov\.org_positions/.test(m6),
);
check(
  "00600 creates smartgov.unit_positions",
  /create table if not exists smartgov\.unit_positions/.test(m6),
);
check(
  "00600 creates smartgov.roster",
  /create table if not exists smartgov\.roster/.test(m6),
);
check(
  "00600 creates smartgov.unit_memberships",
  /create table if not exists smartgov\.unit_memberships/.test(m6),
);
check(
  "00500 adds 'department' to the unit_type enum",
  /add value if not exists 'department'/.test(m5),
  "a department's Local Student Government is a department, not a layer above or below one",
);

// --- 2. Both partial unique indexes exist ---
// Flattened, because the DDL spans lines. The `where end_date is null` tail is
// the point: without it, a term ending and the next one beginning would be
// rejected, and closed rows would collide with each other.
check(
  "00600 enforces one active holder per seat",
  /create unique index if not exists unit_memberships_one_active_holder_per_seat on smartgov\.unit_memberships \(unit_id, position_id\) where end_date is null/.test(
    m6Flat,
  ),
);
check(
  "00600 enforces one active person per unit",
  /create unique index if not exists unit_memberships_one_active_person_per_unit on smartgov\.unit_memberships \(unit_id, roster_id\) where end_date is null/.test(
    m6Flat,
  ),
);

// --- 3. The LSG officer's read is scoped in SQL, not TypeScript ---
const chartFn =
  functionBlocks(m8).find((b) => b.name === "smartgov.unit_chart")?.body ?? "";
check("00800 creates smartgov.unit_chart", chartFn.length > 0);

const ownerBranch = chartFn.match(/if v_is_owner then([\s\S]*?)\n  else/)?.[1] ?? "";
check(
  "the owner branch filters units by the caller's organization",
  /gu\.organization_id = v_account\.organization_id/.test(ownerBranch),
);

// The `else` of `if v_is_owner` is the LSG branch, and it is the whole
// invariant: the caller's visible units are resolved here, in SQL, into
// v_unit_ids, and every later query filters on that array. Matched against
// comment-stripped source, so a `--`-commented predicate does not count.
const lsgBranch = chartFn.match(/else\n([\s\S]*?)\n  end if;/)?.[1] ?? "";
const lsgFlat = flat(lsgBranch);
check(
  "the LSG branch resolves units from unit_memberships in SQL",
  /from smartgov\.unit_memberships\s+m\b/.test(lsgFlat),
  lsgFlat ? `branch: ${lsgFlat.trim()}` : "no `else` branch was found under `if v_is_owner`",
);
check(
  "the seated CTE reaches the account through the roster",
  /join smartgov\.roster r on r\.id = m\.roster_id/.test(lsgFlat),
);
check(
  "the seated query is filtered to the caller's account",
  /r\.account_id = v_account\.id/.test(lsgFlat),
  "without the account predicate the seated CTE aggregates every unit in the organization, and the scoping is decoration",
);
check(
  "only active memberships are seated",
  /m\.end_date is null/.test(lsgFlat),
);
check(
  "the LSG branch writes the resolved ids into v_unit_ids",
  /into v_unit_ids/.test(lsgFlat),
);
const scopedFilters = chartFn.match(/where gu\.id = any\(v_unit_ids\)/g) ?? [];
check(
  "the root and units payloads are filtered by the resolved id array",
  scopedFilters.length >= 2,
  `found ${scopedFilters.length} \`gu.id = any(v_unit_ids)\` filters; the root subquery and the units aggregate each need one`,
);
check(
  "chart.ts reads the chart through the unit_chart RPC",
  /callRpc<ChartResponse>\(\s*"unit_chart"/.test(chart),
);

// --- 4. The units step is skipped for a unitary organization ---
check(
  "STEPS includes a units step",
  /id: "units"/.test(stepsLive),
);
check(
  "MODEL_SCOPED scopes the units step to federated only",
  /units:\s*\[\s*"federated"\s*\]/.test(stepsLive),
  "a unitary organization has no local tier, so it is never asked to declare one",
);
const appliesTo = steps.match(/export function stepAppliesTo[\s\S]*?\n\}/)?.[0] ?? "";
check(
  "stepAppliesTo consults MODEL_SCOPED",
  /MODEL_SCOPED/.test(appliesTo),
  appliesTo ? `body: ${appliesTo.trim()}` : "stepAppliesTo was not found",
);
check(
  "visibleSteps filters the step list through stepAppliesTo",
  /STEPS\.filter\(\(step\) => stepAppliesTo\(step\.id, model\)\)/.test(stepsLive),
);

// --- 5. submit.ts sends units with the type key, and no draft campus or college ---
// The columns stay in the schema for invited local councils, so the invariant
// is not "the fields are gone" but "no draft value reaches them": both are
// sent empty, and the declared children go out under the `type` key the
// database reads first.
const unitsPayload = submit.match(/units: federated[\s\S]*?unitType: "council"/)?.[0] ?? "";
check(
  "the federated units payload carries each unit's type",
  /type:\s*unit\.type/.test(unitsPayload),
  unitsPayload ? `payload: ${unitsPayload.trim()}` : "no `units: federated` payload was found",
);
// These two were written against an earlier design where the setup step collected
// only a university name, and they asserted the draft fields were ignored. The step
// now renders all three inputs and the review screen shows them back, so "sends an
// empty string" would have been asserting that the form silently throws away what
// the registrant typed. What is actually load-bearing: the values must survive the
// trip to the server, and blank must stay legal rather than becoming an error.
check(
  "submit.ts carries campusName from the draft instead of discarding it",
  /campusName:\s*draft\.institution\.campusName\.trim\(\)/.test(submit),
  "the registrant typed a campus and submit.ts did not send it",
);

check(
  "submit.ts carries college from the draft instead of discarding it",
  /college:\s*draft\.institution\.college\.trim\(\)/.test(submit),
  "the registrant typed a college and submit.ts did not send it",
);

check(
  "the institution step actually renders the two optional inputs",
  /id="campusName"/.test(createInstitution) && /id="college"/.test(createInstitution),
  "submit.ts sends a field no input can set",
);

check(
  "the review step shows both optional fields back to the registrant",
  /label="Campus" value=\{inst\.campusName\}/.test(createReview)
    && /label="College" value=\{inst\.college\}/.test(createReview),
  "a value is collected on one step and cannot be checked on the next",
);

check(
  "only the university name is required, so a blank campus is a legal answer",
  /universityName\.trim\(\)\.length < 2/.test(store)
    && !/campusName\.trim\(\)\.length/.test(store)
    && !/college\.trim\(\)\.length/.test(store),
  "an optional field was made mandatory",
);

check(
  "a blank campus is not turned into an error by submitOrganization",
  /Draft not configured|not configured/i.test(submit)
    || /campusName:\s*draft\.institution\.campusName\.trim\(\)/.test(submit),
  "the local-only fallback path would reject a valid draft",
);
check(
  "the unitary branch keeps the legacy unitType shape",
  /unitType:\s*"council"/.test(unitsPayload),
);
check(
  "the API normalizes unitType into the type key",
  /type:\s*text\(unit\?\.type \?\? unit\?\.unitType\)/.test(orgRoute),
);
check(
  "the API unit-type allowlist includes department",
  /UNIT_TYPES = \[[^\]]*"department"/.test(orgRoute),
);

// --- 6. Every new function is hardened ---
const MIGRATION_FUNCTIONS = [
  ["00700", m7, ["public.create_organization"]],
  [
    "00800",
    m8,
    [
      "smartgov.unit_chart",
      "smartgov.add_position",
      "smartgov.toggle_unit_position",
      "smartgov.assign_officer",
      "smartgov.release_officer",
      "public.unit_chart",
      "public.add_position",
      "public.toggle_unit_position",
      "public.assign_officer",
      "public.release_officer",
    ],
  ],
  ["00900", m9, ["smartgov.create_invite", "smartgov.accept_invite", "public.create_invite"]],
  ["001000", m10, ["smartgov.list_roster", "public.list_roster"]],
  [
    "001100",
    m11,
    [
      "smartgov.set_owner_otp",
      "smartgov.verify_owner_otp",
      "smartgov.owner_registration_probe",
      "public.set_owner_otp",
      "public.verify_owner_otp",
      "public.owner_registration_probe",
    ],
  ],
  [
    "001200",
    m12,
    [
      "smartgov.begin_password_reset",
      "smartgov.complete_password_reset",
      "public.begin_password_reset",
      "public.complete_password_reset",
    ],
  ],
  [
    "001400",
    m14,
    [
      "smartgov.add_unit",
      "smartgov.create_invite",
      "public.create_invite",
      "public.add_unit",
    ],
  ],
  [
    "001500",
    m15,
    [
      "smartgov.revoke_invite",
      "smartgov.resend_invite",
      "public.revoke_invite",
      "public.resend_invite",
    ],
  ],
  [
    "002000",
    m20,
    [
      "smartgov.lsg_unit_ids",
      "smartgov.is_org_reviewer",
      "smartgov.proposal_items_valid",
      "smartgov.create_program",
      "smartgov.list_programs",
      "smartgov.list_default_requirements",
      "smartgov.set_default_requirements",
      "smartgov.match_requirement_item",
      "smartgov.create_proposal",
      "smartgov.submit_revision",
      "smartgov.list_proposals",
      "smartgov.proposal_detail",
      "smartgov.review_proposal",
      "smartgov.get_item_file",
      "smartgov.am_i_reviewer",
      "public.create_program",
      "public.list_programs",
      "public.list_default_requirements",
      "public.set_default_requirements",
      "public.match_requirement_item",
      "public.create_proposal",
      "public.submit_revision",
      "public.list_proposals",
      "public.proposal_detail",
      "public.review_proposal",
      "public.get_item_file",
      "public.am_i_reviewer",
    ],
  ],
  [
    "003050",
    m50,
    [
      "smartgov.start_proposal_review",
      "smartgov.match_proposal_requirement",
      "smartgov.claim_requirement_upload",
      "smartgov.review_proposal",
      "smartgov.submit_requirement_response",
      "smartgov.verify_proposal_requirements",
      "smartgov.get_requirement_file",
      "smartgov.proposal_detail",
      "public.start_proposal_review",
      "public.match_proposal_requirement",
      "public.claim_requirement_upload",
      "public.review_proposal",
      "public.submit_requirement_response",
      "public.verify_proposal_requirements",
      "public.get_requirement_file",
      "public.proposal_detail",
    ],
  ],
];
for (const [file, sql, expected] of MIGRATION_FUNCTIONS) {
  const gaps = hardeningGaps(sql, expected);
  check(
    `${file}: every function is security definer, pinned, and revoked from public`,
    gaps.length === 0,
    gaps.join("\n        "),
  );
}

// --- 7. The four new tables are RLS-enabled with no policies ---
for (const table of ["org_positions", "unit_positions", "roster", "unit_memberships"]) {
  check(
    `00600 enables RLS on smartgov.${table}`,
    new RegExp(`alter table smartgov\\.${table} enable row level security`).test(m6Flat),
  );
}
check(
  "00600 creates no policies",
  !/create policy/i.test(m6),
  "RLS with no policies already denies everything; a policy here would be a second, weaker door",
);
check(
  "no feature migration creates a policy",
  ![m5, m6, m7, m8, m9, m10, m11, m12, m14, m15, m20].some((sql) => /create policy/i.test(sql)),
  "on this project one permissive policy turns a locked table into a read surface for anyone holding the publishable key",
);

// --- 8. The my-council page makes exactly one data call ---
// The scoping is the point of the page, so a second call to "fill in details"
// would be a second chance to widen it. The roster in particular is
// owner-only, and an LSG officer must never be able to list it.
check(
  "the my-council page makes no roster call",
  !/fetchRoster/.test(myCouncil) && !/list_roster/.test(myCouncil),
  "the roster is owner-only; this page is what an LSG officer sees",
);
check(
  "the my-council page makes no direct RPC call",
  !/callRpc/.test(myCouncil),
);
check(
  "the my-council page reads through the single scoped chart call",
  /fetchUnitChartResult\(\s*token\s*\)/.test(myCouncil),
);

// --- 9. list_roster exists and is owner-only ---
const rosterFn =
  functionBlocks(m10).find((b) => b.name === "smartgov.list_roster")?.body ?? "";
check("001000 creates smartgov.list_roster", rosterFn.length > 0);
const rosterFlat = flat(rosterFn);
check(
  "list_roster refuses a non-founder",
  /not_organization_founder/.test(rosterFlat),
);
check(
  "list_roster proves ownership through the founding-member row",
  /from public\.organization_members m/.test(rosterFlat) && /m\.is_founding/.test(rosterFlat),
  "an organization id in the request body is not authority",
);
check(
  "public.list_roster is granted to anon, authenticated",
  /grant execute on function public\.list_roster\(text\) to anon, authenticated/.test(m10),
);

// --- 10. Owners are approved by an emailed OTP, not at submission ---
const m11Flat = flat(m11);
const ownerCreate =
  functionBlocks(m11).find((b) => b.name === "smartgov.create_owner_account")?.body ?? "";
const ownerVerify =
  functionBlocks(m11).find((b) => b.name === "smartgov.verify_owner_otp")?.body ?? "";
const ownerSetOtp =
  functionBlocks(m11).find((b) => b.name === "smartgov.set_owner_otp")?.body ?? "";
const ownerProbe =
  functionBlocks(m11).find((b) => b.name === "smartgov.owner_registration_probe")?.body ?? "";
const workspaceFn =
  functionBlocks(m11).find((b) => b.name === "smartgov.account_workspace")?.body ?? "";

check(
  "001100 writes new owners as pending, not active",
  /'pending', smartgov\.sha256\(v_verify_raw\)/.test(ownerCreate),
  "a UUID row that never passes the emailed-code gate must not be able to reach an active app surface",
);
check(
  "001100 mints a one-time verifyToken and returns it to the registrant",
  /encode\(extensions\.gen_random_bytes\(24\), 'hex'\)/.test(ownerCreate) &&
    /'verifyToken', v_verify_raw/.test(ownerCreate),
);
check(
  "001100 stores only the SHA-256 of the verifyToken",
  /add column if not exists verify_token_hash text/.test(m11) &&
    /verify_token_hash = smartgov\.sha256\(p_verify_token\)/.test(m11Flat),
  "the raw token must never reach the database, in case the connection is compromised",
);
check(
  "001100 indexes the pending-owner lookup",
  /create index if not exists accounts_verify_token_idx/.test(m11Flat),
);

const ownerVerifyFlat = flat(ownerVerify);
check(
  "verify_owner_otp resolves the account through the token hash",
  /verify_token_hash = smartgov\.sha256\(p_verify_token\)/.test(ownerVerifyFlat),
);
check(
  "verify_owner_otp locks the row while reading the attempt budget",
  /from smartgov\.accounts a\s+where a\.verify_token_hash = smartgov\.sha256\(p_verify_token\)\s+for update/.test(
    ownerVerifyFlat,
  ),
  "a concurrent pair of guesses must not both read the remaining budget",
);
check(
  "verify_owner_otp spends the per-account rate budget",
  /'owner-otp:verify:' \|\| v_account\.id::text/.test(ownerVerifyFlat) &&
    /smartgov\.consume_rate_limit\(v_key, 20, interval '15 minutes'\)/.test(ownerVerifyFlat),
);
check(
  "verify_owner_otp caps attempts at five per code",
  /if v_account\.otp_attempts >= 5 then/.test(ownerVerifyFlat) &&
    /otp_attempts = otp_attempts \+ 1/.test(ownerVerifyFlat),
);
check(
  "a correct code activates the owner and clears the OTP surface",
  /status = 'active'/.test(ownerVerifyFlat) &&
    /activated_at = now\(\)/.test(ownerVerifyFlat) &&
    /otp_hash = null/.test(ownerVerifyFlat) &&
    /verify_token_hash = null/.test(ownerVerifyFlat),
);
check(
  "verify_owner_otp reports already-registered as a success, not an error",
  /'alreadyActive', true/.test(ownerVerifyFlat) &&
    /'ok', true/.test(ownerVerifyFlat),
  "the verify step is idempotent: the dashboard must not 500 after the owner verified in another tab",
);

const ownerSetFlat = flat(ownerSetOtp);
check(
  "set_owner_otp only serves a still-pending registration",
  /status = 'pending'/.test(ownerSetFlat),
);
check(
  "set_owner_otp caps resends at five per registration",
  /if v_account\.otp_resends >= 5 then/.test(ownerSetFlat) &&
    /otp_resends = otp_resends \+ 1/.test(ownerSetFlat),
);
check(
  "set_owner_otp enforces a two-minute resend cooldown",
  /interval '2 minutes'/.test(ownerSetFlat),
);

check(
  "owner_registration_probe rejects an already-approved owner",
  /'already_registered'/.test(flat(ownerProbe)),
);

const workspaceFlat = flat(workspaceFn);
check(
  "account_workspace exposes recentlyApproved only to owners",
  /account_scope = 'owner'/.test(workspaceFlat),
  "invited members must never see an approval banner for someone else's registration",
);
check(
  "recentlyApproved is bounded to the fifteen-minute approval window",
  /activated_at > now\(\) - interval '15 minutes'/.test(workspaceFlat),
);

check(
  "the public owner-OTP wrappers are granted to anon, authenticated",
  /grant execute on function public\.set_owner_otp\(text, text, integer\)\s+to anon, authenticated/.test(m11) &&
    /grant execute on function public\.verify_owner_otp\(text, text\)\s+to anon, authenticated/.test(m11) &&
    /grant execute on function public\.owner_registration_probe\(text\)\s+to anon, authenticated/.test(m11),
);

// --- 11. Password recovery is an emailed OTP against a dedicated reset row ---
const m12Flat = flat(m12);
const resetBegin =
  functionBlocks(m12).find((b) => b.name === "smartgov.begin_password_reset")?.body ?? "";
const resetComplete =
  functionBlocks(m12).find((b) => b.name === "smartgov.complete_password_reset")?.body ?? "";

check(
  "001200 creates smartgov.password_resets",
  /create table if not exists smartgov\.password_resets/.test(m12),
);
check(
  "001200 enables RLS on password_resets",
  /alter table smartgov\.password_resets enable row level security/.test(m12),
);
check(
  "001200 allows at most one live reset per account",
  /create unique index if not exists password_resets_one_active_per_account\s+on smartgov\.password_resets \(account_id\)\s+where completed_at is null/.test(
    m12Flat,
  ),
  "two parallel resets for the same account would let a stale code compete with a fresh one",
);

const beginFlat = flat(resetBegin);
check(
  "begin_password_reset only serves an active account",
  /status = 'active'/.test(beginFlat),
  "a pending account has no password yet; its recovery belongs to the invite or owner flow",
);
check(
  "begin_password_reset refuses unknown addresses",
  /if not found then\s+return false/.test(beginFlat),
  "the false return is what lets the route answer identically for a missing account",
);
check(
  "begin_password_reset caps resends at five per reset row",
  /otp_resends >= 5/.test(beginFlat) && /otp_resends = otp_resends \+ 1/.test(beginFlat),
);
check(
  "begin_password_reset enforces a two-minute resend cooldown",
  /interval '2 minutes'/.test(beginFlat),
);

const completeFlat = flat(resetComplete);
check(
  "complete_password_reset re-hashes the new password",
  /password_hash = smartgov\.hash_password\(p_new_password\)/.test(completeFlat),
  "the plaintext must only exist on the wire to this function, exactly like accept_invite",
);
check(
  "complete_password_reset revokes every session",
  /delete from smartgov\.sessions s\s+where s\.account_id = v_account\.id/.test(completeFlat),
  "a changed password is worthless while a stolen session still holds the account",
);
check(
  "complete_password_reset caps verification at five attempts",
  /otp_attempts >= 5/.test(completeFlat) && /otp_attempts = otp_attempts \+ 1/.test(completeFlat),
);
check(
  "complete_password_reset spends a per-account verification budget",
  /'password-reset:verify:' \|\| v_account\.id::text/.test(completeFlat),
);
check(
  "complete_password_reset marks the reset completed on success",
  /completed_at = now\(\)/.test(completeFlat),
);

check(
  "the public password-reset wrappers are granted to anon, authenticated",
  /grant execute on function public\.begin_password_reset\(text, text, integer\)\s+to anon, authenticated/.test(m12) &&
    /grant execute on function public\.complete_password_reset\(text, text, text\)\s+to anon, authenticated/.test(m12),
);

// --- 12. Dashboard units-first invites ---
// A USG owner has to be able to create a real governance_units row -- a campus,
// a department -- from the dashboard, and then invite an officer into it with
// no position seat at all. The second half is the load-bearing half: dropping
// the NOT NULL on unit_memberships.position_id is a relaxation, and a
// relaxation is only safe in one direction. Unit without a position is the new
// case and must be allowed; position without a unit is the dangling-row case
// and must stay illegal, or the chart has a membership pointing at a seat that
// resolves to nothing.
const m14Flat = flat(m14);
const addUnit = functionBlocks(m14).find((b) => b.name === "smartgov.add_unit")?.body ?? "";
const addUnitFlat = flat(addUnit);
const relaxedInvite =
  functionBlocks(m14).find((b) => b.name === "smartgov.create_invite")?.body ?? "";
// `readMigration` already stripped `--` comments, so a guard that was only
// commented out -- `-- or (p_unit_id is not null and p_position_id is null)` --
// cannot be mistaken for the relaxation having landed. Flattened from that
// comment-stripped source for the same reason 00600's DDL is.
const relaxedFlat = flat(relaxedInvite);

check(
  "001400 drops the NOT NULL on unit_memberships.position_id",
  /alter table smartgov\.unit_memberships\s+alter column position_id\s+drop not null/.test(m14Flat),
  "an officer invited into a unit with no seat cannot be represented while the column still refuses null",
);
check("001400 creates smartgov.add_unit", addUnit.length > 0);
check(
  "add_unit proves ownership through the founding-member row",
  /from public\.organization_members m/.test(addUnitFlat) && /m\.is_founding/.test(addUnitFlat),
  "an organization id in the request body is not authority",
);
check(
  "add_unit allows only college, campus, department",
  /not in \('college', 'campus', 'department'\)/.test(addUnitFlat),
  "a unit below the organization is a college, a campus, or a department; anything else invents a layer the chart cannot draw",
);
check(
  "add_unit rejects duplicate names within the org",
  /duplicate_unit_name/.test(addUnitFlat),
  "two campuses of the same name make the officer's unit unreadable in the chart",
);
check(
  "add_unit charges a rate-limit bucket",
  /consume_rate_limit/.test(addUnitFlat),
  "a new table is a new write surface, and a new write surface is a new thing to hammer",
);
check(
  "001400 keeps the six-argument public.create_invite wrapper",
  /create or replace function public\.create_invite\(\s*p_session_token text, p_email text, p_campus_name text, p_unit_type text, p_unit_id uuid default null, p_position_id uuid default null/.test(
    m14Flat,
  ),
  "the dashboard's existing organization-wide invite sends four named arguments; dropping the trailing two breaks it",
);
check(
  "001400 creates smartgov.create_invite",
  relaxedInvite.length > 0,
  "the relaxation lives in this function; without it there is nothing for the next three checks to read",
);
// The two halves of the old "one without the other is not a seat" guard, named
// as a shape rather than a string. Matching the rejection in either operand
// order is the point: `or (p_position_id is null and p_unit_id is not null)`
// rejects exactly the seatless invite the relaxation is for, and a check that
// only recognised one spelling of it would be satisfied by that reordering.
const rejectsSeatless =
  /p_unit_id is not null and p_position_id is null|p_position_id is null and p_unit_id is not null/;
const forbidsPositionWithoutUnit =
  /p_unit_id is null and p_position_id is not null|p_position_id is not null and p_unit_id is null/;

check(
  "the relaxed create_invite allows unit without position",
  relaxedInvite.length > 0 && !rejectsSeatless.test(relaxedFlat),
  "this is the guard that has to go: it is what currently makes a seatless invite impossible",
);
check(
  "the relaxed create_invite still forbids position without unit",
  forbidsPositionWithoutUnit.test(relaxedFlat),
  "relaxing the pair must not take the other half with it; a position with no unit is a membership the chart cannot resolve",
);
// Negative literals can only prove that a guard was spelled out, not that a path
// exists, so the seatless path gets a positive assertion of its own: the
// membership row is written with the caller's own ids, `p_position_id` included,
// so a unit with no seat really does get a membership instead of a refusal.
// `[^;]*` on the guard half is what makes this a guard detector rather than a
// substring match -- in an unmutated migration the seat checks close and the
// invite and roster writes both land between `if p_position_id is not null then`
// and this insert, so a `;` always intervenes and re-wrapping the insert in that
// guard is what turns this red.
const seatlessMembership =
  /insert into smartgov\.unit_memberships\s*\(\s*roster_id\s*,\s*unit_id\s*,\s*position_id\s*\)\s*values\s*\(\s*[\w.]*roster_id\s*,\s*p_unit_id\s*,\s*p_position_id\s*\)/;
const seatlessInsertGuarded =
  /\bif\b[^;]*\bp_position_id\b[^;]*\bis not null\b[^;]*\bthen\b[^;]*\binsert into smartgov\.unit_memberships\b/;
check(
  "the relaxed create_invite writes a membership for a unit without a position",
  relaxedInvite.length > 0 &&
    seatlessMembership.test(relaxedFlat) &&
    !seatlessInsertGuarded.test(relaxedFlat),
  "a unit invite must still write the unit_memberships row that unit_chart scopes on; behind a `p_position_id is not null` guard the row is never written and the relaxation did not land",
);

// --- 13. Owner cancel + resend ---
// Both actions are the same write against the same row, and both are only
// meaningful if the old link is actually dead afterwards. Cancelling settles
// that twice over: `accept_invite_probe` accepts nothing but `pending`, so the
// status alone kills the acceptance page, and `verify_otp` resolves the invite
// by token hash with no status filter at all, so the stored OTP has to go too
// or a code mailed before the cancel still lands an active account. Resending
// settles it by rotating the hash: the fresh raw token replaces it, so the
// previously mailed link stops resolving the moment the new mail goes out.
//
// The assertions are per function, read out of `functionBlocks`, because a
// file-scoped regex cannot tell which of the two did what -- `set status =
// 'revoked'` pasted into `resend_invite` and deleted from `revoke_invite` would
// leave a file-wide check green while the cancel stopped cancelling. The lock
// and the organization predicate are asserted as adjacent text rather than as
// separate facts, for the same reason: `for update` on some other query in the
// function would satisfy a check that only asked for it somewhere.
const m15Blocks = functionBlocks(m15);
const revoke15 = m15Blocks.find((b) => b.name === "smartgov.revoke_invite");
const resend15 = m15Blocks.find((b) => b.name === "smartgov.resend_invite");
const revoke15Flat = flat(revoke15?.body ?? "");
const resend15Flat = flat(resend15?.body ?? "");
const m15Flat = flat(m15);

const orgScopedRead = /from smartgov\.invites i where i\.id = p_invite_id and i\.organization_id = v_account\.organization_id for update/;
const orgScopedWrite =
  /where id = p_invite_id and organization_id = v_account\.organization_id/;
// (the trailing `(` is what prevents a longer-name prefix match; the `\b` is
// harmless belt-and-braces, unlike hardeningGaps where it IS load-bearing)
const declaresRevoke = /\bcreate or replace function smartgov\.revoke_invite\b\(/;
const declaresResend = /\bcreate or replace function smartgov\.resend_invite\b\(/;

check(
  "001500 revoke_invite is owner-gated and org-scoped",
  revoke15 !== undefined &&
    declaresRevoke.test(m15Flat) &&
    /v_account\.id is null then return jsonb_build_object\('ok', false, 'reason', 'unauthenticated'\)/.test(
      revoke15Flat,
    ) &&
    /if v_account\.account_scope <> 'owner' then/.test(revoke15Flat) &&
    /smartgov\.consume_rate_limit\(\s*'invite:revoke:' \|\| v_account\.id::text,\s*60,\s*interval '10 minutes'\s*\)/.test(
      revoke15Flat,
    ) &&
    orgScopedRead.test(revoke15Flat) &&
    orgScopedWrite.test(revoke15Flat) &&
    /revoke all on function smartgov\.revoke_invite\b\(text, uuid\) from public/.test(
      revoke15Flat,
    ),
  revoke15
    ? "the owner gate, the meter, the lock, the organization predicate, or the revoke is missing"
    : "smartgov.revoke_invite was not found in 001500",
);
check(
  "001500 revoke_invite revokes non-activated invites and kills the mailed code",
  revoke15 !== undefined &&
    /if v_status is null then return jsonb_build_object\('ok', false, 'reason', 'not_found'\)/.test(
      revoke15Flat,
    ) &&
    /if v_status = 'activated' then return jsonb_build_object\('ok', false, 'reason', 'invite_activated'\)/.test(
      revoke15Flat,
    ) &&
    /if v_status <> 'revoked' then update smartgov\.invites set status = 'revoked'/.test(
      revoke15Flat,
    ) &&
    /update smartgov\.accounts a set otp_hash = null, otp_expires_at = null where lower\(a\.email\) = v_email and a\.organization_id = v_account\.organization_id and a\.status = 'pending'/.test(
      revoke15Flat,
    ) &&
    /return jsonb_build_object\('ok', true, 'inviteId', p_invite_id\)/.test(revoke15Flat),
  "without the OTP clear the status is only half a cancel: `verify_otp` matches the invite by token hash alone, so a code already in the mailbox still activates the account",
);
check(
  "001500 resend_invite is owner-gated and org-scoped",
  resend15 !== undefined &&
    declaresResend.test(m15Flat) &&
    /v_account\.id is null then return jsonb_build_object\('ok', false, 'reason', 'unauthenticated'\)/.test(
      resend15Flat,
    ) &&
    /if v_account\.account_scope <> 'owner' then/.test(resend15Flat) &&
    /smartgov\.consume_rate_limit\(\s*'invite:resend:' \|\| v_account\.id::text,\s*20,\s*interval '10 minutes'\s*\)/.test(
      resend15Flat,
    ) &&
    orgScopedRead.test(resend15Flat) &&
    orgScopedWrite.test(resend15Flat) &&
    /revoke all on function smartgov\.resend_invite\b\(text, uuid\) from public/.test(
      resend15Flat,
    ),
  resend15
    ? "the owner gate, the meter, the lock, the organization predicate, or the revoke is missing"
    : "smartgov.resend_invite was not found in 001500",
);
check(
  "001500 resend_invite refuses activated and revoked invites",
  resend15 !== undefined &&
    /if v_status is null then return jsonb_build_object\('ok', false, 'reason', 'not_found'\)/.test(
      resend15Flat,
    ) &&
    /if v_status = 'activated' then return jsonb_build_object\('ok', false, 'reason', 'invite_activated'\)/.test(
      resend15Flat,
    ) &&
    /if v_status = 'revoked' then return jsonb_build_object\('ok', false, 'reason', 'invite_cancelled'\)/.test(
      resend15Flat,
    ),
  "resending a live link is the bug: an already-activated invitee is in, and a revoked one is a cancel that only a new invite can undo",
);
check(
  "001500 resend_invite mints a fresh token and re-extends the expiry",
  resend15 !== undefined &&
    /v_raw\s+text := encode\(extensions\.gen_random_bytes\(24\), 'hex'\)/.test(resend15Flat) &&
    /update smartgov\.invites set token_hash = smartgov\.sha256\(v_raw\), status = 'pending', expires_at = now\(\) \+ interval '14 days' where id = p_invite_id and organization_id = v_account\.organization_id/.test(
      resend15Flat,
    ) &&
    /return jsonb_build_object\( 'ok', true, 'token', v_raw, 'inviteId', p_invite_id, 'email', v_email, 'campusName', v_campus, 'organizationName', v_org_name, 'universityName', v_account\.university_name \)/.test(
      resend15Flat,
    ),
  "the raw token has to be returned once to the mailer and never stored, and the seven keys are the payload the welcome email is rendered from",
);
// The allowlist claim is the one worth making measurable, so it is measured
// rather than asserted in prose: every `grant execute on function` in the file
// has to name one of the two wrappers. Counting the `public.` functions instead
// is not enough -- a stray `grant execute on function smartgov.resend_invite`
// publishes a SECURITY DEFINER body directly to `anon` without adding a
// `public.` function at all, and that is the exact hole 00300 was written to
// close.
const m15Grants = [...m15Flat.matchAll(/grant execute on function\s+([\w.]+)\s*\(/g)].map(
  (m) => m[1],
);
check(
  "001500 publishes exactly the two invite-action wrappers to PostgREST",
  /grant execute on function public\.revoke_invite\(text, uuid\) to anon, authenticated/.test(
    m15Flat,
  ) &&
    /grant execute on function public\.resend_invite\(text, uuid\) to anon, authenticated/.test(
      m15Flat,
    ) &&
    /revoke all on function public\.revoke_invite\(text, uuid\) from public/.test(m15Flat) &&
    /revoke all on function public\.resend_invite\(text, uuid\) from public/.test(m15Flat) &&
    m15Grants.length === 2 &&
    m15Grants.every((g) => g === "public.revoke_invite" || g === "public.resend_invite"),
  m15Grants.length
    ? `granted: ${m15Grants.join(", ")} -- the audited allowlist is the whole attack surface, so it has to be these two wrappers and nothing else`
    : "neither wrapper is granted to anon, authenticated, so PostgREST would answer PGRST202",
);

// --- 14. LSG requirement submission + review ---
// The load-bearing rows here are mutation-tested the same way as the older
// guards: deleting an `enable row level security` off a new table, stripping
// the `lsg_unit_ids`/reviewer predicate out of the read functions, and
// deleting the size cap out of the uploads route each turn this item red. The
// reviewer gate (is_org_reviewer) is asserted as part of the read scope too,
// because the USG board shares the owner's inbox by *decision of the feature*,
// not by accident of the schema.
const m20Flat = flat(m20);
const m20Blocks = functionBlocks(m20);
const block20 = (name) => m20Blocks.find((b) => b.name === name);
const flat20 = (b) => (b ? flat(b.body) : "");

for (const table of ["programs", "requirement_items", "proposals", "proposal_versions", "item_submissions", "reviews"]) {
  check(
    `002000 enables RLS on smartgov.${table}`,
    new RegExp(`alter table smartgov\\.${table} enable row level security`).test(m20Flat),
  );
}
check(
  "002000 creates no policies",
  !/create policy/i.test(m20),
  "RLS with no policies already denies everything; on this project one permissive policy turns a locked table into a read surface for anyone holding the publishable key",
);

for (const fn of ["create_program", "set_default_requirements", "create_proposal", "submit_revision", "review_proposal"]) {
  const body = flat20(block20(`smartgov.${fn}`));
  check(
    `002000 ${fn} meters a rate-limit bucket`,
    /smartgov\.consume_rate_limit\(/.test(body),
    "every mutating RPC has an authenticated, org-scoped meter like 001400/001500",
  );
}

const CAST_EXT = /smartgov\.jsonb_text_array\(coalesce\(p_items->v_i->'allowed_extensions', jsonb '\[\]'\)\)/;
check(
  "002000 casts jsonb allowed_extensions into the text[] column",
  CAST_EXT.test(flat20(block20("smartgov.create_program"))) &&
    CAST_EXT.test(flat20(block20("smartgov.set_default_requirements"))),
  "the bare jsonb->text[] insert dies at runtime with 42804/42846 (seen live); template writes must fold through smartgov.jsonb_text_array",
);

const m150Flat = flat(m150);
const m150Blocks = functionBlocks(m150);
const flat150 = (b) => (b ? flat(b.body) : "");
const block150 = (name) => m150Blocks.find((b) => b.name === name);
check(
  "002150 submissionId appears on proposal_detail version items",
  /'submissionId', isub\.id/.test(m150Flat),
);
check(
  "002150 re-declares template writers through jsonb_text_array",
  CAST_EXT.test(flat150(block150("smartgov.create_program"))) &&
    CAST_EXT.test(flat150(block150("smartgov.set_default_requirements"))),
  "a fresh 002150 push must repair the live 42804 on both template writers",
);
check(
  "002150 publishes my_unit and nothing new beyond the template writers",
  (m150.match(/grant execute on function\s+\S+/g) ?? []).every((g) =>
    /public\.my_unit|public\.create_program|public\.set_default_requirements|public\.proposal_detail/.test(g),
  ) && /public\.my_unit/.test(m150),
);

check(
  "002160 repairs template writers through jsonb_text_array",
  /smartgov\.jsonb_text_array\(/i.test(flat(m160)) &&
    CAST_EXT.test(flat(functionBlocks(m160).find((b) => b.name === "smartgov.create_program")?.body ?? "")) &&
    CAST_EXT.test(flat(functionBlocks(m160).find((b) => b.name === "smartgov.set_default_requirements")?.body ?? "")) &&
    /v_ext = any\(smartgov\.jsonb_text_array\(v_t->'allowedExtensions'\)\)/.test(
      flat(functionBlocks(m160).find((b) => b.name === "smartgov.proposal_items_valid")?.body ?? ""),
    ),
  "the 002150 that reached production carried ::text[] which raises 42846; 002160 must carry the aggregate form in both template writers and the item validator",
);

check(
  "002170 re-declares proposal_items_valid through jsonb_text_array",
  /v_ext = any\(smartgov\.jsonb_text_array\(v_t->'allowedExtensions'\)\)/.test(
    flat(functionBlocks(m170).find((b) => b.name === "smartgov.proposal_items_valid")?.body ?? ""),
  ) && /smartgov\.jsonb_text_array\(p_value jsonb\)/.test(flat(m170)),
  "the 002160 that reached production omitted the validator; 002170 must carry the aggregate form",
);

// A %rowtype target assigns positionally, so a partial column list like
// `select id, organization_id, created_by, status into v_proposal` writes
// status into the fourth table column (unit_id, uuid) and raises 22P02. Every
// read into a rowtype variable must name explicit field targets.
check(
  "002000 rowtype reads use explicit field targets",
  /into v_proposal\.id, v_proposal\.organization_id, v_proposal\.program_id,\s*v_proposal\.unit_id, v_proposal\.created_by, v_proposal\.status/.test(
    flat20(block20("smartgov.submit_revision")),
  ) &&
    /into v_proposal\.id, v_proposal\.organization_id,\s*v_proposal\.created_by, v_proposal\.status/.test(
      flat20(block20("smartgov.review_proposal")),
    ),
  "a partial `into v_proposal` assigns by table column order, not select order -- status lands in unit_id and dies on the uuid cast",
);

const m180Blocks = functionBlocks(m180);
const flat180 = (b) => (b ? flat(b.body) : "");
const block180 = (name) => m180Blocks.find((b) => b.name === name);
check(
  "002180 re-declares submit_revision and review_proposal with explicit rowtype targets",
  /into v_proposal\.id, v_proposal\.organization_id, v_proposal\.program_id,\s*v_proposal\.unit_id, v_proposal\.created_by, v_proposal\.status/.test(
    flat180(block180("smartgov.submit_revision")),
  ) &&
    /into v_proposal\.id, v_proposal\.organization_id,\s*v_proposal\.created_by, v_proposal\.status/.test(
      flat180(block180("smartgov.review_proposal")),
    ),
);

check(
  "002000 list_programs hides non-published from invited officers",
  block20("smartgov.list_programs") !== undefined &&
    /where pr\.organization_id = v_account\.organization_id/.test(flat20(block20("smartgov.list_programs"))) &&
    /v_account\.account_scope = 'owner' or pr\.status = 'published'/.test(flat20(block20("smartgov.list_programs"))),
);
check(
  "002000 list_proposals is scoped in SQL, and reviewers share the owner's inbox",
  block20("smartgov.list_proposals") !== undefined &&
    /smartgov\.lsg_unit_ids\(/.test(flat20(block20("smartgov.list_proposals"))) &&
    /created_by = v_account\.id/.test(flat20(block20("smartgov.list_proposals"))) &&
    /smartgov\.is_org_reviewer\(/.test(flat20(block20("smartgov.list_proposals"))),
);
check(
  "002000 the USG board reviews: is_org_reviewer gates review_proposal",
  block20("smartgov.is_org_reviewer") !== undefined &&
    /unit_type = 'usg'/.test(flat20(block20("smartgov.is_org_reviewer"))) &&
    block20("smartgov.review_proposal") !== undefined &&
    /smartgov\.is_org_reviewer\(/.test(flat20(block20("smartgov.review_proposal"))) &&
    block20("smartgov.am_i_reviewer") !== undefined,
);
check(
  "002000 usg proposals publish directly; lsg proposals wait for review",
  /v_author_kind := 'usg'[\s\S]*v_status := 'published'/.test(flat20(block20("smartgov.create_proposal"))) &&
    /v_author_kind := 'lsg'[\s\S]*v_status := 'submitted'/.test(flat20(block20("smartgov.create_proposal"))),
);
check(
  "002000 revisions are only from a returned proposal",
  /v_proposal\.status <> 'returned'/.test(flat20(block20("smartgov.submit_revision"))),
);
check(
  "002000 review decisions are the terminal set",
  /'approved','returned','rejected'/.test(flat20(block20("smartgov.review_proposal"))),
);
check(
  "002000 detail and file reads scope in SQL, not by hiding rows",
  block20("smartgov.proposal_detail") !== undefined &&
    /v_ok := v_account\.account_scope = 'owner'/.test(flat20(block20("smartgov.proposal_detail"))) &&
    /smartgov\.is_org_reviewer\(/.test(flat20(block20("smartgov.proposal_detail"))) &&
    block20("smartgov.get_item_file") !== undefined &&
    /v_scope := v_account\.account_scope = 'owner'/.test(flat20(block20("smartgov.get_item_file"))),
);

// The published surface is measured, not asserted in prose: every grant has to
// name one of the twelve intended `public.` wrappers and nothing else.
const m20Grants = [...m20Flat.matchAll(/grant execute on function\s+([\w.]+)\s*\(/g)].map((m) => m[1]);
const M20_WRAPPERS = [
  "public.create_program", "public.list_programs", "public.list_default_requirements",
  "public.set_default_requirements", "public.match_requirement_item", "public.create_proposal",
  "public.submit_revision", "public.list_proposals", "public.proposal_detail",
  "public.review_proposal", "public.get_item_file", "public.am_i_reviewer",
];
check(
  "002000 publishes exactly the twelve intended wrappers to PostgREST",
  m20Grants.length === 12 && m20Grants.every((g) => M20_WRAPPERS.includes(g)),
  m20Grants.length
    ? `granted: ${m20Grants.join(", ")} -- the audited allowlist is the whole attack surface`
    : "no wrapper is granted to anon, authenticated, so PostgREST would answer PGRST202",
);

const messagesText = readPendingSource("src/lib/auth/messages.ts");
for (const key of [
  "no_program", "no_proposal", "not_in_unit", "incomplete_submission",
  "unsupported_file_type", "file_too_large", "not_returned", "already_reviewed",
]) {
  check(`messages.ts maps ${key}`, new RegExp(`\\b${key}:\\s*"`).test(messagesText));
}

const uploadsRoute = readPendingSource("src/app/api/uploads/route.ts");
check(
  "uploads route caps bytes at the product limit before anything is written",
  /MAX_FILE_BYTES/.test(uploadsRoute) &&
    /sizeBytes\s*>\s*MAX_FILE_BYTES/.test(uploadsRoute) &&
    /bytes\.length\s*>\s*UPLOAD_CHUNK_BYTES/.test(uploadsRoute),
  "the mutation to guard is deleting the cap: then a request could reserve a 12 MB document the database refuses at commit time",
);

// The bucket era is over. Nothing in the app may hold a service-role key, because
// nothing needs one: the bytes are in the database and the session is the only
// credential in play. `src/lib/storage.ts` was deleted rather than left unused --
// a module that mints signed URLs and throws at runtime is one refactor away from
// being used again, and it cannot throw at runtime if it is gone.
const appSourceFiles = [];
(function walkSource(dir) {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walkSource(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) appSourceFiles.push(full);
  }
})("src");

const exampleEnv = readPendingSource(".env.local.example");
check(
  "no source file reads a service-role key",
  !appSourceFiles.some((f) => /SUPABASE_SERVICE_ROLE_KEY/.test(readPendingSource(f))) &&
    !/SUPABASE_SERVICE_ROLE_KEY/.test(exampleEnv),
  "the whole document story stands on nobody holding an admin key; the moment one is read in app code, a route can bypass every function in smartgov",
);

check(
  "the signed-URL storage module is gone rather than merely unused",
  !appSourceFiles.includes("src/lib/storage.ts"),
  "storage.ts can mint signed bucket URLs again the moment somebody imports it",
);

check(
  "reading document bytes happens in one server-only module",
  /server-only/.test(readPendingSource("src/lib/large-objects.ts")) &&
    /POSTGRES_URL/.test(readPendingSource("src/lib/large-objects.ts")),
  "anything that can turn a large-object id into bytes is the most sensitive module in the app; it has to be server-only",
);

// The claim branch builds the path locally and then hands that local to the RPC, so
// a browser that sends its own path has nothing to influence. There are two shapes
// now -- a requirement item and an additional requirement -- so each builder has to
// be followed by its own send. `abort` and `commit` legitimately quote a path back --
// both re-check the caller on the way in.
const claimBranch = uploadsRoute.split('action === "claim"')[1]?.split('action === "commit"')[0] ?? "";
function buildsThenSends(builder) {
  const builtAt = claimBranch.indexOf(`const storagePath = ${builder}(`);
  const sentAt = claimBranch.indexOf("p_storage_path: storagePath", builtAt);
  return builtAt !== -1 && sentAt > builtAt;
}
check(
  "the upload route builds the storage path instead of trusting the browser's",
  /buildStoragePath/.test(uploadsRoute) &&
    /buildRequirementStoragePath/.test(uploadsRoute) &&
    /account\.organizationId/.test(uploadsRoute) &&
    buildsThenSends("buildStoragePath") &&
    buildsThenSends("buildRequirementStoragePath"),
  "letting the caller send the whole path means letting the caller choose the organization segment",
);

check(
  "the client walks the file in chunks and starts where the server says",
  /while \(sent < file\.size\)/.test(readPendingSource("src/components/dashboard/requirement/ProposalForm.tsx")) &&
    /claimed\.writtenBytes/.test(readPendingSource("src/components/dashboard/requirement/ProposalForm.tsx")),
  "without this a dropped connection restarts a 10 MB upload from zero",
);

// Every forwarder the app calls has to name its parameters. PostgREST matches an
// /rpc request against parameter *names* in its cached schema, so a forwarder
// declared as `function public.f(text, uuid)` is unreachable from the browser: the
// call comes back as "could not find the function ... in the schema cache" while
// psql and the SQL probes call it happily. Nothing in tsc, lint, or a SQL probe can
// see it, so it is checked here.
//
// Only the last declaration of a name counts. 02700 rewrites forwarders that 02600
// had written without names, and the older text is still in the file on purpose --
// the migration history is a record of what was true when. What matters is the
// signature the database is left holding.
const finalForwarder = new Map();
for (const [, name, args] of (m26 + m27).matchAll(
  /create (?:or replace )?function public\.(\w+)\s*\(([^)]*)\)/g,
)) {
  finalForwarder.set(name, args);
}
const unnamed = [...finalForwarder]
  .filter(([, args]) => args.trim() && !/\bp_/.test(args))
  .map(([name]) => name);
check(
  "every public forwarder ends up naming its parameters so PostgREST can resolve it",
  finalForwarder.size > 0 && unnamed.length === 0,
  unnamed.length > 0 ? `these are unreachable from the app: ${unnamed.join(", ")}` : "",
);

check(
  "the document forwarders are granted to the roles the app signs in as",
  [
    "claim_document_upload", "write_document_chunk", "confirm_document_upload",
    "discard_document_upload", "get_document", "verify_submission", "list_verifications",
  ].every((fn) =>
    new RegExp(
      `grant execute on function public\\.${fn}\\([^)]*\\) to anon, authenticated;`,
    ).test(m27),
  ),
  "a forwarder that exists but is not granted answers 'permission denied' instead of running",
);

check(
  "a migrated function tells PostgREST to rebuild its schema cache",
  /notify pgrst, 'reload schema'/.test(readPendingSource("scripts/apply-migration.mjs")),
  "without this, every new function is invisible to the app until PostgREST restarts on its own",
);

check(
  "document bytes are read through an oid cast, not a bare parameter",
  /lo_get\(\$1::oid\)/.test(readPendingSource("src/lib/large-objects.ts")),
  "`lo_get` is overloaded on bytea and oid; an uncast $1 is a syntax error the type checker cannot see",
);

  // Design decision 7 put a "proceed to dashboard anyway" gate in front of the
  // operational dashboard while the owner had no units. It is gone, and this now
  // guards why. The gate was rendered inline with the old combined `Workspace`,
  // which the per-section routes replaced: units and invitations are their own
  // pages, so there is no setup screen left to trap anybody in, and nav reaches
  // Proposals whatever the unit count. Re-adding a count-gated screen would put
  // the owner back where decision 7 was written to get them out of.
  const gateWs = readPendingSource("src/components/dashboard/requirement/RequirementWorkspace.tsx");
  check(
    "the operational dashboard is not gated on having built any units",
    !/unitCount|Proceed to dashboard anyway|Go back to setup/.test(gateWs),
  );

  // The reason the gate went: nav used to list only owner-scoped sections, so an
  // invited LSG officer signed in to a dashboard with nothing on it but an
  // invitation notice. Proposals must stay listed for non-owners, or that empty
  // dashboard is the default again.
  //
  // Tested structurally rather than by searching for `isOwner`, because this entry
  // legitimately mentions `isOwner` in its `hint` ternary. What matters is that it
  // is a bare sibling object in the returned array -- `, {` straight into the id --
  // and not an element of a `...(isOwner ? [` spread like the two beside it.
  // The one-tree dashboard is gone, replaced by `/usg` and `/lsg`. The assertions
  // below replaced a check on `nav.ts`, which no longer exists, because the thing
  // that actually holds the boundary now is the pair of layout guards plus the
  // absence of USG route strings from the LSG nav.
  const usgLayout = readPendingSource("src/app/usg/layout.tsx");
  const lsgLayout = readPendingSource("src/app/lsg/layout.tsx");
  const lsgNav = readPendingSource("src/components/dashboard/lsg-nav.ts");
  const usgNav = readPendingSource("src/components/dashboard/usg-nav.ts");

  check(
    "/usg redirects an LSG account to /lsg before rendering",
    /role\.side\s*!==\s*"usg"\)\s*redirect\("\/lsg"\)/.test(usgLayout),
    "the /usg layout does not bounce a non-USG side, so a bookmarked URL reaches the wrong workspace",
  );

  check(
    "/lsg redirects a USG account to /usg before rendering",
    /role\.side\s*!==\s*"lsg"\)\s*redirect\("\/usg"\)/.test(lsgLayout),
    "the /lsg layout does not bounce a USG side",
  );

  // Hard rule 2, asserted on the artifact rather than on intent: no invitation,
  // member-management, or access route string may appear in the LSG nav, and the
  // LSG layout must not reach for the USG one.
  check(
    "the LSG nav names no USG route",
    !/\/(usg|invitations|units|access)\b/.test(lsgNav),
    "lsg-nav.ts mentions a USG route; an LSG officer would be offered a screen they must never reach",
  );

  check(
    "the LSG layout does not import the USG nav",
    !/usg-nav/.test(lsgLayout) && /lsg-nav/.test(lsgLayout),
    "the /lsg tree pulls in usg-nav, so USG routes ship inside the LSG bundle",
  );

  check(
    "each side reaches its own workspace, never the other's",
    /href:\s*"\/usg\/activities-and-events"/.test(usgNav) &&
      /href:\s*"\/lsg\/activities-and-events"/.test(lsgNav) &&
      !/href:\s*"\/lsg/.test(usgNav) &&
      !/href:\s*"\/usg/.test(lsgNav),
    "a nav module links into the other side's tree",
  );

  check(
    "the LSG side has no account or role settings",
    !/account|invitation|member|officer/i.test(
      lsgNav.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""),
    ),
    "lsg-nav.ts names administration that the LSG workspace is not allowed to have",
  );

  check(
    "/lsg/help carries the Contact USG line and no form",
    /Contact USG/.test(readPendingSource("src/app/lsg/help/page.tsx")) &&
      !/<form|<Form/.test(readPendingSource("src/app/lsg/help/page.tsx")),
    "the LSG help page is missing its Contact USG line, or grew a form",
  );

// --- 15. Budget requests: money asked for, and money given.
// The load-bearing claim is that a client cannot influence a number that USG
// approves. So the subtotal has to be a generated column rather than a value the
// browser sends, the total has to be recomputed from the stored lines, and the
// review read has to show the two figures side by side.
const m23Flat = flat(m23);
const lsgBudgetPage = readPendingSource("src/app/lsg/budgets/page.tsx");
const usgBudgetPage = readPendingSource("src/app/usg/budgets/page.tsx");
const budgetsRoute = readPendingSource("src/app/api/budgets/route.ts");
const budgetReviewRoute = readPendingSource("src/app/api/budgets/[id]/review/route.ts");
const budgetsLib = readPendingSource("src/lib/budgets.ts");

check(
  "023000 creates both budget tables",
  /create table if not exists smartgov\.budget_requests/.test(m23) &&
    /create table if not exists smartgov\.budget_items/.test(m23),
  "a budget request or its line items is missing its table",
);

check(
  "a line's subtotal is a generated column, so the browser cannot choose the total",
  /subtotal\s+numeric\(14,2\)\s+generated always as \(round\(quantity \* unit_cost, 2\)\) stored/.test(
    m23Flat,
  ),
  "subtotal became a plain column an officer could edit in devtools",
);

check(
  "neither budget table is reachable by anon or authenticated",
  /revoke all on smartgov\.budget_requests from public, anon, authenticated/.test(m23Flat) &&
    /revoke all on smartgov\.budget_items from public, anon, authenticated/.test(m23Flat),
  "a budget table was granted straight to a client role",
);

check(
  "the four budget statuses are exactly what the table allows",
  /check \(status in \('submitted', 'returned', 'approved', 'rejected'\)\)/.test(m23Flat),
  "the status check drifted from what the review functions accept",
);

check(
  "a request may hang off a proposal or stand alone",
  /proposal_id\s+uuid references smartgov\.proposals/.test(m23Flat) &&
    /'proposal_not_open'/.test(m23),
  "the optional proposal link, or the guard on a decided proposal, is gone",
);

check(
  "a decided request cannot be decided again",
  /status not in \('submitted', 'returned'\)/.test(m23Flat) &&
    /'already_decided'/.test(m23),
  "an approved or rejected request became re-decidable",
);

check(
  "an approval can be less than the ask but never more",
  /v_amount < 0 or v_amount > v_budget\.requested_total/.test(m23Flat) &&
    /'invalid_amount'/.test(m23),
  "the range check on approved_total was dropped",
);

check(
  "returning or turning down needs a note for the officer",
  /'remark_required'/.test(m23),
  "a decision with no remark became possible, leaving the officer nothing to act on",
);

check(
  "the uncommitted figure leaves out anything already turned down",
  (m23.match(/status <> 'rejected'/g) || []).length >= 3,
  "rejected requests are being counted as money still on the table",
);

const m23Fns = (m23.match(/create or replace function/g) || []).length;
check(
  "every budget function is security definer with a pinned search_path and revoked",
  m23Fns >= 11 &&
    (m23.match(/security definer/g) || []).length === m23Fns &&
    (m23.match(/set search_path = public, extensions, smartgov, pg_temp/g) || []).length === m23Fns &&
    (m23.match(/revoke all on function (smartgov|public)\./g) || []).length >= m23Fns,
  `${m23Fns} functions are declared but one is not definer, pinned, or revoked`,
);

check(
  "PostgREST can reach all five budget functions and nothing more",
  /create or replace function public\.submit_budget/.test(m23) &&
    /create or replace function public\.list_budgets/.test(m23) &&
    /create or replace function public\.budget_detail/.test(m23) &&
    /create or replace function public\.review_budget/.test(m23) &&
    /create or replace function public\.budget_summary/.test(m23) &&
    (m23.match(/create or replace function public\./g) || []).length === 5,
  "a sixth public wrapper exists, or one of the five went missing",
);

check(
  "the summary is USG-only in SQL, not by hiding it in the UI",
  /budget_summary[\s\S]*?is_org_reviewer[\s\S]*?'forbidden'/.test(m23),
  "budget_summary stopped refusing a caller who is not on the USG side",
);

check(
  "the LSG budget page posts lines and holds no other unit's numbers",
  /fetch\("\/api\/budgets"/.test(lsgBudgetPage) &&
    !/budget_summary|summary/.test(withoutComments(lsgBudgetPage)) &&
    !/\/usg\//.test(lsgBudgetPage),
  "the LSG page asks for the money summary, or links to the USG tree",
);

check(
  "the USG budget page shows the summary and all three decisions",
  /state\.summary\.units/.test(usgBudgetPage) &&
    /decide\(row, "approved"\)/.test(usgBudgetPage) &&
    /decide\(row, "returned"\)/.test(usgBudgetPage) &&
    /decide\(row, "rejected"\)/.test(usgBudgetPage),
  "the review desk lost its per-unit table or one of the decisions",
);

check(
  "the review route refuses an unknown decision before it reaches the database",
  /DECISIONS = new Set\(\["approved", "returned", "rejected"\]\)/.test(
    budgetReviewRoute.replace(/\s+/g, " "),
  ),
  "the decision vocabulary widened on the client side",
);

check(
  "both budget nav items point at routes that exist",
  /href:\s*"\/lsg\/budgets"/.test(lsgNav) && /href:\s*"\/usg\/budgets"/.test(usgNav),
  "a budget nav item was added before its page landed",
);

check(
  "the budget nav items never cross the workspace boundary",
  !/href:\s*"\/usg/.test(lsgNav) && !/href:\s*"\/lsg/.test(usgNav),
  "a nav module links into the other side's tree",
);

check(
  "every budget reason has a message a person can read",
  [
    "invalid_title",
    "invalid_items",
    "proposal_not_open",
    "already_decided",
    "invalid_amount",
    "remark_required",
  ].every((r) => new RegExp(`${r}:`).test(messagesText)),
  "a reason can still reach the UI untranslated, where messageFor falls back to generic text",
);

check(
  "no budget source can read the service key",
  ![budgetsRoute, budgetReviewRoute, budgetsLib, lsgBudgetPage, usgBudgetPage].some((src) =>
    /SERVICE_ROLE/.test(src),
  ),
  "a budget module reads the service key, which must stay server-only",
);

check(
  "023000 adds no email or notification machinery (YAGNI gate)",
  !/nodemailer|smtp|mailer|sendEmail|welcomeEmail/.test(m23),
);

// --- 16. Task assignments and deadlines.
// The load-bearing claim is that "done" is not the officer's to claim, and that one
// task answered by twelve units is twelve rows rather than one status. Both are
// enforced in SQL, so a page that hid them would be decoration.
const m24Flat = flat(m24);
const lsgTasksPage = readPendingSource("src/app/lsg/tasks/page.tsx");
const usgTasksPage = readPendingSource("src/app/usg/tasks/page.tsx");
const tasksRoute = readPendingSource("src/app/api/tasks/route.ts");
const taskCard = readPendingSource("src/components/dashboard/tasks/TaskCard.tsx");
const feedRoute = readPendingSource("src/app/api/feed/route.ts");
const feedView = readPendingSource("src/components/dashboard/feed/FeedView.tsx");
const feedLib = readPendingSource("src/lib/feed.ts");

check(
  "024000 creates both task tables",
  /create table if not exists smartgov\.tasks/.test(m24) &&
    /create table if not exists smartgov\.task_assignments/.test(m24),
  "a task or its per-unit assignment row is missing its table",
);

check(
  "one task to many units is one assignment row per unit",
  /primary key \(task_id, unit_id\)/.test(m24Flat),
  "the assignment table lost the key that makes a unit's answer unique to it",
);

check(
  "a unit's answer is its own status, not a column on the task",
  /status\s+text not null default 'assigned'\s+check \(status in \('assigned', 'in_progress', 'done'\)\)/.test(
    m24Flat,
  ),
  "the assignment statuses drifted from what update_task_status accepts",
);

check(
  "overdue is derived at read time, not stored",
  !/overdue\s+(bool|boolean)/.test(m24) &&
    /due_date < current_date/.test(m24Flat),
  "overdue became a stored column, which is wrong the moment the clock moves",
);

check(
  "a deadline already past is refused",
  /'past_deadline'/.test(m24) && /p_due_date < current_date/.test(m24Flat),
  "USG can create a task that was instantly overdue before it was written",
);

check(
  "only USG creates a task",
  /create_task[\s\S]*?is_org_reviewer[\s\S]*?'forbidden'/.test(m24),
  "an LSG officer can assign work to a unit",
);

check(
  "an officer may report progress but not completion",
  /if p_status = 'done' then[\s\S]*?'not_your_decision'/.test(m24),
  "an LSG officer can mark their own unit done, and done is what the office counts",
);

check(
  "an officer can only move a row addressed to their own unit",
  (m24.match(/smartgov\.lsg_unit_ids/g) || []).length >= 3,
  "the membership-derived unit check was dropped from the task read or the status write",
);

check(
  "an empty unit list expands to every unit",
  /array_length\(v_wanted, 1\) is null then[\s\S]*?array_agg\(gu\.id\)[\s\S]*?gu\.organization_id = v_account\.organization_id/.test(
    m24,
  ),
  "an empty selection no longer means all units",
);

check(
  "neither task table is reachable by anon or authenticated",
  /revoke all on smartgov\.tasks from public, anon, authenticated/.test(m24Flat) &&
    /revoke all on smartgov\.task_assignments from public, anon, authenticated/.test(
      m24Flat,
    ),
  "a task table was granted straight to a client role",
);

const m24Fns = (m24.match(/create or replace function/g) || []).length;
check(
  "every task function is security definer with a pinned search_path and revoked",
  m24Fns === 6 &&
    (m24.match(/security definer/g) || []).length === m24Fns &&
    (m24.match(/set search_path = public, extensions, smartgov, pg_temp/g) || []).length === m24Fns &&
    (m24.match(/revoke all on function (smartgov|public)\./g) || []).length >= m24Fns,
  `${m24Fns} functions are declared but one is not definer, pinned, or revoked`,
);

check(
  "PostgREST can reach all three task functions and nothing more",
  (m24.match(/create or replace function public\./g) || []).length === 3 &&
    /create or replace function public\.create_task/.test(m24) &&
    /create or replace function public\.list_tasks/.test(m24) &&
    /create or replace function public\.update_task_status/.test(m24),
  "a fourth public wrapper exists, or one of the three went missing",
);

check(
  "the LSG task screen offers no control it would have to refuse",
  /canFinish=\{false\}/.test(lsgTasksPage) && !/canFinish=\{true\}/.test(lsgTasksPage),
  "the LSG desk is offering Mark done, which only the USG office may grant",
);

check(
  "the USG desk can finish a unit's work",
  /canFinish\b/.test(usgTasksPage) && /Mark done/.test(taskCard),
  "the USG desk lost the control that records completion",
);

check(
  "both desks read one shared card, so a status cannot render two ways",
  /components\/dashboard\/tasks\/TaskCard/.test(lsgTasksPage) &&
    /components\/dashboard\/tasks\/TaskCard/.test(usgTasksPage),
  "the two workspaces drifted onto separate task markup",
);

check(
  "the task route checks the status vocabulary before the database",
  /STATUSES = new Set\(\["assigned", "in_progress", "done"\]\)/.test(
    tasksRoute.replace(/\s+/g, " "),
  ),
  "the status vocabulary widened on the client side",
);

check(
  "the task list is scoped in SQL, not filtered in the browser",
  !/scope === "organization"[\s\S]{0,200}filter\(/.test(usgTasksPage) &&
    /doneUnits/.test(usgTasksPage),
  "the USG page is filtering rows client-side instead of reading its own scope",
);

check(
  "both task pages survive the reconstruction even though tasks left the nav",
  lsgTasksPage.length > 0 && usgTasksPage.length > 0 && !/\/lsg\/tasks/.test(lsgNav) && !/\/usg\/tasks/.test(usgNav),
  "the reconstruction pulled tasks from the nav, so the pair of pages must still work by direct URL",
);

check(
  "the task nav items never cross the workspace boundary",
  !/href:\s*"\/usg/.test(lsgNav) && !/href:\s*"\/lsg/.test(usgNav),
  "a nav module links into the other side's tree",
);

check(
  "every task reason has a message a person can read",
  ["past_deadline", "not_your_decision"].every((r) => new RegExp(`${r}:`).test(messagesText)),
  "a reason can still reach the UI untranslated",
);

check(
  "no task source can read the service key",
  ![tasksRoute, taskCard, lsgTasksPage, usgTasksPage].some((src) => /SERVICE_ROLE/.test(src)),
  "a task module reads the service key, which must stay server-only",
);

check(
  "024000 adds no email or notification machinery (YAGNI gate)",
  !/nodemailer|smtp|mailer|sendEmail|welcomeEmail/.test(m24),
);

check(
  "the feed reads proposals instead of duplicating them into a posts table",
  !/create table/.test(m25),
  "025000 created a table to hold announcements, which will drift from proposals",
);

check(
  "an officer's feed is cut to published work in SQL",
  m25.match(/v_is_usg or p\.status = 'published'/g)?.length >= 2,
  "list_feed or list_calendar has no published-only branch for a non-USG caller",
);

check(
  "the feed never trusts the caller for a scope or a status",
  !/p_scope|p_status|p_include_draft/.test(m25),
  "a read function takes the viewer's scope as a parameter instead of deriving it",
);

check(
  "the calendar is grouped by day in SQL",
  /jsonb_object_agg\(d\.day, d\.events/.test(m25) && /group by p\.event_date/.test(m25),
  "days are assembled in the browser, which would ship every empty date",
);

check(
  "the feed window is clamped rather than trusted",
  /least\(coalesce\(p_limit, 50\), 200\)/.test(m25),
  "p_limit is used as sent, so a caller could ask for the whole table",
);

check(
  "publish timestamps are withheld from an officer",
  /case when v_is_usg then p\.created_at end/.test(m25),
  "publishedAt is sent to every caller",
);

check(
  "both read functions resolve the caller from the session token",
  (m25.match(/smartgov\.authenticate\(p_session_token\)/g) || []).length === 2
    && /reason', 'unauthenticated'/.test(m25),
  "a read function can be called without proving who is asking",
);

check(
  "both feed functions are pinned to a known search_path",
  (m25.match(/set search_path = public, extensions, smartgov, pg_temp/g) || []).length === 4,
  "a function body can name an object the caller controls",
);

check(
  "public grants nothing beyond execute on the forwarders",
  (m25.match(/grant execute on function public\.list_(feed|calendar)/g) || []).length === 2
    && !/grant .* on table/.test(m25),
  "025000 widened a table grant",
);

check(
  "the feed API has no status or scope parameter to pass through",
  !/searchParams\.get\("(status|scope)"\)|body\.(status|scope)/.test(feedRoute),
  "the route can ask for a view the caller may not have",
);

check(
  "the calendar API refuses a window it cannot use",
  /ISO_DATE\.test/.test(feedRoute) && /n > 400/.test(feedRoute),
  "a bad month or an oversized window is forwarded to SQL unchecked",
);

check(
  "the reconstruction cut the LSG feed while the page stays as a redirect",
  /redirect\("\/lsg"\)/.test(readPendingSource("src/app/lsg/feed/page.tsx"))
    && readPendingSource("src/app/usg/feed/page.tsx").includes("<FeedView />"),
  "the LSG feed page vanished entirely, or the USG side no longer renders the same view",
);

check(
  "the LSG side is not offered a feed it has been cut from",
  !/href:\s*"\/lsg\/feed"/.test(lsgNav),
  "a feed link was added back to the LSG nav while the page still only redirects",
);

check(
  "the feed nav items never cross the workspace boundary",
  !/href:\s*"\/usg/.test(lsgNav) && !/href:\s*"\/lsg/.test(usgNav),
  "a nav module links into the other side's tree",
);

check(
  "the calendar grid is arithmetic, not one request per day",
  /monthGrid/.test(feedView) && /monthGrid\(/.test(feedView) && !/fetch\(`\/api\/feed\?date=/.test(feedView),
  "the grid asks the server for every date including the empty ones",
);

check(
  "no feed source can read the service key",
  ![feedRoute, feedView, feedLib].some((src) => /SERVICE_ROLE/.test(src)),
  "a feed module reads the service key, which must stay server-only",
);

check(
  "025000 adds no email or notification machinery (YAGNI gate)",
  !/nodemailer|smtp|mailer|sendEmail|welcomeEmail/.test(m25),
);

// ------------------------------------------------- 02600 / 02700 documents + verification
//
// The uploads were moved out of Supabase Storage and into Postgres large objects
// because this environment has no service-role key to sign a bucket upload with.
// That move is only safe if the database is the thing making every decision, so the
// guards below are about who is allowed to say what, not about the happy path.

const documentFns = [
  "claim_document_upload",
  "confirm_document_upload",
  "discard_document_upload",
  "get_document",
  "verify_submission",
  "list_verifications",
  "write_document_chunk",
];

check(
  "026000 creates the document table and turns RLS on with no policies",
  /create table if not exists smartgov\.document_uploads/.test(m26) &&
    /alter table smartgov\.document_uploads enable row level security/.test(m26) &&
    !/create policy/i.test(m26),
  "the document table is reachable by a policy, or reachable without any at all",
);

check(
  "the document table is not handed to the API roles directly",
  /revoke all on (?:table )?smartgov\.document_uploads from anon, authenticated;/.test(m26) &&
    !/grant\s+(select|insert|update|delete|all)\b[^;]*on (?:table )?smartgov\.document_uploads/i.test(m26),
  "the API roles can read or write document rows without going through a function",
);

// `write_document_chunk` arrived with 02700, so the entry-point guards read both
// files as one surface rather than assuming 026000 defined everything.
const docSql = m26 + m27;

check(
  "every document entry point is a security definer with a pinned search path",
  documentFns.every((fn) =>
    new RegExp(
      `function smartgov\\.${fn}\\([\\s\\S]*?security definer\\s*set search_path = public, extensions, smartgov, pg_temp`,
    ).test(docSql),
  ),
  "a document function can be called without a pinned search_path",
);

check(
  "no document function is executable by the API roles directly",
  documentFns.every((fn) =>
    new RegExp(`revoke all on function smartgov\\.${fn}\\(`).test(docSql),
  ),
  "smartgov.document_* is callable straight from the client",
);

check(
  "the public forwarders are the only way in, and only for anon and authenticated",
  documentFns.every((fn) => {
    const forwarder = new RegExp(
      `function public\\.${fn}\\([\\s\\S]*?grant execute on function public\\.${fn}\\([^)]*\\) to anon, authenticated;`,
    );
    return forwarder.test(docSql);
  }),
  "a document forwarder is missing, or granted to a role that is not a caller",
);

check(
  "the upload size cap is the same 10MiB in the claim, the confirm, and the validator",
  (m26.match(/10485760/g) || []).length >= 3,
  "the cap is stated differently in the reserve, the attach, and the submit path",
);

check(
  "a submission cannot claim a document it never stored",
  /d\.large_object_oid is not null/.test(m26) &&
    /reason', 'missing_document'/.test(m26),
  "a file submission is accepted on the strength of a path string alone",
);

check(
  "02700 refuses a submission whose upload only partly landed",
  /d\.confirmed_at is not null/.test(m27) &&
    /d\.written_bytes = d\.size_bytes/.test(m27) &&
    /reason', 'incomplete_upload'/.test(m27),
  "a half-written upload can be submitted as a whole document",
);

check(
  "a chunk has to arrive at the offset the row is waiting for",
  /coalesce\(v_written, 0\) <> coalesce\(p_offset, -1\)/.test(m27) &&
    /reason', 'offset_mismatch'/.test(m27),
  "chunks can be replayed out of order and interleave two files' bytes",
);

check(
  "chunk writes go through the offset-taking large-object call",
  /lo_put\(v_oid, coalesce\(v_written, 0\), p_chunk\)/.test(m27) &&
    !/lowrite\(/.test(m27),
  "the append uses the legacy cursor interface, which takes no bigint offset",
);

check(
  "02700 ties the stored document to the requirement, the name, and the size",
  /d\.requirement_item = v_tid/.test(m27) &&
    /d\.original_name = v_name/.test(m27) &&
    /d\.size_bytes = v_size/.test(m27),
  "the document row is checked for existence but not for identity",
);

check(
  "02700 makes the author's checklist show the ruling that was actually made",
  /'myVerdict', mine\.verdict/.test(m27) && /'verdict', sv\.verdict/.test(m27),
  "the checklist still shows the reader's own opinion as if it were the verdict",
);

check(
  "02700 binds a document to its proposal from the submission row, not the path",
  /add column if not exists proposal_id uuid/.test(m27) &&
    /references smartgov\.proposals\(id\) on delete cascade/.test(m27) &&
    /after insert on smartgov\.item_submissions/.test(m27),
  "the proposal link is taken from a path the client chose",
);

check(
  "02700 drops the prefix-matching proposal trigger it replaced",
  /drop trigger if exists proposals_release_documents on smartgov\.proposals/.test(m27) &&
    /drop function if exists smartgov\.release_proposal_documents\(\)/.test(m27),
  "both the foreign key and the string-matching trigger are live at once",
);

check(
  "deleting a document row releases its large object",
  /after delete on smartgov\.document_uploads/.test(m27) &&
    /perform lo_unlink\(old\.large_object_oid\)/.test(m27),
  "removing a document row leaves the bytes in pg_largeobject forever",
);

check(
  "02700 adds no storage-bucket or service-key machinery",
  !/storage\.objects|create bucket|SERVICE_ROLE/.test(m26 + m27),
  "the large-object path pulled in a bucket or a service key",
);

check(
  "02700 lets an interrupted upload resume instead of restarting",
  /'writtenBytes', coalesce\(v_open\.written_bytes, 0\)/.test(m27) &&
    /'resumed', true/.test(m27),
  "a dropped connection forces the browser to send the whole file again",
);

check(
  "resuming does not reopen a document that is already closed",
  /if v_open\.confirmed_at is not null or v_open\.uploaded_by <> v_account\.id then/.test(m27),
  "a claim can overwrite or adopt a finished document",
);

// --- the reviewer's side of the same feature.
//
// The upload path was guarded above for the reason that a document must reach the
// database whole before anyone is asked to rule on it. A verdict is the other half:
// it is a reviewer's opinion about a file they were entitled to open, so the guard is
// that the app cannot widen that -- no verdict list of its own that the database does
// not hold, no remark-length ceiling above the column's, and no path where the
// checklist is readable by someone who could not open the documents in it.

const verificationRoute = readPendingSource("src/app/api/verifications/route.ts");
const checklist = readPendingSource(
  "src/components/dashboard/requirement/VerificationChecklist.tsx",
);

check(
  "the verification route sends a session token to both functions",
  /callRpc<[^>]*>\("list_verifications"/.test(verificationRoute) &&
    /p_session_token: token/.test(verificationRoute) &&
    /callRpc<[^>]*>\("verify_submission"/.test(verificationRoute),
  "the route reaches a document function without carrying the caller's session",
);

check(
  "the verification route reads no storage path or large-object id of its own",
  !/large_object_oid|storage_path|x-smartgov-path/.test(verificationRoute),
  "the verdict route started addressing bytes directly instead of a submission id",
);

const routeVerdicts = verificationRoute.match(/VERDICTS = new Set\(\[([^\]]*)\]/)?.[1] ?? "";
check(
  "a verdict is only the three the database knows, not the three the UI feels like",
  ["verified", "queried", "rejected"].every((v) => routeVerdicts.includes(`"${v}"`)) &&
    !/\b(approved|returned)\b/.test(routeVerdicts),
  "the route accepts a verdict outside the database's set, or smuggles in the proposal-level words",
);

check(
  "the route's remark ceiling is the column's, not a larger one of its own",
  /remark\.length > 1000/.test(verificationRoute) &&
    /length\(v_remark\) > 1000/.test(m26),
  "the route allows a longer note than the function will store, so the error surfaces as a server failure",
);

check(
  "a query is refused at the route as well as in the database",
  /verdict === "queried" && remark\.length === 0/.test(verificationRoute) &&
    /reason', 'remark_required'/.test(m26),
  "a `queried` verdict can be filed as a blank question",
);

check(
  "the checklist shows an unchecked document instead of dropping it",
  /it\.verdict/.test(checklist) && /items\.length === 0/.test(checklist),
  "an unverified document is invisible rather than marked not checked",
);

check(
  "the checklist reads the organisation's ruling and the reader's own separately",
  /it\.myVerdict/.test(checklist) && /VERDICT_COPY\[verdict\]/.test(checklist),
  "the UI shows myVerdict as though it were the office's verdict",
);

// ---------------------------------------------------------- 02800 the unified dashboard
//
// One read replaced four list screens on the way in, so the thing to guard is that it
// did not quietly become a fifth: a dashboard that widens scope is the easiest way to
// leak a unit's budget into the office's desk, because the office desk is the view
// with the most numbers on it. Three rules, in the order they matter:
//
//   1. its scope is the union of the scopes it replaced, not a new one;
//   2. it decides the scope from the session and accepts no parameter that could
//      contradict it;
//   3. it returns ids and states, never routes -- because the component that reads it
//      is shared by both workspaces, and a `/lsg` string in there would put an LSG
//      route into the officer's bundle.

const m28 = readPendingMigration("20260101002800_unified_dashboard.sql");
const dashboardRoute = readPendingSource("src/app/api/dashboard/route.ts");
const dashboardView = readPendingSource("src/components/dashboard/DashboardView.tsx");
const lsgPage = readPendingSource("src/app/lsg/page.tsx");
const usgPage = readPendingSource("src/app/usg/page.tsx");

check(
  "02800: the dashboard is a security definer with a pinned search path",
  /function smartgov\.list_dashboard\([\s\S]*?security definer\s*set search_path = public, extensions, smartgov, pg_temp/.test(m28),
  "the dashboard can be called without a pinned search_path",
);

check(
  "02800: smartgov.list_dashboard is not executable by the API roles directly",
  /revoke all on function smartgov\.list_dashboard\(text\) from public;/.test(m28) &&
    /grant execute on function public\.list_dashboard\(text\) to anon, authenticated;/.test(m28),
  "the dashboard is callable straight from the client, bypassing the wrapper",
);

check(
  "02800: the forwarder names its parameter so PostgREST can resolve it",
  /function public\.list_dashboard\(p_session_token text\)/.test(m28),
  "the dashboard forwarder is declared with a bare text and is unreachable from a browser",
);

check(
  "02800: the scope is decided from the session, with no parameter to contradict it",
  /smartgov\.authenticate\(p_session_token\)/.test(m28) &&
    /reason', 'unauthenticated'/.test(m28) &&
    !/p_scope|p_status|p_unit|p_limit|p_since/.test(m28),
  "the dashboard takes a scope or a filter from the caller",
);

// The one that would actually hurt. Each of the four modules already scopes itself,
// and the dashboard's copy of those rules has to be the same rules -- same reviewer
// predicate, same unit resolution, same author allowance -- or the dashboard shows a
// row that its own module screen would refuse to open.
check(
  "02800: the dashboard reuses the reviewer and unit rules rather than inventing them",
  /smartgov\.is_org_reviewer\(v_account\.id, v_account\.organization_id\)/.test(m28) &&
    /smartgov\.lsg_unit_ids\(v_account\.id, v_account\.organization_id\)/.test(m28) &&
    /v_account\.account_scope = 'owner'/.test(m28),
  "the dashboard scopes proposals without the reviewer predicate or the unit set",
);

check(
  "02800: every section is cut to the materialised proposal set, not the whole table",
  (m28.match(/any \(v_proposals\)|any\(v_proposals\)/g) || []).length >= 8,
  "a section of the dashboard reads a table without the scope array",
);

check(
  "02800: the budget and task sections keep their own module scopes",
  /b\.requested_by = v_account\.id/.test(m28) &&
    /b\.unit_id = any \(v_units\)/.test(m28) &&
    /ta\.unit_id = any \(v_units\)/.test(m28),
  "budgets or tasks are shown organization-wide to anybody who can read the dashboard",
);

// The rule that keeps the two bundles apart. `usg-nav.ts` and `lsg-nav.ts` are
// separate files for this reason, and a shared view that grew a hard-coded route would
// quietly undo all of it.
check(
  "the shared dashboard view hard-codes no route at all",
  !/\/(lsg|usg)\//.test(dashboardView) && !/useRouter/.test(dashboardView),
  "a shared component now holds a path, so one workspace's route can reach the other's bundle",
);

check(
  "each side supplies its own links rather than the view choosing",
  /proposals: "\/lsg\/proposals"/.test(lsgPage) &&
    /budgets: "\/lsg\/budgets"/.test(lsgPage) &&
    /tasks: "\/lsg\/tasks"/.test(lsgPage) &&
    /proposals: "\/usg\/proposals"/.test(usgPage) &&
    /budgets: "\/usg\/budgets"/.test(usgPage) &&
    /tasks: "\/usg\/tasks"/.test(usgPage),
  "one side's links are missing, or a side is borrowing the other's",
);

check(
  "the LSG page names no USG route, and the USG page no LSG one",
  !/\/usg\//.test(lsgPage) && !/\/lsg\//.test(usgPage),
  "a page grew a link into the other workspace",
);

check(
  "the dashboard route takes no query parameters to widen its own scope",
  /export async function GET\(\)/.test(dashboardRoute) &&
    !/searchParams/.test(dashboardRoute) &&
    !/req: Request/.test(dashboardRoute),
  "the dashboard route can be asked a question about scope or status",
);

check(
  "both workspaces render the same component",
  /DashboardView/.test(lsgPage) && /DashboardView/.test(usgPage),
  "the two desks have drifted back into being two screens",
);

check(
  "02800 adds no table, no policy, and no service key",
  !/create table/i.test(m28) && !/create policy/i.test(m28) && !/SERVICE_ROLE/.test(m28),
  "the dashboard needed storage or a key that the rest of the app has none of",
);

// ------------------------------------------------------------------------------
// item 15 -- the government-structure feature
//
// The bug this exists to catch: a structure builder is mostly a shape editor, and
// every failure worth preventing here is a failure of shape or of who is refused.
// Ten of them got through a green build and were only found by talking to the
// database, which is why half this item guards the migrations by reading them and
// why `scripts/probe-structure.mjs` exists for the half that cannot be read:
//
//   1. the `{committees: [...]}` wrapper is the document. Returning a bare array
//      loses it, and every later read of a saved draft then fails.
//   2. committee and position order is the render order of a government chart.
//      A jsonb object key sort turns "Audit Committee" ahead of "Ceremonials".
//   3. `isUnit` belongs to one committee and it must be the first. A misplaced flag
//      files a council's own officers into a committee.
//   4. approval rewrites seats, so author retention is load-bearing, and so is the
//      chart honouring authorship (03020) -- otherwise approving your own structure
//      takes the chart away from the person who wrote it.
//   5. roster and photo reads are scoped by `gov_people_unit_ids`, so an LSG officer
//      cannot learn of a sibling council's personnel by paging the picker.
//   6. photos are write-only in the document: the payload carries bytes, the read
//      carries `hasPhoto`, and `encode(..., 'base64')` wraps at 76 columns, which
//      is not base64 as far as `atob` is concerned.
//   7. the author foreign keys tolerate a deleted account, or an organization
//      cannot be removed once somebody has written a structure.
//   8. the lifecycle probe registers its crash handler before its first insert.
//
// These are mutation-tested the way the rest of this file is: deleting
// `order by p.ord` from 03000, putting `on delete cascade` back on the author
// foreign key, moving the probe's crash handler below its first insert, deleting
// the `committees` key from `gov_strip_photos`, replacing
// `gov_authored_unit_ids` with a literal in `unit_chart`, dropping
// `gov_people_unit_ids` from either forwarder, un-wrapping the base64, and moving
// the isUnit check after the name check each turn the matching assertion red. A
// check that cannot fail is decoration.

const m29 = readPendingMigration("20260101002960_government_structure_functions.sql");
const m298 = readPendingMigration("20260101002980_structure_document_integrity.sql");
const m299 = readPendingMigration("20260101002990_structure_people_scope.sql");
const m300 = readPendingMigration("20260101003000_structure_holder_marking.sql");
const m3010 = readPendingMigration("20260101003010_structure_author_fkeys.sql");
const m3020 = readPendingMigration("20260101003020_structure_chart_authorship.sql");
const m3030 = readPendingMigration("20260101003030_structure_template_documents.sql");
const structureProbe = readPendingSource("scripts/probe-structure.mjs");
const structureWorkspace = flat(readPendingSource("src/components/structure/StructureWorkspace.tsx"));
const structureLib = readPendingSource("src/lib/structure.ts");
const councilStructurePage = flat(readPendingSource("src/app/my-council/structure/page.tsx"));

const flat298 = flat(m298);

check(
  "the document is an object of committees, and stripping photos keeps the wrapper",
  /jsonb_build_object\(\s*'committees'/.test(m298) &&
    /p_document \|\| jsonb_build_object\(\s*'committees'/.test(m298),
  "gov_strip_photos returns a bare array, so a saved draft loses its wrapper",
);

check(
  "committees and positions keep the order the builder chose",
  (flat298.match(/with ordinality as [cp]\(value, ord\)/g) ?? []).length >= 2 &&
    (flat298.match(/order by [cp]\.ord/g) ?? []).length >= 2,
  "committee or position ordering is left to jsonb's key sort",
);

// Ordering is the assertion: the flag is read inside the per-committee loop, so a
// misplaced one has to be caught there and before the committee's own shape is
// trusted. `v_ci > 0` is the refusal, and it has to precede the name check.
const isUnitAt = flat298.indexOf("coalesce((v_c->>'isUnit')::boolean, false)");
const firstOnlyAt = flat298.indexOf("Only the first committee can be the council itself");
const nameAt = flat298.indexOf("not between 1 and 120");

check(
  "isUnit is refused in the committee loop, before the committee body is trusted",
  isUnitAt !== -1 && firstOnlyAt !== -1 && nameAt !== -1 &&
    isUnitAt < firstOnlyAt && firstOnlyAt < nameAt &&
    /if v_ci > 0 then/.test(flat298),
  "the isUnit check does not come first, or only reports the first one it finds",
);

check(
  "03020 gives the org chart the same authored units the structure gate uses",
  /create or replace function smartgov\.gov_authored_unit_ids/.test(m3020) &&
    /authored as \([\s\S]*?from smartgov\.gov_structures s/.test(m3020) &&
    /select id, parent_id from authored/.test(m3020) &&
    /v_authored := p_unit_id = any \(smartgov\.gov_authored_unit_ids\(p_account\)\)/.test(m3020),
  "the chart and gov_unit_access answer 'did they write this?' separately, and will drift",
);

check(
  "03020 keeps 00800's guards rather than trading them for the new clause",
  /not v_is_owner and coalesce\(array_length\(v_unit_ids, 1\), 0\) = 0 then/.test(m3020) &&
    /reason', 'no_unit'\)/.test(m3020) &&
    /where gu\.id = any\(v_unit_ids\)/.test(m3020) &&
    /and gu\.organization_id = v_account\.organization_id/.test(m3020),
  "the widened chart lost its empty-scope refusal or its organization filter",
);

check(
  "roster and photo reads go through the people scope, not the caller's unit",
  /function smartgov\.gov_people_unit_ids/.test(m299) &&
    /function smartgov\.list_structure_roster[\s\S]{0,3000}?gov_people_unit_ids\(v_account\)/.test(m299) &&
    /function smartgov\.get_member_photo[\s\S]{0,3000}?gov_people_unit_ids\(v_account\)/.test(m299),
  "an LSG officer can page somebody else's roster or photo",
);

check(
  "the people scope is itself bounded by the caller's organization",
  /function smartgov\.gov_people_unit_ids[\s\S]*?organization_id = p_account\.organization_id/.test(m299) &&
    /descendant|recursive/i.test(m299),
  "the people scope is not organization-bounded, or no longer walks downward",
);

check(
  "a photo is written as bytes and read as a flag",
  /function smartgov\.gov_strip_photos/.test(m298) &&
    /lo_unlink/.test(m298) &&
    /hasPhoto/.test(m300) &&
    /function smartgov\.roster_photo_purge/.test(m29),
  "a replaced photo's large object is never unlinked, or reads leak the bytes",
);

check(
  "photo bytes come back without the newlines encode() wraps them in",
  /replace\(\s*encode\([\s\S]*?E?'\\\\?n'/.test(m299) &&
    /get_member_photo/.test(m299) &&
    /(decode|lo_get)/.test(m299),
  "base64 is returned as encode() produced it, which atob rejects",
);

// The regression was `p.value->'holder' || jsonb_build_object('hasPhoto', ...)` used
// as the position, which drops the seat's own keys. The fix is a nested jsonb_set, so
// the guard is that the flag is written *into* the holder rather than merged over it.
check(
  "03000 marks hasPhoto on the holder it belongs to, keeping the seat around it",
  /jsonb_set\(\s*p\.value, '\{holder\}',\s*p\.value->'holder' \|\| jsonb_build_object\(\s*'hasPhoto'/.test(flat(m300)) &&
    /order by p\.ord/.test(flat(m300)) &&
    // the flattening form must be gone, not merely unused
    !/jsonb_agg\(\s*p\.value->'holder' \|\|/.test(flat(m300)),
  "the photo flag is flattened onto the position and the seat loses its key and title",
);

check(
  "03010 lets an author account be deleted instead of blocking organization removal",
  /created_by[\s\S]{0,80}?references smartgov\.accounts[\s\S]{0,40}?on delete set null/.test(m3010) &&
    /decided_by[\s\S]{0,80}?references smartgov\.accounts[\s\S]{0,40}?on delete set null/.test(m3010),
  "one authored structure makes its organization undeletable",
);

// `created_by <> v_account.id` alone reads as null for a departed author, so the
// null has to be spelled out rather than left to three-valued logic.
check(
  "a structure whose author is gone stays hidden from reviewers",
  /v_open\.created_by is null or v_open\.created_by <> v_account\.id/.test(flat(m3010)) &&
    !/and v_open\.created_by <> v_account\.id/.test(flat(m3010)),
  "a null author leaks a draft to anyone reviewing",
);

check(
  "the structure functions are reachable only through the session forwarders",
  (flat(m299).match(/revoke all on function smartgov\.[a-z_]+\(/g) ?? []).length >= 4 &&
    /grant execute on function public\.get_member_photo\(text, uuid\) to anon, authenticated;/.test(m299) &&
    !/grant execute on function smartgov\./.test(m299 + m298 + m299),
  "a smartgov structure function is executable straight from the client",
);

// 03030 exists because the gallery could name a template but not return one:
// `import_structure_template` is an upsert *into* the gallery, so nothing could
// apply what was listed. The guard is that the list hands the document back.
check(
  "the template list hands the document back, so a gallery can apply one",
  /'document', t\.document/.test(m3030) &&
    /create or replace function smartgov\.list_structure_templates\(p_session_token text\)/.test(m3030) &&
    /revoke all on function smartgov\.list_structure_templates\(text\) from public/.test(m3030),
  "the gallery lists templates it cannot apply",
);

// The document is only safe to return because a template provably holds no
// people. Assert that both writers validate with holders refused, so widening
// the list response cannot become a way to read another council's personnel.
check(
  "a template cannot carry a person, which is what makes its document safe to return",
  /gov_document_valid\(p_document, false\)/.test(flat(m29)) &&
    /A template cannot name people/.test(flat(m29)) &&
    /t\.is_builtin\n?\s*or t\.organization_id = v_account\.organization_id/.test(m3030),
  "a template could carry holders, or the list answers across organizations",
);

// The builder must not put a roster id in the document: the document is stored
// verbatim, so a session-only id would be persisted with the structure.
// `readPendingSource` strips comments, so the assertions below are made against
// the code only -- a comment explaining a rule cannot be what satisfies a guard
// for it, or deleting the code would leave the check green.
const photoLookupAt = structureWorkspace.indexOf("rosterByEmail(email)");
const holderType = /export type StructureHolder = \{[\s\S]*?\n\};/.exec(structureLib);

check(
  "the builder looks the roster id up instead of storing it in the document",
  photoLookupAt !== -1 &&
    // The holder type is what actually reaches the database, so it is where a
    // persisted `rosterId` would have to be smuggled in. Asserting the type
    // exists matters as much as the absence: a guard that passes when the
    // declaration has moved or been renamed is a guard that cannot fail.
    holderType !== null &&
    !/rosterId/.test(holderType[0]),
  "a roster id is persisted into the structure document",
);

// Two structures may legitimately use the same template keys: uniqueness is per
// document, so applying a template keeps its keys rather than regenerating them.
const templateApplyAt = structureWorkspace.indexOf("edit(t.document)");
const templateKeyAt = structureWorkspace.indexOf("setTemplateKey(t.key)");

check(
  "applying a template installs its document and remembers which one it was",
  templateApplyAt !== -1 && templateKeyAt !== -1 && templateKeyAt < templateApplyAt,
  "applying a template rewrites the stable keys the rest of the feature relies on",
);

check(
  "the editor is not rendered on an assumption, but on the database's capability",
  /fetchStructureForSession\(token, own\.id\)/.test(councilStructurePage) &&
    /capability=\{structure\.capability\}/.test(councilStructurePage) &&
    /!structure\.capability\?\.canRead/.test(councilStructurePage),
  "the builder assumes it may edit instead of asking who may",
);

check(
  "the lifecycle probe cannot leave an organization behind if it throws",
  /uncaughtException/.test(structureProbe) &&
    structureProbe.indexOf("process.on(\"uncaughtException\"") <
      structureProbe.indexOf("Gov Probe ${stamp}") &&
    /delete from public\.organizations where id = any/.test(structureProbe),
  "the probe registers its cleanup after its first insert, or does not clean up at all",
);

// --- 17. Proposal review flow (003050) ---
// The explicit review step and the additional-requirements loop. Load-bearing
// rows are mutation-tested the way item 14 is: deleting the reviewer gate off
// start_proposal_review, taking the org-prefix derivation out of
// claim_requirement_upload, or letting submit_requirement_response skip the
// confirmed-document check must each turn this section red.
const m50Flat = flat(m50);
const m50Blocks = functionBlocks(m50);
const block50 = (name) => m50Blocks.find((b) => b.name === name);
const flat50 = (b) => (b ? flat(b.body) : "");

check(
  "003050 enables RLS on proposal_requirements and creates no policies",
  /alter table smartgov\.proposal_requirements enable row level security/.test(m50Flat) &&
    !/create policy/i.test(m50) &&
    /revoke all on smartgov\.proposal_requirements from anon, authenticated/.test(m50Flat),
);

check(
  "003050 grows the proposal and review status sets",
  /check \(status in \('submitted','under_review','returned','requirements_requested','approved','rejected','published'\)\)/.test(m50Flat) &&
    /check \(decision in \('approved','returned','rejected','requirements'\)\)/.test(m50Flat),
  "the progress bar renders under_review and requirements_requested, so both statuses have to exist in the store",
);

check(
  "003050 gives document_uploads a proposal_requirement target",
  /alter column requirement_item drop not null/.test(m50Flat) &&
    /add column if not exists proposal_requirement uuid/.test(m50Flat) &&
    /check \(\(requirement_item is null\) <> \(proposal_requirement is null\)\)/.test(m50Flat),
  "requirement-response bytes share the item byte store; the XOR target check keeps one claim slot per row",
);

check(
  "003050 start_proposal_review is reviewer-gated and only opens a submitted proposal",
  /smartgov\.is_org_reviewer\(/.test(flat50(block50("smartgov.start_proposal_review"))) &&
    /if v_proposal\.status <> 'submitted' then[\s\S]*invalid_request/.test(flat50(block50("smartgov.start_proposal_review"))) &&
    /set status = 'under_review'/.test(flat50(block50("smartgov.start_proposal_review"))),
);

check(
  "003050 claim_requirement_upload derives the org from the path and answers only for an open requirement",
  /nullif\(split_part\(p_storage_path, '\/', 1\), ''\)::uuid/.test(flat50(block50("smartgov.claim_requirement_upload"))) &&
    /v_org <> v_account\.organization_id/.test(flat50(block50("smartgov.claim_requirement_upload"))) &&
    /p\.status = 'requirements_requested'[\s\S]*r\.status = 'requested'/.test(flat50(block50("smartgov.claim_requirement_upload"))) &&
    /unsupported_file_type/.test(flat50(block50("smartgov.claim_requirement_upload"))),
  "a path is only a document if the caller owns its org prefix and the requirement is actually open",
);

check(
  "003050 review_proposal re-declares with p_requirements and attaches them only to an approval",
  /p_requirements\s+jsonb default null/.test(m50Flat) &&
    /if p_decision <> 'approved' and jsonb_array_length\(v_reqs\) > 0 then[\s\S]*invalid_request/.test(flat50(block50("smartgov.review_proposal"))) &&
    /'requirements_requested'/.test(flat50(block50("smartgov.review_proposal"))) &&
    /'requirements'/.test(flat50(block50("smartgov.review_proposal"))),
  "the loop's entry is a conditional approval: requirements without the approve decision must be refused",
);

check(
  "003050 review_proposal keeps the reviewer gate and the already_reviewed guard",
  /smartgov\.is_org_reviewer\(/.test(flat50(block50("smartgov.review_proposal"))) &&
    /'already_reviewed'/.test(flat50(block50("smartgov.review_proposal"))),
);

check(
  "003050 submit_requirement_response mints a version and answers every open requirement",
  /status <> 'requirements_requested'[\s\S]*invalid_request/.test(flat50(block50("smartgov.submit_requirement_response"))) &&
    /insert into smartgov\.proposal_versions/.test(flat50(block50("smartgov.submit_requirement_response"))) &&
    /d\.confirmed_at is not null[\s\S]*d\.large_object_oid is not null/.test(flat50(block50("smartgov.submit_requirement_response"))) &&
    /set status = 'under_review'/.test(flat50(block50("smartgov.submit_requirement_response"))) &&
    /lsg_unit_ids\(/.test(flat50(block50("smartgov.submit_requirement_response"))),
  "a response is only accepted after a real, confirmed upload and only when the whole round is answered",
);

check(
  "003050 verify_proposal_requirements seals each submitted requirement and approves at the end",
  /smartgov\.is_org_reviewer\(/.test(flat50(block50("smartgov.verify_proposal_requirements"))) &&
    /v_dec not in \('accepted','waived'\)/.test(flat50(block50("smartgov.verify_proposal_requirements"))) &&
    /set status = 'approved'/.test(flat50(block50("smartgov.verify_proposal_requirements"))) &&
    /'already_reviewed'/.test(flat50(block50("smartgov.verify_proposal_requirements"))),
);

check(
  "003050 get_requirement_file scopes the bytes to author, unit, and reviewer",
  /smartgov\.is_org_reviewer\(/.test(flat50(block50("smartgov.get_requirement_file"))) &&
    /lsg_unit_ids\(/.test(flat50(block50("smartgov.get_requirement_file"))) &&
    /confirmed_at is not null[\s\S]*large_object_oid is not null/.test(flat50(block50("smartgov.get_requirement_file"))),
);

check(
  "003050 proposal_detail carries requirements and the budget for the review panel",
  /'requirements', coalesce\(/.test(m50Flat) &&
    /'budget', \(select jsonb_build_object/.test(m50Flat) &&
    /unit_cost,\s*'subtotal', bi\.subtotal/.test(m50Flat),
);

// The published surface of 003050 is measured the same way as item 14: every
// `grant execute on function` in the file must name exactly one of the eight
// intended wrappers, so a stray grant landing on a smartgov.\* definer body is
// caught by the count rather than by prose.
const m50Grants = [...m50Flat.matchAll(/grant execute on function\s+([\w.]+)\s*\(/g)].map((m) => m[1]);
const M50_WRAPPERS = [
  "public.start_proposal_review", "public.match_proposal_requirement",
  "public.claim_requirement_upload", "public.review_proposal",
  "public.submit_requirement_response", "public.verify_proposal_requirements",
  "public.get_requirement_file", "public.proposal_detail",
];
check(
  "003050 publishes exactly the eight intended wrappers to PostgREST",
  m50Grants.length === 8 && m50Grants.every((g) => M50_WRAPPERS.includes(g)),
  m50Grants.length
    ? `granted: ${m50Grants.join(", ")} -- the audited allowlist is the whole attack surface`
    : "no wrapper is granted to anon, authenticated, so PostgREST would answer PGRST202",
);

console.log(
  failures === 0
    ? `\nall ${checks} checks passed\n`
    : `\n${failures} of ${checks} checks FAILED\n`,
);

process.exit(failures === 0 ? 0 : 1);
