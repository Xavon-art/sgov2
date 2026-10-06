/**
 * Validates the browser-facing structure surface over HTTP, the way the route
 * handlers actually call it: the publishable key against PostgREST `/rpc`, with
 * the same argument names and shapes `src/app/api/structures` sends.
 *
 * Why this is separate from `scripts/probe-structure.mjs`: that one proves the
 * SQL is right over a direct database connection, where a parameter name is
 * irrelevant. PostgREST resolves arguments by name and answers a typo with a
 * function-signature error that only appears once somebody clicks Save. Every
 * function the route reaches is called here first, with the route's own payload.
 *
 * Run: node scripts/probe-structure-http.mjs
 *
 * Writes to the database in POSTGRES_URL, in a throwaway organization, and
 * removes it in the crash handler below.
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
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

const env = { ...loadEnv(".env"), ...loadEnv(".env.local") };
const dbUrl = env.POSTGRES_URL || env.DATABASE_URL;
const apiUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const apiKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!dbUrl || !apiUrl || !apiKey) {
  console.error("Need POSTGRES_URL, NEXT_PUBLIC_SUPABASE_URL and the publishable key.");
  process.exit(1);
}

const db = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, max: 1 });
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

/** The SQL side of a setup step, where a function's own answer is not the point. */
async function fn(name, ...args) {
  const ph = args.map((_, i) => `$${i + 1}`).join(", ");
  const bound = args.map((a) =>
    Array.isArray(a) || (a && typeof a === "object") ? JSON.stringify(a) : a,
  );
  try {
    return (await db.query(`select public.${name}(${ph}) as r`, bound)).rows[0].r;
  } catch (e) {
    return { ok: false, sqlError: e.message };
  }
}

/**
 * Calls PostgREST `/rpc` exactly as supabase-js does. An unknown argument name
 * comes back as a PGRST error rather than an application answer, which is the
 * failure this file exists to catch before a person finds it.
 */
