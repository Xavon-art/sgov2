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
 *
 * Run: node scripts/check-units.mjs (9 items, 43 assertions)
 *
 * These assertions are only worth their green if they can go red, so the
 * load-bearing ones were mutation-tested against the exact regressions they
 * guard: the caller's account predicate was deleted from the seated CTE, a
 * partial unique index was dropped from 00600, the units step was unscoped
 * from the federated model, the type key was renamed in the submit payload,
 * `security definer` was stripped from a chart function, a policy was added
 * to 00600, a roster call was added to the my-council page, and the
 * founding-member check was removed from list_roster -- each turn the script
 * red. A check that cannot fail is decoration.
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

const m5 = readMigration("20260101000500_add_department_unit_type.sql");
const m6 = readMigration("20260101000600_unit_hierarchy_tables.sql");
const m7 = readMigration("20260101000700_create_organization_unit_tree.sql");
const m8 = readMigration("20260101000800_unit_chart_functions.sql");
const m9 = readMigration("20260101000900_roster_invites.sql");
const m10 = readMigration("20260101001000_list_roster.sql");

const steps = readFileSync(join(ROOT, "src/lib/steps.ts"), "utf8");
const submit = readFileSync(join(ROOT, "src/lib/submit.ts"), "utf8");
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
check(
  "submit.ts sends campusName as an empty string, not a draft value",
  /campusName:\s*""/.test(submit) && !/campusName:\s*draft/.test(submit),
  "a USG has no single campus to name",
);
check(
  "submit.ts sends college as an empty string, not a draft value",
  /college:\s*""/.test(submit) && !/college:\s*draft/.test(submit),
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
  ![m5, m6, m7, m8, m9, m10].some((sql) => /create policy/i.test(sql)),
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

console.log(
  failures === 0
    ? `\nall ${checks} checks passed\n`
    : `\n${failures} of ${checks} checks FAILED\n`,
);

process.exit(failures === 0 ? 0 : 1);
