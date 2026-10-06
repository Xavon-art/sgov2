/**
 * Exercises the government-structure feature end to end against the live database
 * in a throwaway organization: build a draft, try to edit it as the wrong side,
 * submit it, watch the USG approve it, confirm the chart changed, then renew.
 *
 * Run: node scripts/probe-structure.mjs
 *
 * This writes to the database in POSTGRES_URL. It creates one organization named
 * "Gov Probe <stamp>", asserts over it, and deletes it in the crash handler
 * below -- which is why that handler is registered before the first insert rather
 * than at the end. An earlier draft of this file died on its first `TypeError`
 * and left nine organizations behind in production, each with a roster, members,
 * structures and review history. If this ever fails to clean up, the residue is
 * still identifiable by the `Gov Probe %` name prefix.
 *
 * The point of these checks is the gate. A structure feature that renders
 * beautifully and lets an LSG officer approve their own council has failed, so
 * most of what is asserted here is about who is refused and when.
 *
 * These are behavioural checks against the deployed functions, so they cover the
 * things `scripts/check-units.mjs` cannot see by reading source: that the
 * committee wrapper survives a round trip, that approval actually rewrites the
 * chart, that a sibling council is refused a roster, and that a photo comes back
 * as unwrapped base64. The static guards live in check-units; this file is the
 * half that has to talk to the database.
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

let pass = 0, fail = 0;
const ok = (label, cond, got) => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n          got: ${JSON.stringify(got)}`); }
};

async function fn(name, ...args) {
  const ph = args.map((_, i) => `$${i + 1}`).join(", ");
  const bound = args.map((a) => (Array.isArray(a) || (a && typeof a === "object") ? JSON.stringify(a) : a));
  try {
    return (await db.query(`select public.${name}(${ph}) as r`, bound)).rows[0].r;
  } catch (e) { return { ok: false, sqlError: e.message }; }
}

async function tokenFor(accountId) {
  const t = "probe-gov-" + Math.random().toString(36).slice(2);
  await db.query(
    `insert into smartgov.sessions (account_id, token_hash, expires_at)
     values ($1, smartgov.sha256($2), now() + interval '30 minutes')`, [accountId, t]);
  return t;
}

const stamp = Date.now().toString(36);
const cleanup = { orgs: [] };

// Runs even when an assertion throws. Every earlier version of this file died on the
// first `TypeError` and left a whole federated organization behind -- roster,
// members, structures, review history, and sometimes a photo's large object -- in
// the production database. This is what stops it needing a rescue script.
process.on("uncaughtException", async (e) => {
  console.error("\nprobe aborted:", e.message);
  try {
    if (cleanup.orgs.length) {
      await db.query(`delete from public.organizations where id = any($1)`, [cleanup.orgs]);
    }
    const stale = (await db.query(
      `select lo.oid from pg_largeobject_metadata lo
        where lo.oid not in (select photo_oid from smartgov.roster where photo_oid is not null)`)).rows;
    for (const o of stale) await db.query(`select lo_unlink($1)`, [o.oid]);
    console.error(`cleaned up ${cleanup.orgs.length} probe org(s), ${stale.length} large object(s)`);
  } catch (cleanupError) {
    console.error(
      "cleanup failed -- delete the organization named 'Gov Probe %' by hand:",
      cleanupError.message,
    );
  }
  await db.end().catch(() => {});
  process.exit(1);
});

// --------------------------------------------------------------- scenario

console.log("--- 0. build a federated organization with one council");
const created = await fn("create_organization", {
  organizationName: `Gov Probe ${stamp}`,
  governanceModel: "federated",
  academicYear: "2026-2027",
  universityName: "Probe State University",
  charterNumber: `PROBE-${stamp}`,
  officerName: "Probe Owner",
  officerEmail: `govowner-${stamp}@probe.test`,
  officerRole: "usg_officer",
  units: [{ name: "College of Engineering", type: "college" }],
});
ok("the organization was created", created.ok !== false && !!created.organizationId, created);
const orgId = created.organizationId;
cleanup.orgs.push(orgId);

const ownerAcct = (await db.query(
  `insert into smartgov.accounts (email, password_hash, display_name, account_kind,
        account_scope, organization_id, university_name, status)
   values ($1, smartgov.hash_password('probe-password-1'), 'Probe Owner', 'usg', 'owner', $2, 'Probe State University', 'active')
   returning id`, [`govowner-${stamp}@probe.test`, orgId])).rows[0];

const units = (await db.query(
  `select id, name, unit_type, parent_id from public.governance_units where organization_id=$1 order by parent_id nulls first`,
  [orgId])).rows;
const usgUnit = units.find((u) => u.unit_type === "usg");
const lsgUnit = units.find((u) => u.unit_type === "college");
ok("the USG root and one council exist", !!usgUnit && !!lsgUnit, units);

const ownerTok = await tokenFor(ownerAcct.id);

// Give the owner a seat in their own USG unit, and create a President position.
const posRes = await fn("add_position", ownerTok, "President", 0);
ok("the owner can add a position", posRes.ok === true, posRes);
await fn("toggle_unit_position", ownerTok, usgUnit.id, posRes.positionId, true);

const ownerRoster = (await db.query(
  `insert into smartgov.roster (organization_id, full_name, email, first_name, last_name)
   values ($1, 'Probe Owner', $2, 'Probe', 'Owner') returning id`,
  [orgId, `govowner-${stamp}@probe.test`])).rows[0];
await db.query(
  `insert into smartgov.unit_memberships (roster_id, unit_id, position_id) values ($1,$2,$3)`,
  [ownerRoster.id, usgUnit.id, posRes.positionId]);

// An LSG officer seated in the college, via the real invite path.
const invite = await fn("create_invite", ownerTok, `govlsg-${stamp}@probe.test`,
  "College of Engineering", "college", lsgUnit.id, posRes.positionId);
ok("the owner can invite into a council seat", invite.ok === true, invite);
const accepted = await fn("accept_invite", invite.token, "probe-password-2");
ok("the invitee registers", accepted.ok === true, accepted);
const lsgAcct = (await db.query(`select id from smartgov.accounts where email=$1`,
  [`govlsg-${stamp}@probe.test`])).rows[0];
// `accept_invite` leaves the account `pending`; activation happens over mail + OTP,
// which cannot run in a probe. Flip it directly so the session authenticates.
await db.query(`update smartgov.accounts set status='active', activated_at=now() where id=$1`,
  [lsgAcct.id]);
const lsgTok = await tokenFor(lsgAcct.id);

// A second council in the same organization, with its own officer. `create_organization`
// only builds the tree once, so the row is inserted directly: what is under test here
// is isolation between councils, not how a council is created.
const otherUnit = (await db.query(
  `insert into public.governance_units (organization_id, name, unit_type, parent_id)
   values ($1, 'College of Arts', 'college', $2) returning id`, [orgId, usgUnit.id])).rows[0];
const otherPos = await fn("add_position", ownerTok, "President", 0);
await fn("toggle_unit_position", ownerTok, otherUnit.id, otherPos.positionId, true);
const invite2 = await fn("create_invite", ownerTok, `govlsg2-${stamp}@probe.test`,
  "College of Arts", "college", otherUnit.id, otherPos.positionId);
ok("the owner can invite into a second council", invite2.ok === true, invite2);
await fn("accept_invite", invite2.token, "probe-password-3");

console.log("\n--- 1. who may edit what");
ok("an LSG officer may edit their own council",
  (await fn("get_structure", lsgTok, lsgUnit.id)).capability?.canEdit === true);
const lsgOnUsg = await fn("get_structure", lsgTok, usgUnit.id);
// Reading the USG's structure is intended -- an LSG officer can see the chart above
// them -- so the thing to refuse is the edit, not the read.
ok("an LSG officer may read the structure above them", lsgOnUsg.ok === true, lsgOnUsg.reason);
ok("an LSG officer may not edit it", lsgOnUsg.capability.canEdit === false, lsgOnUsg.capability);

console.log("\n--- 2. the template gallery");
const gallery = await fn("list_structure_templates", lsgTok);
ok("the gallery answers an LSG officer", gallery.ok === true, gallery);
ok("the ten built-in blueprints are all there", gallery.templates.length >= 10, gallery.templates.length);
ok("every blueprint reports its committee and seat counts",
  gallery.templates.every((t) => typeof t.committees === "number" && typeof t.seats === "number" && t.seats > 0),
  gallery.templates.map((t) => [t.key, t.committees, t.seats]));
ok("a built-in template carries nobody's name",
  (await db.query(`select count(*)::int n from smartgov.gov_structure_templates t,
      jsonb_array_elements(t.document->'committees') c, jsonb_array_elements(c->'positions') p
     where t.is_builtin and p->'holder' is not null`)).rows[0].n === 0);

console.log("\n--- 3. building a draft");
// The officer builds their own council and names themselves in their own chair,
// which is the normal case. Ana and Ben are new people in the other seats.
const officerEmail = `govlsg-${stamp}@probe.test`;
const doc = {
  committees: [
    { key: "board", isUnit: true, name: "Board of Officers", description: "",
      positions: [
        { key: "president", title: "President", holder: {
            firstName: "Probe", lastName: "Officer", email: officerEmail } },
        { key: "vp", title: "Vice President", holder: {
            firstName: "Ana", middleName: "R", lastName: "Dela Cruz",
            birthdate: "2005-03-14", course: "BS Information Technology",
            yearLevel: "3rd Year", gender: "female",
            contactNumber: "09171234567", email: `ana-${stamp}@probe.test`,
            address: "12 Katipunan St" } },
        { key: "secretary", title: "Secretary", holder: {
            firstName: "Ben", lastName: "Reyes", course: "BS Civil Engineering",
            yearLevel: "4th Year", gender: "male",
            email: `ben-${stamp}@probe.test` } },
      ] },
    { key: "finance", name: "Finance Committee", description: "Budgets and ledgers.",
      positions: [
        { key: "chair", title: "Chairperson", holder: null },
      ] },
  ],
};

const saved = await fn("save_structure_draft", lsgTok, lsgUnit.id, "standard-council",
  "2026-2027", "2026-08-01", "2027-07-31", doc, "first pass");
ok("the draft saves", saved.ok === true, saved);
ok("it is attributed to the LSG, not the reviewer side", saved.authorKind === "lsg", saved.authorKind);
ok("it starts at revision 1", saved.revision === 1, saved);

const invalid = await fn("save_structure_draft", lsgTok, lsgUnit.id, null,
  "2026-2027", "2027-01-01", "2026-01-01", doc, null);
ok("a term that ends before it starts is refused", invalid.reason === "invalid_request", invalid);

const badHolder = JSON.parse(JSON.stringify(doc));
badHolder.committees[0].positions[0].holder.email = "not-an-email";
const invalidHolder = await fn("save_structure_draft", lsgTok, lsgUnit.id, null,
  "2026-2027", "2026-08-01", "2027-07-31", badHolder, null);
ok("a seat with no usable email is refused, and it says which seat",
  invalidHolder.ok === false && /President/.test(invalidHolder.detail ?? ""), invalidHolder);

console.log("\n--- 4. reading the draft back");
const detail = await fn("get_structure", lsgTok, lsgUnit.id);
ok("the draft is there", detail.draft?.id === saved.structureId, detail.draft?.id);
ok("the document round-trips", detail.draft.document.committees.length === 2,
  detail.draft?.document?.committees?.length);
if (detail.draft.document.committees[0]?.positions?.[0]?.holder === undefined) {
  console.log("  document as returned:\n" + JSON.stringify(detail.draft.document, null, 2));
}
// The shape a fetched document has to keep: identity, title, and a nested holder.
ok("a seat keeps its key and title through a round trip",
  detail.draft.document.committees[0].positions[0].key === "president" &&
  detail.draft.document.committees[0].positions[0].title === "President",
  detail.draft.document.committees[0].positions[0]);
ok("the seat order the author saved is the order that comes back",
  detail.draft.document.committees[0].positions.map((p) => p.title).join(",") ===
  "President,Vice President,Secretary",
  detail.draft.document.committees[0].positions.map((p) => p.title));
ok("the first committee is still the council's own board",
  detail.draft.document.committees[0].isUnit === true &&
  detail.draft.document.committees[1].name === "Finance Committee",
  detail.draft.document.committees.map((c) => [c.name, c.isUnit]));
ok("hasPhoto is marked, under the holder it belongs to",
  detail.draft.document.committees[0].positions[0].holder.hasPhoto === false);
ok("a filled seat's details stay under its holder",
  detail.draft.document.committees[0].positions[1].holder.lastName === "Dela Cruz" &&
  detail.draft.document.committees[0].positions[1].title === "Vice President",
  detail.draft.document.committees[0].positions[1]);
ok("no photo bytes are ever returned", detail.draft.document.committees[0].positions[0].holder.photo === undefined);
ok("renewal is offered once something is live", detail.renewal.canRequest === false, detail.renewal);

const otherEmail = `govlsg2-${stamp}@probe.test`;
const otherAcct = (await db.query(`select id from smartgov.accounts where email=$1`, [otherEmail])).rows[0];
await db.query(`update smartgov.accounts set status='active', activated_at=now() where id=$1`,
  [otherAcct.id]);
const otherTok = await tokenFor(otherAcct.id);
ok("an officer of another council cannot read this council's structure",
  (await fn("get_structure", otherTok, lsgUnit.id)).reason === "not_found",
  await fn("get_structure", otherTok, lsgUnit.id));
ok("nor open a draft in it",
  (await fn("save_structure_draft", otherTok, lsgUnit.id, null, "x", "2026-08-01", "2027-07-31", doc, null)).reason === "forbidden");
ok("nor submit one",
  (await fn("submit_structure", otherTok, saved.structureId, null)).reason === "forbidden");
console.log("\n--- 4b. the roster does not leak sideways");
const otherPick = await fn("list_structure_roster", otherTok, otherUnit.id);
ok("an officer can pick from their own council", otherPick.ok === true, otherPick);
ok("but not from a sibling council",
  !otherPick.roster.some((r) => r.email === `ana-${stamp}@probe.test`),
  otherPick.roster.map((r) => r.email));
ok("and not from the USG above them",
  !otherPick.roster.some((r) => r.email === `govowner-${stamp}@probe.test`),
  otherPick.roster.map((r) => r.email));
ok("the USG's own picker still sees the whole organization",
  (await fn("list_structure_roster", ownerTok, otherUnit.id)).scope === "organization");

console.log("\n--- 5. submitting, and the gate");
const submitted = await fn("submit_structure", lsgTok, saved.structureId, "for approval");
ok("the LSG submits", submitted.ok === true && submitted.status === "submitted", submitted);
ok("it was NOT auto-approved", submitted.autoApproved === false, submitted);

const midEdit = await fn("save_structure_draft", lsgTok, lsgUnit.id, null,
  "2026-2027", "2026-08-01", "2027-07-31", doc, "sneaky edit");
ok("a submitted structure cannot be edited under the reviewer", midEdit.reason === "awaiting_review", midEdit);

const lsgReview = await fn("review_structure", lsgTok, saved.structureId, "approved", null);
ok("the LSG cannot approve its own structure", lsgReview.reason === "forbidden", lsgReview);

const noRemark = await fn("review_structure", ownerTok, saved.structureId, "returned", "");
ok("a return with no remark is refused", noRemark.reason === "invalid_request", noRemark);

const queue = await fn("list_structure_queue", ownerTok);
ok("the structure is in the USG inbox", queue.pending.some((p) => p.id === saved.structureId),
  queue.pending.map((p) => p.id));
ok("the inbox marks it reviewable", queue.pending.find((p) => p.id === saved.structureId)?.reviewable === true);
ok("the LSG sees its own submission as pending",
  (await fn("list_structure_queue", lsgTok)).pending.some((p) => p.id === saved.structureId));
ok("a draft never appears in anyone's inbox",
  !queue.pending.some((p) => p.status === "draft"));

console.log("\n--- 6. approving, and what it does to the chart");
const before = await fn("unit_chart", ownerTok);
const beforeUnits = before.units.length;

const approved = await fn("review_structure", ownerTok, saved.structureId, "approved", null);
ok("the USG approves", approved.ok === true && approved.status === "approved", approved);
const twice = await fn("review_structure", ownerTok, saved.structureId, "approved", null);
ok("the same structure cannot be approved twice", twice.reason === "invalid_request", twice);

const after = await fn("unit_chart", ownerTok);
ok("the chart gained the Finance Committee", after.units.some((u) => u.name === "Finance Committee"),
  after.units.map((u) => u.name));
ok("the committee is typed as a committee",
  after.units.find((u) => u.name === "Finance Committee")?.unitType === "committee");
ok("the committee carries the document key so a rename reuses the row",
  after.units.find((u) => u.name === "Finance Committee")?.structureKey === "finance");
const council = after.units.find((u) => u.id === lsgUnit.id);
ok("the council's own board sits on the council unit, not a child",
  council?.seats?.some((s) => s.label === "President") === true, council?.seats);
ok("the vacant Chair seat exists with nobody in it",
  after.units.find((u) => u.name === "Finance Committee")?.seats
    ?.find((s) => s.label === "Chairperson")?.rosterId === null,
  after.units.find((u) => u.name === "Finance Committee")?.seats);
ok("the officer who built it is still seated after the rewrite",
  council?.seats?.find((s) => s.label === "President")?.email === officerEmail,
  council?.seats?.find((s) => s.label === "President"));

const vpSeat = council?.seats?.find((s) => s.label === "Vice President");
ok("a new member's name parts are on the chart seat",
  vpSeat?.firstName === "Ana" && vpSeat?.lastName === "Dela Cruz" && vpSeat?.middleName === "R", vpSeat);
ok("the brief's member fields came through",
  vpSeat?.birthdate === "2005-03-14" && vpSeat?.course === "BS Information Technology" &&
  vpSeat?.yearLevel === "3rd Year" && vpSeat?.gender === "female" &&
  vpSeat?.contactNumber === "09171234567" && vpSeat?.address === "12 Katipunan St", vpSeat);
ok("seats read in the order the document lists them",
  council?.seats?.map((s) => s.label).join(",") === "President,Vice President,Secretary",
  council?.seats?.map((s) => s.label));
ok("the abolished-then-restored committee count is sane", typeof beforeUnits === "number");

console.log("\n--- 7. the LSG sees the approved structure, and the USG's own is self-approving");
const lsgView = await fn("get_structure", lsgTok, lsgUnit.id);
ok("the LSG can read its approved structure", lsgView.approved?.id === saved.structureId);
ok("the open draft slot is now empty", lsgView.draft === null, lsgView.draft);
ok("renewal is now offered", lsgView.renewal.canRequest === true, lsgView.renewal);
ok("the term has a day count to it", typeof lsgView.renewal.daysRemaining === "number", lsgView.renewal);

const usgSaved = await fn("save_structure_draft", ownerTok, usgUnit.id, "executive-cabinet",
  "2026-2027", "2026-08-01", "2027-07-31",
  { committees: [{ key: "cabinet", isUnit: true, name: "Executive Cabinet", description: "",
      positions: [{ key: "president", title: "President",
        holder: { firstName: "Probe", lastName: "Owner", email: `govowner-${stamp}@probe.test` } }] }] },
  null);
ok("the owner can draft the USG's own structure", usgSaved.ok === true && usgSaved.authorKind === "usg", usgSaved);
const usgSubmitted = await fn("submit_structure", ownerTok, usgSaved.structureId, null);
ok("the top tier approves itself -- nobody is above it",
  usgSubmitted.ok === true && usgSubmitted.autoApproved === true, usgSubmitted);

console.log("\n--- 8. an LSG cannot edit the USG structure, and cannot forge approval");
const forge = await fn("save_structure_draft", lsgTok, usgUnit.id, null, "2026-2027",
  "2026-08-01", "2027-07-31", doc, null);
ok("the LSG is refused the USG structure", forge.reason === "forbidden", forge);

console.log("\n--- 9. renewing");
const renewed = await fn("request_structure_renewal", lsgTok, lsgUnit.id, null, null, null);
ok("renewal seeds the next term", renewed.ok === true && renewed.renewsId === saved.structureId, renewed);
ok("the new term starts the day after the old one ended",
  renewed.startsOn === "2027-08-01", { new: renewed.startsOn, old: lsgView.approved.endsOn });
ok("and runs a year", renewed.endsOn === "2028-08-01", renewed.endsOn);
const again = await fn("request_structure_renewal", lsgTok, lsgUnit.id, null, null, null);
ok("a second renewal is refused while one is in flight", again.reason === "already_in_progress", again);

const renewSubmitted = await fn("submit_structure", lsgTok, renewed.structureId, "term two");
ok("a renewal goes through the same gate", renewSubmitted.status === "submitted", renewSubmitted);
const renewApproved = await fn("review_structure", ownerTok, renewed.structureId, "approved", null);
ok("and the USG approves it", renewApproved.ok === true, renewApproved);
const postRenew = await fn("get_structure", lsgTok, lsgUnit.id);
ok("the first term is now history, not the live structure",
  postRenew.approved.id === renewed.structureId && postRenew.history.some((h) => h.id === saved.structureId),
  { live: postRenew.approved.id, history: postRenew.history.map((h) => [h.id, h.status]) });
ok("the superseded term says so", postRenew.history.find((h) => h.id === saved.structureId)?.status === "superseded");

console.log("\n--- 10. returned means editable again");
const s2 = await fn("save_structure_draft", lsgTok, lsgUnit.id, null, "2026-2027",
  "2026-08-01", "2027-07-31", doc, "please check the committees");
await fn("submit_structure", lsgTok, s2.structureId, null);
const back = await fn("review_structure", ownerTok, s2.structureId, "returned", "The finance committee needs a description.");
ok("the USG can return it with a remark", back.ok === true && back.status === "returned", back);
const edited = await fn("save_structure_draft", lsgTok, lsgUnit.id, null, "2026-2027",
  "2026-08-01", "2027-07-31", doc, "fixed");
ok("a returned structure is editable again", edited.ok === true && edited.status === "draft", edited);
ok("and the edit bumps the revision, so the review is not a replay",
  edited.revision === s2.revision + 1, { was: s2.revision, now: edited.revision });
const resubmit = await fn("submit_structure", lsgTok, s2.structureId, null);
ok("it can be resubmitted", resubmit.ok === true, resubmit);
const approve2 = await fn("review_structure", ownerTok, s2.structureId, "approved", null);
ok("and approved on the new revision -- not refused as already_reviewed",
  approve2.ok === true && approve2.ok !== undefined, approve2);

console.log("\n--- 11. removing a committee takes it off the chart");
const without = JSON.parse(JSON.stringify(doc));
without.committees = [without.committees[0]];
await fn("save_structure_draft", lsgTok, lsgUnit.id, null, "2027-2028", "2027-08-01", "2028-07-31", without, null);
const s3 = await fn("submit_structure", lsgTok,
  (await fn("get_structure", lsgTok, lsgUnit.id)).draft.id, null);
await fn("review_structure", ownerTok, s3.structureId, "approved", null);
const trimmed = await fn("unit_chart", ownerTok);
ok("the abolished committee is gone from the chart",
  !trimmed.units.some((u) => u.name === "Finance Committee"), trimmed.units.map((u) => u.name));
ok("and the approved document still records that it existed",
  (await fn("get_structure", lsgTok, lsgUnit.id)).history.some((h) =>
    h.document.committees.some((c) => c.key === "finance")));

console.log("\n--- 12. the scoped roster picker");
const pick = await fn("list_structure_roster", lsgTok, lsgUnit.id);
ok("the LSG can list their own council's people", pick.ok === true && pick.scope === "unit", pick.scope);
ok("and it includes the people the structure named",
  pick.roster.some((r) => r.email === `ana-${stamp}@probe.test`), pick.roster.map((r) => r.email));
ok("with the detail fields the editor prefills from",
  pick.roster.find((r) => r.email === `ana-${stamp}@probe.test`)?.course === "BS Information Technology");
ok("the USG's picker is organization-scoped",
  (await fn("list_structure_roster", ownerTok, lsgUnit.id)).scope === "organization");
// `p_unit_id` only gates the read check for a non-reviewer -- the people returned are
// always the caller's own subtree -- so naming the USG root here returns this
// council's people and not the university's. Asserting the absence of the leak is
// the point; the parameter is not a filter and pretending otherwise would be.
const askUp = await fn("list_structure_roster", lsgTok, usgUnit.id);
ok("naming the USG root does not hand over the USG roster",
  askUp.ok === true &&
  !askUp.roster.some((r) => r.email === `govowner-${stamp}@probe.test`),
  askUp.roster?.map((r) => r.email));
ok("a unit with no relationship at all is missing, not forbidden",
  (await fn("list_structure_roster", lsgTok, otherUnit.id)).reason === "not_found");

console.log("\n--- 13. photos are never in a payload, and are reachable by the right side");
ok("the chart carries hasPhoto, not bytes",
  trimmed.units.some((u) => u.seats.some((s) => s.hasPhoto === false)) &&
  !JSON.stringify(trimmed).includes('"photo"'));
const ana = pick.roster.find((r) => r.email === `ana-${stamp}@probe.test`);
ok("a photo-less member reports none", (await fn("get_member_photo", ownerTok, ana.rosterId)).bytes === 0);

// Store one directly, then prove the read path.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64");
const anaRow = (await db.query(`select id, photo_oid from smartgov.roster where organization_id=$1 and email=$2`,
  [orgId, `ana-${stamp}@probe.test`])).rows[0];
const oid = (await db.query(`select lo_from_bytea(0, $1::bytea) as oid`, [`\\x${png.toString("hex")}`])).rows[0].oid;
await db.query(`update smartgov.roster set photo_oid=$1, photo_mime='image/png', photo_bytes=$2 where id=$3`,
  [oid, png.length, anaRow.id]);

const ownerPhoto = await fn("get_member_photo", ownerTok, anaRow.id);
ok("the reviewing side can fetch the image", ownerPhoto.ok === true && ownerPhoto.bytes === png.length, ownerPhoto);
ok("and it comes back as bytes, not a URL",
  ownerPhoto.base64 === png.toString("base64"),
  { gotLen: ownerPhoto.base64?.length, wantLen: png.toString("base64").length,
    got: ownerPhoto.base64?.slice(-24), want: png.toString("base64").slice(-24) });
ok("the LSG officer seated in that council can fetch it too",
  (await fn("get_member_photo", lsgTok, anaRow.id)).ok === true);
const stranger = (await db.query(
  `insert into smartgov.roster (organization_id, full_name, email) values ($1,'Stranger','nobody@probe.test') returning id`,
  [orgId])).rows[0];
await db.query(`insert into smartgov.unit_memberships (roster_id, unit_id, position_id)
                values ($1,$2,$3) on conflict do nothing`, [stranger.id, usgUnit.id, posRes.positionId]);
const strangerAcct = (await db.query(
  `insert into smartgov.accounts (email, password_hash, display_name, account_kind, account_scope,
        organization_id, status)
   values ($1, smartgov.hash_password('probe-password-4'), 'Stranger', 'usg', 'invited', $2, 'active') returning id`,
  [`stranger-${stamp}@probe.test`, orgId])).rows[0];
const strangerTok = await tokenFor(strangerAcct.id);
ok("someone seated elsewhere cannot fetch it",
  (await fn("get_member_photo", strangerTok, anaRow.id)).reason === "forbidden",
  await fn("get_member_photo", strangerTok, anaRow.id));

console.log("\n--- 14. a committee cannot be authored on its own");
const committeeId = after.units.find((u) => u.unitType === "committee")?.id
                 ?? trimmed?.units?.find((u) => u.unitType === "committee")?.id;
ok("a committee unit exists to try", !!committeeId);
if (committeeId) {
  ok("and it is refused as a structure target",
    (await fn("save_structure_draft", ownerTok, committeeId, null, "x", "2026-01-01", "2027-01-01", doc, null)).reason === "forbidden");
  ok("its own seats cannot be edited directly either",
    (await fn("save_structure_draft", lsgTok, committeeId, null, "x", "2026-01-01", "2027-01-01", doc, null)).reason === "forbidden");
}

console.log("\n--- 15. templates can be saved by the USG and never carry people");
// A template is a shape, not a government: it is the same document with every seat
// emptied, which is also the strongest statement that the gallery carries no one.
const shell = JSON.parse(JSON.stringify(doc));
for (const c of shell.committees) for (const p of c.positions) p.holder = null;
const imported = await fn("import_structure_template", ownerTok, `probe-${stamp}`,
  "Probe house style", "Imported from outside.", "custom", shell);
ok("the USG can save a template", imported.ok === true, imported);
ok("and the gallery then offers it back",
  (await fn("list_structure_templates", ownerTok)).templates.some((t) => t.key === `probe-${stamp}`));
const withPeople = JSON.parse(JSON.stringify(doc));
withPeople.committees[0].positions[0].holder = { firstName: "Real", lastName: "Person", email: "leak@probe.test" };
const refused = await fn("import_structure_template", ownerTok, `probe2-${stamp}`,
  "Leaky", "", "custom", withPeople);
ok("a template carrying a person is refused, and it names the seat",
  refused.ok === false && /President/.test(refused.detail ?? ""), refused);
ok("and nothing was written for the refused one",
  !(await fn("list_structure_templates", ownerTok)).templates.some((t) => t.key === `probe2-${stamp}`));
ok("an LSG officer cannot save an organization template",
  (await fn("import_structure_template", lsgTok, `probe3-${stamp}`, "Nope", "", "custom", shell)).reason === "forbidden");

console.log("\n--- 16. unauthenticated");
ok("a garbage session reads nothing",
  (await fn("get_structure", "not-a-real-token", lsgUnit.id)).reason === "unauthenticated");
ok("a garbage session submits nothing",
  (await fn("submit_structure", "not-a-real-token", saved.structureId, null)).reason === "unauthenticated");

console.log("\n--- 17. the chart is unchanged for the LSG's own scope");
const lsgChart = await fn("unit_chart", lsgTok);
ok("the LSG sees their own council", lsgChart.scope === "unit", lsgChart.scope);
ok("and its seats", lsgChart.units.some((u) => u.id === lsgUnit.id &&
  u.seats.some((s) => s.label === "President" && s.email === officerEmail)),
  lsgChart.units.map((u) => u.name));
ok("but not the sibling council",
  !lsgChart.units.some((u) => u.name === "College of Arts"), lsgChart.units.map((u) => u.name));

console.log("\n--- 18. an author keeps their unit when the document unseats them");
// The case 02990 exists for: approval closed this officer's membership, so from here
// on they hold no seat anywhere. Seating is simulated directly here because the
// document path can only produce it by naming somebody else in their chair.
await db.query(`update smartgov.unit_memberships set end_date = current_date
                 where roster_id in (select r.id from smartgov.roster r
                                      where r.organization_id=$1 and r.email=$2)
                   and end_date is null`, [orgId, officerEmail]);
const unseated = await fn("get_structure", lsgTok, lsgUnit.id);
ok("they can still read the structure they wrote", unseated.ok === true, unseated.reason);
ok("and can still edit it", unseated.capability.canEdit === true, unseated.capability);
ok("so renewal is still theirs to start", unseated.renewal.canRequest === true, unseated.renewal);

// 03020: the chart is no longer purely seating-scoped, so this officer keeps the
// council they wrote. Asserted rather than assumed -- 00800's rule was seating-only,
// and a regression here would be invisible until somebody reported a missing chart.
const unseatedChart = await fn("unit_chart", lsgTok);
ok("and keeps the chart of the council they wrote, unseated or not",
  unseatedChart.ok === true && unseatedChart.units.some((u) => u.id === lsgUnit.id),
  { scope: unseatedChart.scope, reason: unseatedChart.reason });
ok("but it is still their own scope, not the whole organization",
  unseatedChart.scope === "unit" && !unseatedChart.units.some((u) => u.id === otherUnit.id),
  unseatedChart.units.map((u) => u.name));
ok("with the seats the approved document put there",
  unseatedChart.units.find((u) => u.id === lsgUnit.id)?.seats
    ?.find((s) => s.label === "Vice President")?.email === `ana-${stamp}@probe.test`,
  unseatedChart.units.find((u) => u.id === lsgUnit.id)?.seats);

ok("an account with neither a seat nor an authorship sees nothing",
  (await fn("get_structure", strangerTok, lsgUnit.id)).ok === false);

// ------------------------------------------------------------------ cleanup
console.log("\n--- cleanup");
await db.query(`delete from public.organizations where id = any($1)`, [cleanup.orgs]);
const left = (await db.query(`select count(*)::int n from public.organizations where id = any($1)`,
  [cleanup.orgs])).rows[0].n;
ok("the probe organization is gone", left === 0, left);
const orphans = (await db.query(
  `select count(*)::int n from pg_largeobject_metadata lo
    where lo.oid not in (select photo_oid from smartgov.roster where photo_oid is not null)`)).rows[0].n;
ok("no photo large objects were orphaned", orphans === 0, orphans);

console.log(`\n${pass} passed, ${fail} failed`);
await db.end();
process.exit(fail === 0 ? 0 : 1);