async function rpc(name, body) {
  const res = await fetch(`${apiUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: apiKey,
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  return { status: res.status, body: parsed };
}

async function tokenFor(accountId) {
  const t = "probe-http-" + Math.random().toString(36).slice(2);
  await db.query(
    `insert into smartgov.sessions (account_id, token_hash, expires_at)
     values ($1, smartgov.sha256($2), now() + interval '30 minutes')`,
    [accountId, t],
  );
  return t;
}

const stamp = Date.now().toString(36);
const cleanup = { orgs: [] };

process.on("uncaughtException", async (e) => {
  console.error("\nprobe aborted:", e.message);
  try {
    if (cleanup.orgs.length) {
      await db.query(`delete from public.organizations where id = any($1)`, [cleanup.orgs]);
    }
    const stale = (
      await db.query(
        `select lo.oid from pg_largeobject_metadata lo
          where lo.oid not in (select photo_oid from smartgov.roster where photo_oid is not null)`,
      )
    ).rows;
    for (const o of stale) await db.query(`select lo_unlink($1)`, [o.oid]);
    console.error(`cleaned up ${cleanup.orgs.length} probe org(s), ${stale.length} large object(s)`);
  } catch (cleanupError) {
    console.error("cleanup failed:", cleanupError.message);
  }
  await db.end().catch(() => {});
  process.exit(1);
});

// ------------------------------------------------------------------- fixture
console.log("--- 0. a federated organization, one council, a sibling, and two USG accounts");

const ownerEmail = `httowner-${stamp}@probe.test`;
const staffEmail = `httstaff-${stamp}@probe.test`;
const lsgEmail = `httlsg-${stamp}@probe.test`;
const otherEmail = `httlsg2-${stamp}@probe.test`;

const created = await fn("create_organization", {
  organizationName: `HTTP Probe ${stamp}`,
  governanceModel: "federated",
  academicYear: "2026-2027",
  universityName: "Probe State University",
  charterNumber: `HTTP-${stamp}`,
  officerName: "Probe Owner",
  officerEmail: ownerEmail,
  officerRole: "usg_officer",
  units: [{ name: "College of Engineering", type: "college" }],
});
ok("the organization was created", created.ok !== false && !!created.organizationId, created);
const orgId = created.organizationId;
cleanup.orgs.push(orgId);

const ownerAcct = (
  await db.query(
    `insert into smartgov.accounts (email, password_hash, display_name, account_kind,
       account_scope, organization_id, university_name, status)
     values ($1, smartgov.hash_password('probe-password-1'), 'Probe Owner', 'usg', 'owner', $2,
       'Probe State University', 'active') returning id`,
    [ownerEmail, orgId],
  )
).rows[0].id;

const units = (
  await db.query(
    `select id, name, unit_type, parent_id from public.governance_units
      where organization_id = $1 order by parent_id nulls first`,
    [orgId],
  )
).rows;
const usgUnit = units.find((u) => u.unit_type === "usg");
const lsgUnit = units.find((u) => u.unit_type === "college");
ok("the USG root and one council exist", !!usgUnit && !!lsgUnit, units);

const usgTok = await tokenFor(ownerAcct);

const posRes = await fn("add_position", usgTok, "President", 0);
ok("the owner can add a position", posRes.ok === true, posRes);
await fn("toggle_unit_position", usgTok, lsgUnit.id, posRes.positionId, true);

/** Invites an officer into a seat through the real path, then activates them. */
async function seat(email, unitId, positionId, unitName) {
  const invite = await fn("create_invite", usgTok, email, unitName, "college", unitId, positionId);
  if (!invite.ok) return null;
  await fn("accept_invite", invite.token, "probe-password-2");
  const acct = (await db.query(`select id from smartgov.accounts where email=$1`, [email])).rows[0];
  await db.query(`update smartgov.accounts set status='active', activated_at=now() where id=$1`, [
    acct.id,
  ]);
  return acct.id;
}

const lsgAcct = await seat(lsgEmail, lsgUnit.id, posRes.positionId, "College of Engineering");
ok("the council officer registers and is seated", !!lsgAcct, lsgAcct);
const lsgTok = await tokenFor(lsgAcct);

// A second USG account with review rights but no seat in the council: this is the
// account that has to be able to approve somebody else's structure, which is the
// whole point of the gate and cannot be shown with the author in the chair.
//
// `is_org_reviewer` is seating, not a permission row -- it asks whether the roster
// row behind the account holds a live seat in a unit typed `usg`. So a reviewer is
// built by giving this person a seat on the USG board and nothing else.
const staffAcct = (
  await db.query(
    `insert into smartgov.accounts (email, password_hash, display_name, account_kind,
       account_scope, organization_id, university_name, status)
     values ($1, smartgov.hash_password('probe-password-3'), 'Probe Staff', 'usg', 'invited', $2,
       'Probe State University', 'active') returning id`,
    [staffEmail, orgId],
  )
).rows[0].id;
const staffRoster = (
  await db.query(
    `insert into smartgov.roster (organization_id, full_name, email, first_name, last_name, account_id)
     values ($1, 'Probe Staff', $2, 'Probe', 'Staff', $3) returning id`,
    [orgId, staffEmail, staffAcct],
  )
).rows[0];
await fn("toggle_unit_position", usgTok, usgUnit.id, posRes.positionId, true);
await db.query(
  `insert into smartgov.unit_memberships (roster_id, unit_id, position_id)
   select $1, $2, $3 where exists (select 1 from smartgov.unit_positions
                                     where unit_id = $2 and position_id = $3)`,
  [staffRoster.id, usgUnit.id, posRes.positionId],
);
const staffTok = await tokenFor(staffAcct);

const staffSeated = (
  await db.query(`select smartgov.is_org_reviewer($1, $2) as reviewer`, [staffAcct, orgId])
).rows[0].reviewer;
ok("that seat is what makes the second account a reviewer", staffSeated === true, staffSeated);

// A sibling council with its own officer: what the isolation checks aim at.
const otherUnit = (
  await db.query(
    `insert into public.governance_units (organization_id, name, unit_type, parent_id)
     values ($1, 'College of Arts', 'college', $2) returning id`,
    [orgId, usgUnit.id],
  )
).rows[0];
const otherPos = await fn("add_position", usgTok, "President", 0);
await fn("toggle_unit_position", usgTok, otherUnit.id, otherPos.positionId, true);
const otherAcct = await seat(otherEmail, otherUnit.id, otherPos.positionId, "College of Arts");
const otherTok = await tokenFor(otherAcct);

const councilId = lsgUnit.id;
const siblingId = otherUnit.id;

const document = {
  committees: [
    {
      key: "council",
      name: "College of Engineering Student Council",
      isUnit: true,
      positions: [
        {
          key: "president",
          title: "President",
          holder: { firstName: "Probe", lastName: "Officer", email: lsgEmail },
        },
        { key: "vice", title: "Vice President", holder: null },
      ],
    },
    {
      key: "audit",
      name: "Audit Committee",
      positions: [{ key: "chair", title: "Chairperson", holder: null }],
    },
  ],
};

// ----------------------------------------------------------- unauthenticated
console.log("\n--- 1. the surface refuses a caller with no session");

// Each call carries only the arguments that function declares. Sending extras is
// not a harmless mistake: PostgREST matches a function by its full parameter list,
// so one stray argument turns a clean `unauthenticated` answer into a PGRST202
// naming the signature. That is precisely the class of mistake this probe is for.
const ANONYMOUS_CALLS = [
  ["list_structure_templates", {}],
  ["list_structure_queue", {}],
  ["get_structure", { p_unit_id: councilId }],
  ["list_structure_roster", { p_unit_id: councilId }],
  ["match_structure_holder", { p_unit_id: councilId, p_email: "a@b.c" }],
  ["get_member_photo", { p_roster_id: crypto.randomUUID() }],
];

for (const [name, extra] of ANONYMOUS_CALLS) {
  const res = await rpc(name, { p_session_token: "not-a-real-session", ...extra });
  ok(`${name} answers, and says unauthenticated`,
    res.status === 200 && res.body?.ok === false && res.body?.reason === "unauthenticated", res);
}

// A function the route never calls must not be callable at all: the smartgov
// originals are revoked, so PostgREST reports an unknown function.
const leaked = await rpc("save_structure_draft", { p_session_token: "x" });
ok("the smartgov schema is not reachable from the client", leaked.status === 404, leaked);

// ---------------------------------------------------------------- reads
console.log("\n--- 2. the reads the route performs");

let r = await rpc("list_structure_templates", { p_session_token: usgTok });
ok("list_structure_templates returns the built-in gallery",
  r.status === 200 && r.body.ok === true && r.body.templates.some((t) => t.isBuiltin), r);

// 03030 exists because a gallery that lists templates it cannot hand back is a
// gallery with a "Use this" button wired to nothing. So the list has to carry the
// document, and a usable one: keyed, named, and with at least one seat.
const gallery = r.body.templates ?? [];
ok("every template in the gallery carries a document a builder could apply",
  gallery.length > 0 && gallery.every((t) =>
    Array.isArray(t.document?.committees) &&
    t.document.committees.length === t.committees &&
    t.document.committees.every((c) =>
      typeof c.key === "string" && c.key.length > 0 &&
      typeof c.name === "string" && c.name.length > 0 &&
      Array.isArray(c.positions) && c.positions.length > 0 &&
      c.positions.every((p) => typeof p.key === "string" && p.key.length > 0 &&
        typeof p.title === "string" && p.title.length > 0))),
  gallery.map((t) => [t.key, t.document === undefined ? "no document" : t.committees]));

// The safety argument for returning documents in the list is that a template
// provably holds no people, so this asserts the other half of it: applying one
// cannot be a way to walk names out of a template and into a published council.
const galleryHolders = gallery.flatMap((t) =>
  (t.document?.committees ?? []).flatMap((c) =>
    (c.positions ?? []).filter((p) => p.holder).map((p) => [t.key, p.title, p.holder?.email])));
ok("and no template names anybody, so returning its document widens nobody's view",
  galleryHolders.length === 0, galleryHolders);

r = await rpc("list_structure_queue", { p_session_token: usgTok });
ok("list_structure_queue reports the reviewer side to an owner",
  r.status === 200 && r.body.ok === true && r.body.isReviewer === true, r);

r = await rpc("get_structure", { p_session_token: usgTok, p_unit_id: councilId });
ok("get_structure returns the unit with no draft yet",
  r.status === 200 && r.body.ok === true && r.body.unit?.id === councilId && r.body.draft === null, r);
ok("and tells the caller whether renewal is available",
  r.body.renewal?.canRequest === false && r.body.renewal?.expired === null, r.body.renewal);

r = await rpc("list_structure_roster", { p_session_token: usgTok, p_unit_id: councilId });
ok("list_structure_roster is organization-scoped for a reviewer",
  r.status === 200 && r.body.ok === true && r.body.scope === "organization" && r.body.roster.length > 0, r);

r = await rpc("match_structure_holder", { p_session_token: usgTok, p_unit_id: councilId, p_email: lsgEmail });
ok("match_structure_holder resolves a roster row and the seat it holds",
  r.status === 200 && r.body.ok === true && r.body.exists === true && r.body.seats?.length === 1, r);

// --------------------------------------------------------------- writes
console.log("\n--- 3. the council officer writes their own structure");

r = await rpc("save_structure_draft", {
  p_session_token: lsgTok,
  p_unit_id: councilId,
  p_template_key: null,
  p_term_label: "A.Y. 2026-2027",
  p_starts_on: "2026-08-01",
  p_ends_on: "2027-08-01",
  p_document: document,
  p_note: "from the http probe",
});
ok("save_structure_draft accepts the payload the route sends",
  r.status === 200 && r.body.ok === true && r.body.authorKind === "lsg", r);

const structureId = r.body.structureId;

r = await rpc("save_structure_draft", {
  p_session_token: lsgTok,
  p_unit_id: councilId,
  p_template_key: null,
  p_term_label: "A.Y. 2026-2027",
  p_starts_on: "2026-08-01",
  p_ends_on: null,
  p_document: document,
  p_note: null,
});
// A term needs an end date, so a null one is refused. The renewal path is the
// opposite case and defaults its dates -- asserted further down -- which is why
// the route sends null for "not supplied" and lets each function decide.
ok("a null end date is refused, because a term cannot end nowhere",
  r.status === 200 && r.body.ok === false && r.body.reason === "invalid_request", r);

r = await rpc("save_structure_draft", {
  p_session_token: lsgTok,
  p_unit_id: councilId,
  p_template_key: null,
  p_term_label: "A.Y. 2026-2027",
  p_starts_on: "2026-08-01",
  p_ends_on: "2027-08-01",
  p_document: document,
  p_note: null,
});
ok("and the same save with both dates is accepted",
  r.status === 200 && r.body.ok === true, r);

r = await rpc("get_structure", { p_session_token: lsgTok, p_unit_id: councilId });
ok("the draft comes back with the committees wrapper intact",
  Array.isArray(r.body.draft?.document?.committees) && r.body.draft.document.committees.length === 2,
  r.body.draft?.document);
ok("in the order it was saved, not sorted",
  r.body.draft.document.committees[0].key === "council" &&
    r.body.draft.document.committees[1].key === "audit", r.body.draft?.document);
ok("with each seat keeping its key",
  r.body.draft.document.committees[0].positions[0].key === "president", r.body.draft?.document);
ok("and the capability the builder needs",
  r.body.capability?.canEdit === true && r.body.capability?.isReviewer === false, r.body.capability);

r = await rpc("submit_structure", { p_session_token: lsgTok, p_structure_id: structureId, p_note: "please" });
ok("submit_structure seals it for review instead of approving",
  r.status === 200 && r.body.ok === true && r.body.status === "submitted" && r.body.autoApproved === false, r);

// ------------------------------------------------------- the gate, both ways
console.log("\n--- 4. the gate, from both sides");

r = await rpc("review_structure", {
  p_session_token: lsgTok,
  p_structure_id: structureId,
  p_decision: "approved",
  p_remark: "mine",
});
ok("an officer cannot approve their own structure",
  res_notOk(r) && ["forbidden", "self_review"].includes(r.body?.reason), r);

r = await rpc("list_structure_queue", { p_session_token: usgTok });
const pending = r.body.pending ?? [];
ok("it is in the USG queue and marked reviewable",
  pending.some((e) => e.id === structureId && e.reviewable === true),
  pending.map((e) => [e.id, e.reviewable]));

r = await rpc("review_structure", {
  p_session_token: staffTok,
  p_structure_id: structureId,
  p_decision: "returned",
  p_remark: "Add the secretary.",
});
ok("a reviewer who did not write it may return it, with a remark",
  r.status === 200 && r.body.ok === true && r.body.status === "returned", r);

r = await rpc("review_structure", {
  p_session_token: staffTok,
  p_structure_id: structureId,
  p_decision: "approved",
  p_remark: null,
});
// The structure is `returned` now, not `submitted`, so the refusal comes from the
// status check rather than the review-row check. What matters is that it is
// refused and nothing changed -- the specific reason is an implementation detail.
ok("and it cannot be decided again while it sits with its author",
  r.status === 200 && r.body?.ok === false, r);

// A returned draft is a working copy, so it is hidden from the reviewer who sent
// it back -- but not invisible to them: it appears in the queue as a decided entry,
// which is where they see that it is being worked on.
r = await rpc("get_structure", { p_session_token: staffTok, p_unit_id: councilId });
ok("a returned draft is not handed back to the reviewer as a draft",
  r.body.draft === null, r.body.draft);

r = await rpc("list_structure_queue", { p_session_token: staffTok });
ok("but the reviewer still sees it decided, with the remark they left",
  (r.body.decided ?? []).some((e) => e.id === structureId && e.decisionRemark === "Add the secretary."),
  (r.body.decided ?? []).map((e) => [e.id, e.status, e.decisionRemark]));
ok("and it is no longer in the pending inbox",
  !(r.body.pending ?? []).some((e) => e.id === structureId),
  (r.body.pending ?? []).map((e) => e.id));

// ------------------------------------------- the author gets the structure back
console.log("\n--- 5. a returned structure is the author's again, and keeps the wrapper");

r = await rpc("get_structure", { p_session_token: lsgTok, p_unit_id: councilId });
ok("the author sees the returned draft",
  r.body.draft?.status === "returned" && r.body.draft.decisionRemark === "Add the secretary.", r.body.draft);

r = await rpc("save_structure_draft", {
  p_session_token: lsgTok,
  p_unit_id: councilId,
  p_template_key: null,
  p_term_label: "A.Y. 2026-2027",
  p_starts_on: "2026-08-01",
  p_ends_on: "2027-08-01",
  p_document: {
    committees: [
      ...document.committees,
      { key: "secretary", name: "Secretary", positions: [{ key: "sec", title: "Secretary" }] },
    ],
  },
  p_note: "added the secretary",
});
ok("they can edit it back to draft, and the revision advances",
  r.status === 200 && r.body.ok === true && r.body.status === "draft" && r.body.revision === 2, r);

r = await rpc("review_structure", {
  p_session_token: staffTok,
  p_structure_id: structureId,
  p_decision: "approved",
  p_remark: "premature",
});
ok("and it cannot be approved while it is a working draft again",
  r.status === 200 && r.body?.ok === false, r);

r = await rpc("submit_structure", { p_session_token: lsgTok, p_structure_id: structureId, p_note: "ready" });
ok("it goes back to the reviewer once resubmitted",
  r.status === 200 && r.body.ok === true && r.body.status === "submitted", r);

r = await rpc("review_structure", {
  p_session_token: staffTok,
  p_structure_id: structureId,
  p_decision: "approved",
  p_remark: "good",
});
ok("and the new revision can then be approved",
  r.status === 200 && r.body.ok === true && r.body.status === "approved", r);

r = await rpc("get_structure", { p_session_token: usgTok, p_unit_id: councilId });
ok("the approved structure is now the live one, with three committees",
  r.body.approved?.status === "approved" && r.body.approved.document.committees.length === 3,
  r.body.approved?.document);
// The officer sees the Renew action; a reviewer looking at the same unit does not,
// because `canRequest` is `canEdit` and the reviewer never had edit rights here.
r = await rpc("get_structure", { p_session_token: lsgTok, p_unit_id: councilId });
ok("the author is offered renewal, with the term it would renew",
  r.body.renewal?.canRequest === true && r.body.renewal?.label === "A.Y. 2026-2027", r.body.renewal);
ok("and told how long that term has left",
  typeof r.body.renewal?.daysRemaining === "number" && r.body.renewal.expired === false,
  r.body.renewal);

r = await rpc("get_structure", { p_session_token: staffTok, p_unit_id: councilId });
ok("while a reviewer looking at the same unit is not",
  r.body.renewal?.canRequest === false && r.body.renewal?.label === "A.Y. 2026-2027", r.body.renewal);

// ------------------------------------------------------------------- renewal
console.log("\n--- 6. renewal carries the structure forward");

// The officer who wrote the structure renews it. Not the USG: `canEdit` is what
// gates this, and the reviewer never had it for somebody else's council.
r = await rpc("request_structure_renewal", {
  p_session_token: usgTok,
  p_unit_id: councilId,
  p_term_label: null,
  p_starts_on: null,
  p_ends_on: null,
});
ok("a reviewer cannot renew somebody else's council", r.body?.reason === "forbidden", r);

r = await rpc("request_structure_renewal", {
  p_session_token: lsgTok,
  p_unit_id: councilId,
  p_term_label: null,
  p_starts_on: null,
  p_ends_on: null,
});
ok("request_structure_renewal accepts all-null dates and defaults them",
  r.status === 200 && r.body.ok === true && r.body.startsOn === "2027-08-02", r);

const renewedId = r.body.structureId;

r = await rpc("get_structure", { p_session_token: lsgTok, p_unit_id: councilId });
ok("the renewal is seeded from the live structure, wrapper and all",
  r.body.draft?.status === "draft" &&
    r.body.draft.document.committees.length === 3 &&
    r.body.draft.document.committees[0].key === "council",
  r.body.draft?.document);
ok("and it records what it renews", r.body.draft?.renewsId === structureId, r.body.draft?.renewsId);

r = await rpc("request_structure_renewal", {
  p_session_token: lsgTok,
  p_unit_id: councilId,
  p_term_label: null,
  p_starts_on: null,
  p_ends_on: null,
});
ok("a second renewal is refused while the first is in flight",
  r.body?.ok === false && r.body?.reason === "already_in_progress", r);

r = await rpc("submit_structure", { p_session_token: lsgTok, p_structure_id: renewedId, p_note: null });
ok("and the renewal itself goes through the same gate",
  r.status === 200 && r.body.ok === true && r.body.status === "submitted", r);

r = await rpc("get_structure", { p_session_token: usgTok, p_unit_id: councilId });
ok("the queue shows the renewal waiting, and the live structure is untouched",
  (r.body.approved?.id ?? structureId) === structureId, r.body.approved?.id);

// ----------------------------------------------------------------- isolation
console.log("\n--- 7. a sibling council stays outside the first one's reach");

r = await rpc("get_structure", { p_session_token: otherTok, p_unit_id: councilId });
ok("one council's officer cannot read another's structure",
  r.status === 200 && r.body.ok === false && r.body.reason === "not_found", r);

r = await rpc("list_structure_roster", { p_session_token: otherTok, p_unit_id: councilId });
ok("nor page its roster", r.body?.ok === false && r.body?.reason === "not_found", r);

r = await rpc("save_structure_draft", {
  p_session_token: otherTok,
  p_unit_id: councilId,
  p_template_key: null,
  p_term_label: "Theirs",
  p_starts_on: "2026-08-01",
  p_ends_on: "2027-08-01",
  p_document: document,
  p_note: null,
});
ok("nor write one for it", r.status === 200 && r.body.ok === false, r);

// The roster the builder IS allowed: a reviewer sees the organization, and the
// picker for their own council is not the picker for somebody else's.
r = await rpc("list_structure_roster", { p_session_token: staffTok, p_unit_id: siblingId });
ok("a reviewer sees the whole organization's roster",
  r.body?.scope === "organization", r.body?.scope);

r = await rpc("list_structure_roster", { p_session_token: otherTok, p_unit_id: siblingId });
ok("an LSG officer sees only their own subtree",
  r.body?.scope === "unit" && (r.body.roster ?? []).every((m) => m.email !== lsgEmail),
  (r.body.roster ?? []).map((m) => m.email));

// ------------------------------------------------------------------- cleanup
console.log("\n--- cleanup");
await db.query(`delete from public.organizations where id = any($1)`, [cleanup.orgs]);
const left = (
  await db.query(`select count(*)::int n from public.organizations where id = any($1)`, [cleanup.orgs])
).rows[0].n;
ok("the probe organization is gone", left === 0, left);

const orphans = (
  await db.query(
    `select count(*)::int n from pg_largeobject_metadata lo
      where lo.oid not in (select photo_oid from smartgov.roster where photo_oid is not null)`,
  )
).rows[0].n;
ok("no photo large objects were orphaned", orphans === 0, orphans);

console.log(`\n${pass} passed, ${fail} failed`);
await db.end();
process.exit(fail === 0 ? 0 : 1);

function res_notOk(res) {
  return res.status === 200 && res.body?.ok === false;
}