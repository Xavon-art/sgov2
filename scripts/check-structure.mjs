/**
 * Checks for the officer-chart layout: upgrade, layout validation, tiers,
 * holders, optimistic-concurrency conflicts, photo stripping, and the
 * organization-wide read.
 *
 * Run: npm run test:structure
 *
 * Writes to POSTGRES_URL. Creates one throwaway organization and deletes it in
 * the crash handler, the same contract `probe-structure.mjs` uses.
 */
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";

function loadEnv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const env = { ...loadEnv(".env"), ...loadEnv(".env.local") };
const url = env.POSTGRES_URL || env.DATABASE_URL;
if (!url) {
  console.error("No POSTGRES_URL or DATABASE_URL in .env.local");
  process.exit(1);
}

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1 });
await db.connect();

let pass = 0;
let fail = 0;
const ok = (label, cond, got) => {
  if (cond) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}\n          got: ${JSON.stringify(got)}`);
  }
};

async function fn(name, ...args) {
  const ph = args.map((_, i) => `$${i + 1}`).join(", ");
  const bound = args.map((a) =>
    a && typeof a === "object" && !(a instanceof Date) ? JSON.stringify(a) : a,
  );
  try {
    return (await db.query(`select public.${name}(${ph}) as r`, bound)).rows[0].r;
  } catch (error) {
    return { ok: false, sqlError: error.message };
  }
}

async function tokenFor(accountId) {
  const token = "check-chart-" + Math.random().toString(36).slice(2);
  await db.query(
    `insert into smartgov.sessions (account_id, token_hash, expires_at)
     values ($1, smartgov.sha256($2), now() + interval '30 minutes')`,
    [accountId, token],
  );
  return token;
}

const stamp = Date.now().toString(36);
const cleanup = { orgs: [] };

process.on("uncaughtException", async (error) => {
  console.error("\ncheck aborted:", error.message);
  try {
    if (cleanup.orgs.length) {
      await db.query(`delete from public.organizations where id = any($1)`, [cleanup.orgs]);
    }
  } catch (cleanupError) {
    console.error("cleanup failed -- delete organizations named 'Chart Check %':", cleanupError.message);
  }
  await db.end().catch(() => {});
  process.exit(1);
});

// ------------------------------------------------------------------ fixture

console.log("--- 0. throwaway organization");
const created = await fn("create_organization", {
  organizationName: `Chart Check ${stamp}`,
  governanceModel: "federated",
  academicYear: "2026-2027",
  universityName: "Chart Check University",
  charterNumber: `CHART-${stamp}`,
  officerName: "Chart Owner",
  officerEmail: `chart-owner-${stamp}@check.test`,
  officerRole: "usg_officer",
  units: [{ name: "College of Engineering", type: "college" }],
});
ok("organization created", created.ok !== false && !!created.organizationId, created);
const orgId = created.organizationId;
cleanup.orgs.push(orgId);

const units = (
  await db.query(
    `select id, name, unit_type from public.governance_units where organization_id=$1`,
    [orgId],
  )
).rows;
const root = units.find((u) => u.unit_type === "usg");
const council = units.find((u) => u.unit_type === "college");
ok("root and council exist", !!root && !!council, units);

const owner = (
  await db.query(
    `insert into smartgov.accounts (email, password_hash, display_name, account_kind,
        account_scope, organization_id, university_name, status, activated_at)
     values ($1, smartgov.hash_password('chart-check-1'), 'Chart Owner', 'usg', 'owner', $2,
             'Chart Check University', 'active', now())
     returning id`,
    [`chart-owner-${stamp}@check.test`, orgId],
  )
).rows[0];
const lsg = (
  await db.query(
    `insert into smartgov.accounts (email, password_hash, display_name, account_kind,
        account_scope, organization_id, university_name, status, activated_at)
     values ($1, smartgov.hash_password('chart-check-2'), 'Chart Officer', 'central', 'invited', $2,
             'Chart Check University', 'active', now())
     returning id`,
    [`chart-lsg-${stamp}@check.test`, orgId],
  )
).rows[0];
// A seat in the council is what makes the officer its author; the account row
// alone would only be an account.
const lsgRoster = (
  await db.query(
    `insert into smartgov.roster (organization_id, account_id, full_name, email, first_name, last_name)
     values ($1, $3, 'Chart Officer', $2, 'Chart', 'Officer') returning id`,
    [orgId, `chart-lsg-${stamp}@check.test`, lsg.id],
  )
).rows[0];
await db.query(
  `insert into smartgov.unit_memberships (roster_id, unit_id) values ($1, $2)`,
  [lsgRoster.id, council.id],
);
const ownerToken = await tokenFor(owner.id);
const lsgToken = await tokenFor(lsg.id);

const holder = (local, first, last) => ({
  email: `${local}-${stamp}@check.test`,
  firstName: first,
  lastName: last,
});

// ------------------------------------------------------------------ upgrade

console.log("\n--- 1. legacy documents upgrade");
const legacy = {
  committees: [
    {
      key: "board",
      isUnit: true,
      name: "Board",
      positions: [
        { key: "president", title: "President", holder: holder("pres", "Paula", "Reyes") },
        { key: "vp", title: "Vice President", holder: null },
      ],
    },
    {
      key: "finance",
      name: "Finance",
      positions: [{ key: "chair", title: "Chair", holder: null }],
    },
  ],
};
const upgraded = (
  await db.query(`select smartgov.gov_document_upgrade($1::jsonb) as d`, [JSON.stringify(legacy)])
).rows[0].d;
ok("schemaVersion becomes 2", upgraded.schemaVersion === 2, upgraded.schemaVersion);
ok("a layout is filled in", upgraded.layout?.template === "hierarchy", upgraded.layout);
ok(
  "the unit committee sits on tier 0 and the rest on tier 1",
  upgraded.committees[0].positions[0].tier === 0 &&
    upgraded.committees[1].positions[0].tier === 1,
  upgraded.committees.map((c) => c.positions.map((p) => p.tier)),
);
ok(
  "holder is mirrored into holders[]",
  Array.isArray(upgraded.committees[0].positions[0].holders) &&
    upgraded.committees[0].positions[0].holders[0].email === legacy.committees[0].positions[0].holder.email,
  upgraded.committees[0].positions[0],
);
ok(
  "fullName is derived from the parts",
  upgraded.committees[0].positions[0].holders?.[0]?.fullName === "Paula Reyes",
  upgraded.committees[0].positions[0].holders?.[0],
);
ok(
  "an empty seat keeps an empty holders array",
  Array.isArray(upgraded.committees[0].positions[1].holders) &&
    upgraded.committees[0].positions[1].holders.length === 0,
  upgraded.committees[0].positions[1],
);

// ------------------------------------------------------------------ building

const layout = {
  template: "pyramid",
  orientation: "vertical",
  theme: "parchment",
  showPhotos: true,
  showTitles: true,
  tierSpacing: 1.2,
  nodeSize: "md",
};

const document = {
  schemaVersion: 2,
  layout,
  committees: [
    {
      key: "board",
      isUnit: true,
      name: "Board",
      positions: [
        {
          key: "president",
          title: "President",
          tier: 0,
          order: 0,
          maxHolders: 2,
          parentKey: null,
          holder: holder("pres", "Paula", "Reyes"),
          holders: [holder("pres", "Paula", "Reyes"), holder("co", "Carlo", "Diaz")],
        },
        {
          key: "vp",
          title: "Vice President",
          tier: 1,
          order: 0,
          maxHolders: 1,
          parentKey: "president",
          holder: null,
        },
      ],
    },
  ],
};

const term = ["2026-2027", "2026-08-01", "2027-07-31"];
const save = (token, unitId, doc, expected = null, note = null) =>
  fn("save_structure_draft_v2", token, unitId, "standard-council", ...term, doc, note, expected);

console.log("\n--- 2. saving a v2 chart");
const first = await save(lsgToken, council.id, document);
ok("the chart saves", first.ok === true, first);
ok("it returns the optimistic-concurrency token", typeof first.updatedAt === "string", first.updatedAt);
ok("it starts at revision 1", first.revision === 1, first.revision);
const tokenAt = first.updatedAt;

const conflict = await save(lsgToken, council.id, document, "2000-01-01T00:00:00.000Z");
ok("a stale token is refused as a conflict", conflict.ok === false && conflict.reason === "conflict", conflict);
ok("the conflict carries the current token", typeof conflict.updatedAt === "string", conflict.updatedAt);

const second = await save(lsgToken, council.id, document, tokenAt);
ok("the current token saves", second.ok === true, second);
ok(
  "updated_at advances even within the same second",
  second.ok && new Date(second.updatedAt).getTime() > new Date(tokenAt).getTime(),
  [tokenAt, second.updatedAt],
);

console.log("\n--- 3. layout and holder validation");
const duplicateKey = JSON.parse(JSON.stringify(document));
duplicateKey.committees[0].positions[1].key = "president";
ok("a duplicate position key is refused", (await save(lsgToken, council.id, duplicateKey)).reason === "duplicate_position_key");

const cycle = JSON.parse(JSON.stringify(document));
cycle.committees[0].positions[0].parentKey = "vp";
cycle.committees[0].positions[1].parentKey = "president";
ok("a reporting loop is refused", (await save(lsgToken, council.id, cycle)).reason === "invalid_parent");

const missingParent = JSON.parse(JSON.stringify(document));
missingParent.committees[0].positions[1].parentKey = "nobody";
ok("an unknown parent is refused", (await save(lsgToken, council.id, missingParent)).reason === "invalid_parent");

const tooMany = JSON.parse(JSON.stringify(document));
tooMany.committees[0].positions[0].maxHolders = 1;
ok("more holders than the seat allows is refused", (await save(lsgToken, council.id, tooMany)).reason === "too_many_holders");

const badLayout = JSON.parse(JSON.stringify(document));
badLayout.layout.template = "hologram";
ok("an unknown template is refused", (await save(lsgToken, council.id, badLayout)).reason === "invalid_request");

const badTier = JSON.parse(JSON.stringify(document));
badTier.committees[0].positions[0].tier = 40;
ok("a tier beyond the chart is refused", (await save(lsgToken, council.id, badTier)).reason === "invalid_request");

console.log("\n--- 4. pixels never come back");
const withPhoto = JSON.parse(JSON.stringify(document));
withPhoto.committees[0].positions[0].holder.photo = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
withPhoto.committees[0].positions[0].holders[0].photo = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
const photoSave = await save(lsgToken, council.id, withPhoto, second.updatedAt);
ok("a document with a photo saves", photoSave.ok === true, photoSave);
const read = await fn("get_structure", lsgToken, council.id);
ok("the draft is readable", read.ok === true && read.draft?.id === photoSave.structureId, read.draft?.id);
const readSeat = read.draft?.document?.committees?.[0]?.positions?.[0];
ok("the photo bytes are stripped on read", readSeat?.holder?.photo === undefined, readSeat?.holder);
ok("each holder is marked instead", typeof readSeat?.holder?.hasPhoto === "boolean", readSeat?.holder);
ok("tiers survive the round trip", readSeat?.tier === 0, readSeat?.tier);
ok("the layout survives the round trip", read.draft?.document?.layout?.template === "pyramid", read.draft?.document?.layout);

// ------------------------------------------------------------------ org read

console.log("\n--- 5. the organization-wide read");
const beforeApproval = await fn("get_org_structure", lsgToken);
ok("a member can ask for the organization chart", beforeApproval.ok === true, beforeApproval);
ok("the root unit is the USG", beforeApproval.unit?.id === root.id, beforeApproval.unit);

const usgDoc = {
  schemaVersion: 2,
  layout: { ...layout, template: "hierarchy" },
  committees: [
    {
      key: "usg",
      isUnit: true,
      name: "University Student Government",
      positions: [
        {
          key: "usg-president",
          title: "President",
          tier: 0,
          order: 0,
          maxHolders: 1,
          parentKey: null,
          holder: holder("usgpres", "Juan", "Cruz"),
        },
      ],
    },
  ],
};
const usgSave = await save(ownerToken, root.id, usgDoc);
ok("the USG author saves its own chart", usgSave.ok === true, usgSave);
const submitted = await fn("submit_structure", ownerToken, usgSave.structureId, "publish");
ok("the USG chart is approved", submitted.ok === true && submitted.status === "approved", submitted);

const afterApproval = await fn("get_org_structure", lsgToken);
ok("the member now sees the published chart", afterApproval.structure?.id === usgSave.structureId, afterApproval.structure?.id);
ok(
  "the published chart carries its layout",
  afterApproval.structure?.document?.layout?.template === "hierarchy",
  afterApproval.structure?.document?.layout,
);

const lsgOnRoot = await save(lsgToken, root.id, usgDoc);
ok("an LSG officer cannot write the USG chart", lsgOnRoot.ok === false && lsgOnRoot.reason === "forbidden", lsgOnRoot);

console.log(`\n${pass} passed, ${fail} failed`);
await db.query(`delete from public.organizations where id = $1`, [orgId]);
await db.end();
process.exit(fail === 0 ? 0 : 1);
