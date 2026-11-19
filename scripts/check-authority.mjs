import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const BASE = process.env.AUTH_BASE_URL ?? "http://localhost:3000";
const CREDENTIALS = "C:/Users/Julius M. Matro/Desktop/sir tonie projects/credentials/smartgov-test-accounts.txt";

let checks = 0;
let failures = 0;

function check(label, condition, detail = "") {
  checks += 1;
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`);
  }
}

function parseEnv() {
  const out = {};
  const text = readFileSync(path.join(ROOT, ".env.local"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    out[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return out;
}

function parseCredentials() {
  const text = readFileSync(CREDENTIALS, "utf8");
  const password = text.match(/Password for every account:\s*(\S+)/i)?.[1] ?? "";
  const emails = {};
  for (const line of text.split(/\r?\n/)) {
    const email = line.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0];
    if (!email) continue;
    if (/^\s*Owner\s*\/\s*Founder/i.test(line)) emails.owner = email;
    else if (/^\s*President\s+Pedro/i.test(line)) emails.pedro = email;
    else if (/^\s*President\s+Carlo/i.test(line)) emails.carlo = email;
    else if (/^\s*President\s+Juan/i.test(line)) emails.reviewer = email;
    else if (/^\s*Member\s+Bea/i.test(line)) emails.member = email;
  }
  if (!password || Object.keys(emails).length < 5) {
    throw new Error("Fixture credentials are missing expected accounts.");
  }
  return { password, emails };
}

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  const token = setCookie.match(/sgov_session=([^;]+)/)?.[1] ?? "";
  if (!res.ok || !token) throw new Error(`Login failed for ${email}.`);
  return token;
}

async function get(pathname, cookie) {
  return fetch(`${BASE}${pathname}`, {
    headers: cookie ? { cookie: `sgov_session=${cookie}` } : undefined,
    redirect: "manual",
  });
}

async function patch(pathname, cookie, body) {
  return fetch(`${BASE}${pathname}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie: `sgov_session=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function post(pathname, cookie, body) {
  return fetch(`${BASE}${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie: `sgov_session=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function main() {
  const env = parseEnv();
  const { password, emails } = parseCredentials();
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  console.log("Session and direct-boundary checks");
  const owner = await login(emails.owner, password);
  const pedro = await login(emails.pedro, password);
  const carlo = await login(emails.carlo, password);
  const member = await login(emails.member, password);
  const reviewer = await login(emails.reviewer, password);
  check(
    "five fixture roles authenticate",
    Boolean(owner && pedro && carlo && member && reviewer),
  );

  const unauthRpc = await supabase.rpc("list_requirement_answer_versions", {
    p_session_token: "invalid-token",
    p_requirement_id: "00000000-0000-0000-0000-000000000000",
    p_unit_id: null,
  });
  check(
    "invalid token fails closed at RPC",
    unauthRpc.data?.ok === false && unauthRpc.data?.reason === "unauthenticated",
    JSON.stringify(unauthRpc.data ?? unauthRpc.error),
  );

  const direct = await supabase.from("accounts").select("id").limit(1);
  check("direct anon table read is denied", Boolean(direct.error), JSON.stringify(direct.error));

  let ownerId = "";
  let engineering = "";
  let education = "";
  let positionId = "";
  const forgedId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("begin");

    const base = await client.query(
      `select a.id as owner_id, a.organization_id
         from smartgov.accounts a
        where a.email = $1`,
      [emails.owner],
    );
    ownerId = base.rows[0].owner_id;
    const orgId = base.rows[0].organization_id;
    check("fixture owner resolves to one organization", Boolean(ownerId && orgId));

    const units = await client.query(
      `select gu.id, gu.name
         from public.governance_units gu
        where gu.organization_id = $1
          and gu.name in ('College of Engineering', 'College of Education')`,
      [orgId],
    );
    engineering = units.rows.find((row) => row.name === "College of Engineering")?.id;
    education = units.rows.find((row) => row.name === "College of Education")?.id;
    check("two distinct LSG units resolve", Boolean(engineering && education && engineering !== education));

    const chartPosition = await client.query(
      `insert into smartgov.org_positions (organization_id, label, sort_order)
       values ($1, $2, $3) returning id`,
      [orgId, `Authority test position ${Date.now()}`, 32000],
    );
    positionId = chartPosition.rows[0].id;
    await client.query(
      `insert into smartgov.unit_positions (unit_id, position_id)
       values ($1, $2) on conflict do nothing`,
      [engineering, positionId],
    );
    check("fixture org-chart position resolves", Boolean(positionId));

    const taskA = await client.query(
      `insert into smartgov.tasks (organization_id, title, created_by)
       values ($1, 'Authority test engineering', $2) returning id`,
      [orgId, ownerId],
    );
    const taskB = await client.query(
      `insert into smartgov.tasks (organization_id, title, created_by)
       values ($1, 'Authority test education', $2) returning id`,
      [orgId, ownerId],
    );
    const requirementA = await client.query(
      `insert into smartgov.task_requirements (task_id, label)
       values ($1, 'Authority test requirement A') returning id`,
      [taskA.rows[0].id],
    );
    const requirementB = await client.query(
      `insert into smartgov.task_requirements (task_id, label)
       values ($1, 'Authority test requirement B') returning id`,
      [taskB.rows[0].id],
    );

    await client.query(
      `insert into smartgov.task_assignments (task_id, unit_id) values ($1, $2), ($3, $4)`,
      [taskA.rows[0].id, engineering, taskB.rows[0].id, education],
    );
    await client.query(
      `insert into smartgov.task_requirement_answer_versions (requirement_id, unit_id, version)
       values ($1, $2, 1), ($3, $4, 1)`,
      [requirementA.rows[0].id, engineering, requirementB.rows[0].id, education],
    );

    const call = async (fn, args) => {
      const placeholders = args.map((_, index) => `$${index + 1}`).join(",");
      const result = await client.query(`select ${fn}(${placeholders}) as result`, args);
      return result.rows[0].result;
    };

    console.log("T1 LSG A versus LSG B isolation");
    const versionsOwn = await call("smartgov.list_requirement_answer_versions", [pedro, requirementA.rows[0].id, engineering]);
    check("LSG reads own unit versions", versionsOwn.ok === true && versionsOwn.versions?.length === 1, JSON.stringify(versionsOwn));

    const versionsOther = await call("smartgov.list_requirement_answer_versions", [pedro, requirementB.rows[0].id, education]);
    check("LSG cannot read other unit versions", versionsOther.ok === false && versionsOther.reason === "forbidden", JSON.stringify(versionsOther));

    const versionsCarlo = await call("smartgov.list_requirement_answer_versions", [carlo, requirementB.rows[0].id, education]);
    check("second LSG reads its own unit versions", versionsCarlo.ok === true && versionsCarlo.versions?.length === 1, JSON.stringify(versionsCarlo));

    const versionsOwner = await call("smartgov.list_requirement_answer_versions", [owner, requirementA.rows[0].id, null]);
    check("owner reads across units", versionsOwner.ok === true && versionsOwner.versions?.length === 1, JSON.stringify(versionsOwner));

    const versionsMember = await call("smartgov.list_requirement_answer_versions", [member, requirementA.rows[0].id, null]);
    check("non-reviewer member sees only own unit versions", versionsMember.ok === true && versionsMember.versions?.length === 1, JSON.stringify(versionsMember));

    const tasksPedro = await call("smartgov.list_my_tasks", [pedro, null]);
    const pedroIds = (tasksPedro.tasks ?? []).map((task) => task.id);
    check("LSG task list includes own task only", pedroIds.includes(taskA.rows[0].id) && !pedroIds.includes(taskB.rows[0].id));

    const tasksCarlo = await call("smartgov.list_my_tasks", [carlo, null]);
    const carloIds = (tasksCarlo.tasks ?? []).map((task) => task.id);
    check("other LSG task list includes own task only", carloIds.includes(taskB.rows[0].id) && !carloIds.includes(taskA.rows[0].id));

    const detailPedro = await call("smartgov.task_detail", [pedro, taskB.rows[0].id]);
    check("LSG cannot detail another unit task", detailPedro.ok === false, JSON.stringify(detailPedro));

    const detailOwner = await call("smartgov.task_detail", [owner, taskB.rows[0].id]);
    check("owner can detail either unit task", detailOwner.ok === true, JSON.stringify(detailOwner));

    console.log("T2 LSG cannot USG actions");
    const officerList = await call("smartgov.list_officers", [pedro]);
    check("LSG cannot list officers", officerList.ok === false && officerList.reason === "forbidden", JSON.stringify(officerList));

    const auditList = await call("smartgov.list_audit_log", [pedro, 10]);
    check("LSG cannot read audit log", auditList.ok === false && auditList.reason === "forbidden", JSON.stringify(auditList));

    const lsgAddPosition = await call("smartgov.add_position", [pedro, "Authority test LSG position", 0]);
    check("LSG cannot add org-chart positions", lsgAddPosition.ok === false && lsgAddPosition.reason === "forbidden", JSON.stringify(lsgAddPosition));

    const lsgToggle = await call("smartgov.toggle_unit_position", [pedro, engineering, positionId, true]);
    check("LSG cannot toggle unit seats", lsgToggle.ok === false && lsgToggle.reason === "forbidden", JSON.stringify(lsgToggle));

    const lsgAssign = await call("smartgov.assign_officer", [pedro, engineering, positionId, forgedId]);
    check("LSG cannot assign seats", lsgAssign.ok === false && lsgAssign.reason === "forbidden", JSON.stringify(lsgAssign));

    const lsgRelease = await call("smartgov.release_officer", [pedro, forgedId]);
    check("LSG cannot release seats", lsgRelease.ok === false && lsgRelease.reason === "forbidden", JSON.stringify(lsgRelease));

    console.log("T4 forged identifiers");
    const forgedSurvey = await call("smartgov.create_survey_otp", ["00000000-0000-0000-0000-000000000000", emails.member]);
    check("forged survey id is rejected", forgedSurvey.ok === false && forgedSurvey.reason === "not_found", JSON.stringify(forgedSurvey));

    const forgedVersionUnit = await call("smartgov.list_requirement_answer_versions", [pedro, requirementA.rows[0].id, education]);
    check("forged unit id cannot widen LSG scope", forgedVersionUnit.ok === false && forgedVersionUnit.reason === "forbidden", JSON.stringify(forgedVersionUnit));

    const forgedToggleUnit = await call("smartgov.toggle_unit_position", [owner, forgedId, positionId, true]);
    check("forged unit id cannot toggle a seat", forgedToggleUnit.ok === false && forgedToggleUnit.reason === "not_found", JSON.stringify(forgedToggleUnit));

    const forgedTogglePosition = await call("smartgov.toggle_unit_position", [owner, engineering, forgedId, true]);
    check("forged position id cannot toggle a seat", forgedTogglePosition.ok === false && forgedTogglePosition.reason === "not_found", JSON.stringify(forgedTogglePosition));

    const forgedAssignRoster = await call("smartgov.assign_officer", [owner, engineering, positionId, forgedId]);
    check("forged roster id cannot be assigned to a seat", forgedAssignRoster.ok === false && forgedAssignRoster.reason === "not_found", JSON.stringify(forgedAssignRoster));

    const forgedRelease = await call("smartgov.release_officer", [owner, forgedId]);
    check("forged membership id cannot release a seat", forgedRelease.ok === false && forgedRelease.reason === "not_found", JSON.stringify(forgedRelease));

    console.log("T5 last owner protection");
    const selfDeactivateResult = await client.query(
      `select smartgov.deactivate_officer($1::text, $2::uuid, $3::text, $4::text, null::timestamptz, null::timestamptz) as result`,
      [owner, ownerId, "authority test", null],
    );
    const selfDeactivate = selfDeactivateResult.rows[0].result;
    check("owner cannot deactivate self", selfDeactivate.ok === false && selfDeactivate.reason === "forbidden", JSON.stringify(selfDeactivate));

    const selfPurgeResult = await client.query(
      `select smartgov.purge_officer($1::text, $2::uuid, $3::text) as result`,
      [owner, ownerId, emails.owner],
    );
    const selfPurge = selfPurgeResult.rows[0].result;
    check("owner cannot purge self", selfPurge.ok === false && selfPurge.reason === "forbidden", JSON.stringify(selfPurge));
  } finally {
    await client.query("rollback");
    await client.end();
  }

  console.log("HTTP role boundaries");
  const httpOfficers = await get("/api/officers", pedro);
  check("LSG API cannot list officers", httpOfficers.status === 403, `got ${httpOfficers.status}`);

  const httpInvites = await get("/api/invites", pedro);
  check("LSG API cannot list invites", httpInvites.status === 403, `got ${httpInvites.status}`);

  const httpAudit = await get("/api/audit-log", pedro);
  check("LSG API cannot read audit log", httpAudit.status === 403, `got ${httpAudit.status}`);

  const httpPurge = await post(`/api/officers/${ownerId}/purge`, owner, { confirmEmail: emails.owner });
  check("owner HTTP self-purge is denied", httpPurge.status === 403, `got ${httpPurge.status}`);

  const httpAnonOverview = await get("/api/overview");
  check("anonymous API is denied", httpAnonOverview.status === 401, `got ${httpAnonOverview.status}`);

  console.log("Org-chart boundaries");
  const chartWrites = [
    ["add a position", "/api/org-chart/position", { label: "Authority test", sortOrder: 0 }],
    ["toggle a unit seat", "/api/org-chart/unit-position", { unitId: engineering, positionId, enabled: true }],
    ["invite to a seat", "/api/org-chart/invite", { email: emails.member, unitType: "lsg", unitId: engineering, positionId }],
    ["assign a seat", "/api/org-chart/assign", { unitId: engineering, positionId, rosterId: forgedId }],
    ["release a seat", "/api/org-chart/release", { membershipId: forgedId }],
  ];
  for (const [label, route, body] of chartWrites) {
    const lsgWrite = await post(route, pedro, body);
    check(`LSG API cannot ${label}`, lsgWrite.status === 403, `got ${lsgWrite.status}`);
    const anonWrite = await post(route, "", body);
    check(`anonymous API cannot ${label}`, anonWrite.status === 401, `got ${anonWrite.status}`);
  }

  const ownerChartPage = await get("/org-chart", owner);
  check("owner can open the org chart", ownerChartPage.status === 200, `got ${ownerChartPage.status}`);
  const lsgChartPage = await get("/org-chart", pedro);
  check("LSG is redirected out of the owner chart", lsgChartPage.status === 307, `got ${lsgChartPage.status}`);
  const anonChartPage = await get("/org-chart");
  check("anonymous is redirected out of the owner chart", anonChartPage.status === 307, `got ${anonChartPage.status}`);

  console.log("Resolution boundaries");
  const createdResolutions = [];
  const createResolution = async (cookie, body) => {
    const res = await post("/api/resolutions", cookie, body);
    const json = await res.json().catch(() => ({}));
    if (typeof json.id === "string") createdResolutions.push(json.id);
    return { status: res.status, json };
  };
  try {
    const anonList = await get("/api/resolutions");
    check("anonymous API cannot list resolutions", anonList.status === 401, `got ${anonList.status}`);
    const anonCreate = await post("/api/resolutions", "", {
      title: "Authority test resolution",
      body: "Authority test body text for an anonymous caller.",
    });
    check("anonymous API cannot create a resolution", anonCreate.status === 401, `got ${anonCreate.status}`);
    const anonDetail = await get(`/api/resolutions/${forgedId}`);
    check("anonymous API cannot read a resolution", anonDetail.status === 401, `got ${anonDetail.status}`);
    const anonReview = await post(`/api/resolutions/${forgedId}/review`, "", { decision: "under_review" });
    check("anonymous API cannot review a resolution", anonReview.status === 401, `got ${anonReview.status}`);

    const ownerCreate = await createResolution(owner, {
      title: "Authority test org resolution",
      body: "Authority test body text for the organisation.",
    });
    check(
      "USG owner can create a resolution",
      ownerCreate.status === 200 && ownerCreate.json.ok === true && Boolean(ownerCreate.json.id),
      JSON.stringify(ownerCreate.json),
    );

    const engCreate = await createResolution(pedro, {
      title: "Authority test engineering resolution",
      body: "Authority test body text for the engineering unit.",
    });
    check(
      "LSG officer can create a unit resolution",
      engCreate.status === 200 && engCreate.json.ok === true && Boolean(engCreate.json.id),
      JSON.stringify(engCreate.json),
    );

    const eduCreate = await createResolution(carlo, {
      title: "Authority test education resolution",
      body: "Authority test body text for the education unit.",
    });
    check(
      "second LSG officer can create a unit resolution",
      eduCreate.status === 200 && eduCreate.json.ok === true && Boolean(eduCreate.json.id),
      JSON.stringify(eduCreate.json),
    );

    const engId = engCreate.json.id;
    const eduId = eduCreate.json.id;

    const pedroOwnDetail = await get(`/api/resolutions/${engId}`, pedro);
    check("LSG officer can read own-unit resolution", pedroOwnDetail.status === 200, `got ${pedroOwnDetail.status}`);
    const pedroOtherDetail = await get(`/api/resolutions/${eduId}`, pedro);
    check("LSG officer cannot read another unit resolution", pedroOtherDetail.status === 404, `got ${pedroOtherDetail.status}`);
    const carloOtherDetail = await get(`/api/resolutions/${engId}`, carlo);
    check("second LSG officer cannot read another unit resolution", carloOtherDetail.status === 404, `got ${carloOtherDetail.status}`);
    const ownerAnyDetail = await get(`/api/resolutions/${eduId}`, owner);
    check("USG owner can read any unit resolution", ownerAnyDetail.status === 200, `got ${ownerAnyDetail.status}`);
    const forgedDetail = await get(`/api/resolutions/${forgedId}`, owner);
    check("forged resolution id is not found", forgedDetail.status === 404, `got ${forgedDetail.status}`);
    const malformedDetail = await get("/api/resolutions/not-a-uuid", owner);
    check("malformed resolution id is refused", malformedDetail.status === 400, `got ${malformedDetail.status}`);
    const malformedReview = await post("/api/resolutions/not-a-uuid/review", owner, { decision: "under_review" });
    check("malformed resolution review id is refused", malformedReview.status === 400, `got ${malformedReview.status}`);

    const pedroList = await get("/api/resolutions", pedro);
    const pedroListJson = await pedroList.json().catch(() => ({}));
    const pedroIds = (pedroListJson.rows ?? []).map((row) => row.id);
    check(
      "LSG list includes own-unit resolution only",
      pedroList.status === 200 && pedroIds.includes(engId) && !pedroIds.includes(eduId),
      JSON.stringify({ status: pedroList.status, ids: pedroIds }),
    );

    const pedroReview = await post(`/api/resolutions/${engId}/review`, pedro, { decision: "under_review" });
    check("LSG officer cannot review a resolution", pedroReview.status === 403, `got ${pedroReview.status}`);

    const ownerReview = await post(`/api/resolutions/${engId}/review`, owner, { decision: "under_review" });
    const ownerReviewJson = await ownerReview.json().catch(() => ({}));
    check(
      "USG owner can review a resolution",
      ownerReview.status === 200 && ownerReviewJson.ok === true,
      JSON.stringify(ownerReviewJson),
    );

    const returnWithoutRemark = await post(`/api/resolutions/${engId}/review`, owner, { decision: "returned" });
    check("returning a resolution requires a remark", returnWithoutRemark.status === 400, `got ${returnWithoutRemark.status}`);
  } finally {
    if (createdResolutions.length) {
      const cleanup = new pg.Client({ connectionString: env.DATABASE_URL });
      await cleanup.connect();
      try {
        await cleanup.query("delete from smartgov.resolutions where id = any($1::uuid[])", [createdResolutions]);
      } finally {
        await cleanup.end();
      }
    }
  }

  console.log("Document catalog boundaries");
  const docClient = new pg.Client({ connectionString: env.DATABASE_URL });
  await docClient.connect();
  let docProposalId = "";
  let docRequirementId = "";
  let docStoragePath = "";
  let docOid = null;
  let docResolutionId = "";
  const docMarker = `Authority catalog fixture ${Date.now()}`;
  const docBytes = "authority catalog bytes";
  try {
    const ownerOrg = await docClient.query(
      `select a.id as owner_id, a.organization_id
         from smartgov.accounts a
        where a.email = $1`,
      [emails.owner],
    );
    const orgId = ownerOrg.rows[0].organization_id;
    const pedroAccount = await docClient.query(
      `select id from smartgov.accounts where email = $1`,
      [emails.pedro],
    );
    const pedroId = pedroAccount.rows[0].id;

    const item = await docClient.query(
      `insert into smartgov.requirement_items (organization_id, label, item_kind)
       values ($1, $2, 'file') returning id`,
      [orgId, `${docMarker} requirement`],
    );
    docRequirementId = item.rows[0].id;

    const proposal = await docClient.query(
      `insert into smartgov.proposals
         (organization_id, unit_id, author_kind, created_by, title, description)
       values ($1, $2, 'lsg', $3, $4, 'Authority fixture proposal')
       returning id`,
      [orgId, engineering, pedroId, `${docMarker} proposal`],
    );
    docProposalId = proposal.rows[0].id;

    const version = await docClient.query(
      `insert into smartgov.proposal_versions (proposal_id, version_number, submitted_by)
       values ($1, 1, $2) returning id`,
      [docProposalId, pedroId],
    );

    const oid = await docClient.query(
      `select lo_from_bytea(0, convert_to($1, 'UTF8')) as oid`,
      [docBytes],
    );
    docOid = oid.rows[0].oid;

    docStoragePath = `authority-doc-${Date.now()}.txt`;
    await docClient.query(
      `insert into smartgov.document_uploads
         (storage_path, organization_id, uploaded_by, requirement_item,
          original_name, mime_type, size_bytes, large_object_oid, confirmed_at)
       values ($1, $2, $3, $4, 'authority-doc.txt', 'text/plain', $5, $6, now())`,
      [docStoragePath, orgId, pedroId, docRequirementId, docBytes.length, docOid],
    );
    const submission = await docClient.query(
      `insert into smartgov.item_submissions
         (version_id, requirement_item_id, submission_kind, storage_path,
          original_name, mime_type, size_bytes)
       values ($1, $2, 'file', $3, 'authority-doc.txt', 'text/plain', $4)
       returning id`,
      [version.rows[0].id, docRequirementId, docStoragePath, docBytes.length],
    );
    const docId = submission.rows[0].id;

    const anonList = await get("/api/documents");
    check("anonymous API cannot search documents", anonList.status === 401, `got ${anonList.status}`);
    const anonPatch = await patch(`/api/documents/${docId}`, "", { title: "Nope" });
    check("anonymous API cannot edit document metadata", anonPatch.status === 401, `got ${anonPatch.status}`);
    const anonApprove = await post(`/api/documents/${docId}/approve`, "", { decision: "approved" });
    check("anonymous API cannot approve a document", anonApprove.status === 401, `got ${anonApprove.status}`);

    const pedroList = await get("/api/documents", pedro);
    const pedroListJson = await pedroList.json().catch(() => ({}));
    check(
      "LSG officer sees the own-unit document",
      pedroList.status === 200 &&
        (pedroListJson.rows ?? []).some((row) => row.submissionId === docId),
      JSON.stringify({ status: pedroList.status, rows: (pedroListJson.rows ?? []).length }),
    );

    const carloBefore = await get("/api/documents", carlo);
    const carloBeforeJson = await carloBefore.json().catch(() => ({}));
    check(
      "other LSG officer cannot see a pending document",
      carloBefore.status === 200 &&
        !(carloBeforeJson.rows ?? []).some((row) => row.submissionId === docId),
      JSON.stringify({ status: carloBefore.status }),
    );

    const ownPatch = await patch(`/api/documents/${docId}`, pedro, {
      title: docMarker,
      description: "Authority catalog description",
      keywords: "authority, catalog",
      groupKind: "resolution",
      groupLabel: docMarker,
    });
    check("filing officer can edit document metadata", ownPatch.status === 200, `got ${ownPatch.status}`);

    const docResolution = await docClient.query(
      `insert into smartgov.resolutions
         (organization_id, unit_id, created_by, title, body, scope, status)
       values ($1,$2,$3,$4,$5,'unit','submitted') returning id`,
      [orgId, engineering, pedroId, `${docMarker} linked resolution`, "Authority linked resolution body"],
    );
    docResolutionId = docResolution.rows[0].id;
    await docClient.query(
      `update smartgov.document_catalog
          set group_kind = 'resolution', group_id = $1, group_label = $2
        where submission_id = $3`,
      [docResolutionId, `${docMarker} linked`, docId],
    );
    const linkagePatch = await patch(`/api/documents/${docId}`, pedro, {
      title: docMarker,
      description: "Authority catalog description",
      keywords: "authority, catalog",
      groupKind: "resolution",
      groupLabel: docMarker,
    });
    const linkageRow = await docClient.query(
      `select group_kind, group_id from smartgov.document_catalog where submission_id = $1`,
      [docId],
    );
    check(
      "metadata edit preserves the existing resolution linkage",
      linkagePatch.status === 200 &&
        linkageRow.rows[0]?.group_kind === "resolution" &&
        linkageRow.rows[0]?.group_id === docResolutionId,
      JSON.stringify({ status: linkagePatch.status, row: linkageRow.rows[0] }),
    );
    const kindlessPatch = await patch(`/api/documents/${docId}`, pedro, { title: docMarker });
    const kindlessRow = await docClient.query(
      `select group_kind, group_id from smartgov.document_catalog where submission_id = $1`,
      [docId],
    );
    check(
      "metadata edit without a kind preserves the existing linkage",
      kindlessPatch.status === 200 &&
        kindlessRow.rows[0]?.group_kind === "resolution" &&
        kindlessRow.rows[0]?.group_id === docResolutionId,
      JSON.stringify({ status: kindlessPatch.status, row: kindlessRow.rows[0] }),
    );

    const reviewerSearch = await get(
      `/api/documents?q=${encodeURIComponent(docMarker)}`,
      reviewer,
    );
    const reviewerSearchJson = await reviewerSearch.json().catch(() => ({}));
    check(
      "non-owner USG reviewer can search pending documents",
      reviewerSearch.status === 200 &&
        reviewerSearchJson.canApprove === true &&
        (reviewerSearchJson.rows ?? []).some((row) => row.submissionId === docId),
      JSON.stringify({
        status: reviewerSearch.status,
        canApprove: reviewerSearchJson.canApprove,
        rows: (reviewerSearchJson.rows ?? []).length,
      }),
    );

    const reviewerPatch = await patch(`/api/documents/${docId}`, reviewer, {
      title: docMarker,
      description: "Reviewer catalog description",
      keywords: "authority, catalog, reviewer",
      groupKind: "resolution",
      groupLabel: docMarker,
    });
    check(
      "non-owner USG reviewer can edit document metadata",
      reviewerPatch.status === 200,
      `got ${reviewerPatch.status}`,
    );


    const otherPatch = await patch(`/api/documents/${docId}`, carlo, { title: "Not yours" });
    check("another unit cannot edit document metadata", otherPatch.status === 403, `got ${otherPatch.status}`);

    const carloPendingDownload = await get(`/api/files/${docId}`, carlo);
    check(
      "other unit cannot download a pending document",
      carloPendingDownload.status === 400,
      `got ${carloPendingDownload.status}`,
    );

    const lsgApprove = await post(`/api/documents/${docId}/approve`, pedro, { decision: "approved" });
    check("LSG officer cannot approve a document", lsgApprove.status === 403, `got ${lsgApprove.status}`);

    const missingRemark = await post(`/api/documents/${docId}/approve`, owner, { decision: "rejected" });
    check("rejecting a document requires a remark", missingRemark.status === 400, `got ${missingRemark.status}`);

    const reviewerApprove = await post(`/api/documents/${docId}/approve`, reviewer, {
      decision: "approved",
    });
    check(
      "non-owner USG reviewer can approve a document",
      reviewerApprove.status === 200,
      `got ${reviewerApprove.status}`,
    );

    const ownerPending = await post(`/api/documents/${docId}/approve`, owner, {
      decision: "pending",
    });
    check("USG owner can return a document to pending", ownerPending.status === 200, `got ${ownerPending.status}`);

    const ownerApprove = await post(`/api/documents/${docId}/approve`, owner, { decision: "approved" });
    check("USG owner can approve a document", ownerApprove.status === 200, `got ${ownerApprove.status}`);

    const carloAfter = await get("/api/documents", carlo);
    const carloAfterJson = await carloAfter.json().catch(() => ({}));
    check(
      "approved catalog rows are visible organisation-wide",
      carloAfter.status === 200 &&
        (carloAfterJson.rows ?? []).some((row) => row.submissionId === docId && row.status === "approved"),
      JSON.stringify({ status: carloAfter.status }),
    );

    const carloSearch = await get(
      `/api/documents?q=${encodeURIComponent(docMarker)}`,
      carlo,
    );
    const carloSearchJson = await carloSearch.json().catch(() => ({}));
    check(
      "search finds the approved document by its title",
      carloSearch.status === 200 &&
        (carloSearchJson.rows ?? []).some((row) => row.submissionId === docId),
      JSON.stringify({ status: carloSearch.status }),
    );

    const carloDownload = await get(`/api/files/${docId}`, carlo);
    const carloBytes = await carloDownload.text().catch(() => "");
    check(
      "approved catalog rows are downloadable organisation-wide",
      carloDownload.status === 200 && carloBytes === docBytes,
      `got ${carloDownload.status}`,
    );
  } finally {
    if (docResolutionId) {
      await docClient.query("delete from smartgov.resolutions where id = $1", [docResolutionId]).catch(() => {});
    }
    if (docProposalId) {
      await docClient.query("delete from smartgov.proposals where id = $1", [docProposalId]).catch(() => {});
    }
    if (docRequirementId) {
      await docClient.query("delete from smartgov.requirement_items where id = $1", [docRequirementId]).catch(() => {});
    }
    if (docStoragePath) {
      await docClient.query("delete from smartgov.document_uploads where storage_path = $1", [docStoragePath]).catch(() => {});
    }
    if (docOid !== null) {
      await docClient.query("select lo_unlink($1)", [docOid]).catch(() => {});
    }
    await docClient.end();
  }

  console.log("Event budget boundaries");
  const budgetClient = new pg.Client({ connectionString: env.DATABASE_URL });
  await budgetClient.connect();
  const createdBudgets = [];
  const budgetEvents = [];
  let budgetProposalId = "";
  const budgetMarker = `Authority budget fixture ${Date.now()}`;
  try {
    const orgRow = await budgetClient.query(
      `select a.id as owner_id, a.organization_id,
              (select id from smartgov.accounts where email = $2) as pedro_id,
              (select id from smartgov.accounts where email = $3) as carlo_id
         from smartgov.accounts a
        where a.email = $1`,
      [emails.owner, emails.pedro, emails.carlo],
    );
    const orgId = orgRow.rows[0].organization_id;
    const ownerId = orgRow.rows[0].owner_id;
    const pedroId = orgRow.rows[0].pedro_id;
    const carloId = orgRow.rows[0].carlo_id;
    check("event budget fixtures resolve", Boolean(orgId && ownerId && pedroId && carloId));

    const makeEvent = async (title, scope, unitId) => {
      const row = await budgetClient.query(
        `insert into smartgov.events
           (organization_id, created_by, title, event_date, scope, unit_id, status, honor_status, source)
         values ($1, $2, $3, current_date + 30, $4, $5, 'upcoming', 'honored', 'usg')
         returning id`,
        [orgId, ownerId, title, scope, unitId],
      );
      budgetEvents.push(row.rows[0].id);
      return row.rows[0].id;
    };

    const engineeringEvent = await makeEvent(`${budgetMarker} engineering`, "unit", engineering);
    const educationEvent = await makeEvent(`${budgetMarker} education`, "unit", education);
    const universityEvent = await makeEvent(`${budgetMarker} university`, "university", null);

    const budgetItems = [
      { label: "Venue", quantity: "1", unit_cost: "1500" },
      { label: "Materials", quantity: "25", unit_cost: "40" },
    ];
    const budgetItemsJson = JSON.stringify(budgetItems);

    const callBudget = async (fn, args) => {
      const placeholders = args.map((_, index) => `$${index + 1}`).join(",");
      const result = await budgetClient.query(`select ${fn}(${placeholders}) as result`, args);
      return result.rows[0].result;
    };

    const anonBudget = await callBudget("smartgov.submit_event_budget", [
      "invalid-token",
      engineeringEvent,
      `${budgetMarker} anon`,
      "",
      budgetItemsJson,
    ]);
    check(
      "anonymous event budget is refused",
      anonBudget.ok === false && anonBudget.reason === "unauthenticated",
      JSON.stringify(anonBudget),
    );

    const wrongUnit = await callBudget("smartgov.submit_event_budget", [
      carlo,
      engineeringEvent,
      `${budgetMarker} wrong unit`,
      "",
      budgetItemsJson,
    ]);
    check(
      "LSG cannot budget an event addressed to another unit",
      wrongUnit.ok === false && wrongUnit.reason === "forbidden",
      JSON.stringify(wrongUnit),
    );

    const ownBudget = await callBudget("smartgov.submit_event_budget", [
      pedro,
      engineeringEvent,
      `${budgetMarker} engineering ask`,
      "Authority event budget",
      budgetItemsJson,
    ]);
    check(
      "LSG can budget its own unit's event",
      ownBudget.ok === true &&
        ownBudget.unitId === engineering &&
        ownBudget.eventId === engineeringEvent,
      JSON.stringify(ownBudget),
    );
    if (typeof ownBudget.budgetId === "string") createdBudgets.push(ownBudget.budgetId);

    const usgBudget = await callBudget("smartgov.submit_event_budget", [
      owner,
      universityEvent,
      `${budgetMarker} university ask`,
      "",
      budgetItemsJson,
    ]);
    check(
      "USG can budget a university event",
      usgBudget.ok === true && usgBudget.eventId === universityEvent,
      JSON.stringify(usgBudget),
    );
    if (typeof usgBudget.budgetId === "string") createdBudgets.push(usgBudget.budgetId);

    const pedroBudgetList = await callBudget("smartgov.list_budgets", [pedro]);
    const pedroBudgetRows = pedroBudgetList.budgets ?? [];
    const pedroEventRow = pedroBudgetRows.find((row) => row.id === ownBudget.budgetId);
    check(
      "LSG budget list carries its event link",
      Boolean(pedroEventRow) &&
        pedroEventRow.eventId === engineeringEvent &&
        typeof pedroEventRow.eventTitle === "string",
      JSON.stringify(pedroEventRow ?? {}),
    );
    check(
      "LSG budget list hides another unit's event budget",
      !pedroBudgetRows.some((row) => row.id === usgBudget.budgetId),
    );

    const carloDetail = await callBudget("smartgov.budget_detail", [carlo, ownBudget.budgetId]);
    check(
      "LSG cannot read another unit's event budget",
      carloDetail.ok === false && carloDetail.reason === "forbidden",
      JSON.stringify(carloDetail),
    );

    const ownerBudgetList = await callBudget("smartgov.list_budgets", [owner]);
    const ownerEventRow = (ownerBudgetList.budgets ?? []).find(
      (row) => row.id === ownBudget.budgetId,
    );
    check(
      "USG budget list carries the event title",
      Boolean(ownerEventRow) &&
        ownerEventRow.eventTitle === `${budgetMarker} engineering`,
      JSON.stringify(ownerEventRow ?? {}),
    );

    const proposal = await budgetClient.query(
      `insert into smartgov.proposals
         (organization_id, unit_id, author_kind, created_by, title, description)
       values ($1, $2, 'lsg', $3, $4, 'Authority fixture proposal')
       returning id`,
      [orgId, engineering, pedroId, `${budgetMarker} proposal`],
    );
    budgetProposalId = proposal.rows[0].id;

    let dualLinkCode = "";
    let dualLinkConstraint = "";
    try {
      await budgetClient.query(
        `insert into smartgov.budget_requests
           (organization_id, proposal_id, event_id, unit_id, requested_by, title)
         values ($1, $2, $3, $4, $5, $6)`,
        [orgId, budgetProposalId, engineeringEvent, engineering, pedroId, `${budgetMarker} dual`],
      );
    } catch (error) {
      dualLinkCode = error.code ?? "";
      dualLinkConstraint = error.constraint ?? "";
    }
    check(
      "a budget cannot link to a proposal and an event at once",
      dualLinkCode === "23514" && dualLinkConstraint === "budget_requests_single_link_check",
      JSON.stringify({ code: dualLinkCode, constraint: dualLinkConstraint }),
    );

    const anonHttp = await post("/api/budgets", "", {
      title: `${budgetMarker} http`,
      eventId: engineeringEvent,
      items: budgetItems,
    });
    check("anonymous API cannot submit an event budget", anonHttp.status === 401, `got ${anonHttp.status}`);

    const wrongUnitHttp = await post("/api/budgets", carlo, {
      title: `${budgetMarker} http`,
      eventId: engineeringEvent,
      items: budgetItems,
    });
    check(
      "LSG API cannot submit another unit's event budget",
      wrongUnitHttp.status === 403,
      `got ${wrongUnitHttp.status}`,
    );

    const educationHttp = await post("/api/budgets", carlo, {
      title: `${budgetMarker} http education`,
      eventId: educationEvent,
      items: budgetItems,
    });
    const educationHttpJson = await educationHttp.json().catch(() => ({}));
    check(
      "LSG API can submit its own unit's event budget",
      educationHttp.status === 200 &&
        educationHttpJson.ok === true &&
        educationHttpJson.eventId === educationEvent,
      JSON.stringify(educationHttpJson),
    );
    if (typeof educationHttpJson.budgetId === "string") {
      createdBudgets.push(educationHttpJson.budgetId);
    }

    const dualHttp = await post("/api/budgets", pedro, {
      title: `${budgetMarker} http`,
      proposalId: budgetProposalId,
      eventId: engineeringEvent,
      items: budgetItems,
    });
    check(
      "API refuses a budget linked to both a proposal and an event",
      dualHttp.status === 400,
      `got ${dualHttp.status}`,
    );

    const subtotalHttp = await post("/api/budgets", pedro, {
      title: `${budgetMarker} http`,
      eventId: engineeringEvent,
      items: [{ label: "Venue", quantity: "1", unit_cost: "10", subtotal: 1 }],
    });
    check(
      "API refuses a client-chosen subtotal",
      subtotalHttp.status === 400,
      `got ${subtotalHttp.status}`,
    );
  } finally {
    if (createdBudgets.length) {
      await budgetClient
        .query("delete from smartgov.budget_requests where id = any($1::uuid[])", [createdBudgets])
        .catch(() => {});
    }
    if (budgetProposalId) {
      await budgetClient
        .query("delete from smartgov.proposals where id = $1", [budgetProposalId])
        .catch(() => {});
    }
    if (budgetEvents.length) {
      await budgetClient
        .query("delete from smartgov.events where id = any($1::uuid[])", [budgetEvents])
        .catch(() => {});
    }
    await budgetClient.end();
  }


  console.log("Unified calendar boundaries");
  const calClient = new pg.Client({ connectionString: env.DATABASE_URL });
  await calClient.connect();
  const calEvents = [];
  const calProposals = [];
  const calMarker = `Authority calendar fixture ${Date.now()}`;
  const calMonth = "2099-01-01";
  const calDate = "2099-01-15";
  try {
    const ids = await calClient.query(
      `select a.id as owner_id, a.organization_id,
              (select id from smartgov.accounts where email = $2) as pedro_id,
              (select id from smartgov.accounts where email = $3) as carlo_id
         from smartgov.accounts a
        where a.email = $1`,
      [emails.owner, emails.pedro, emails.carlo],
    );
    const calOrgId = ids.rows[0].organization_id;
    const calOwnerId = ids.rows[0].owner_id;
    const calPedroId = ids.rows[0].pedro_id;
    const calCarloId = ids.rows[0].carlo_id;
    check("calendar fixtures resolve", Boolean(calOrgId && calOwnerId && calPedroId && calCarloId && engineering && education));

    const callCal = async (fn, args) => {
      const placeholders = args.map((_, index) => `$${index + 1}`).join(",");
      const result = await calClient.query(`select ${fn}(${placeholders}) as result`, args);
      return result.rows[0].result;
    };

    const anonCal = await callCal("smartgov.list_calendar", ["invalid-token", calMonth, 31]);
    check(
      "anonymous calendar request is denied",
      anonCal.ok === false && anonCal.reason === "unauthenticated",
      JSON.stringify(anonCal),
    );

    const impossibleMonth = await post("/api/feed", owner, { month: "2026-99-99", days: 42 });
    check("calendar API refuses an impossible month", impossibleMonth.status === 400, `got ${impossibleMonth.status}`);
    const midMonth = await post("/api/feed", owner, { month: "2026-11-15", days: 42 });
    check("calendar API refuses a day other than the first", midMonth.status === 400, `got ${midMonth.status}`);
    const firstOfMonth = await post("/api/feed", owner, { month: "2026-11-01", days: 42 });
    const firstOfMonthJson = await firstOfMonth.json().catch(() => ({}));
    check(
      "calendar API accepts a canonical month",
      firstOfMonth.status === 200 && firstOfMonthJson.ok === true,
      JSON.stringify({ status: firstOfMonth.status, ok: firstOfMonthJson.ok }),
    );

    const makeCalEvent = async (title, scope, unitId, status, honorStatus, cancelledAt = null, createdBy = calOwnerId, source = "usg") => {
      const row = await calClient.query(
        `insert into smartgov.events
           (organization_id, created_by, title, event_date, scope, unit_id, status, honor_status, source, cancelled_at)
         values ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10)
         returning id`,
        [calOrgId, createdBy, title, calDate, scope, unitId, status, honorStatus, source, cancelledAt],
      );
      calEvents.push(row.rows[0].id);
      return row.rows[0].id;
    };
    const makeCalProposal = async (title, unitId, status, createdBy = calPedroId) => {
      const row = await calClient.query(
        `insert into smartgov.proposals
           (organization_id, unit_id, author_kind, created_by, title, description, event_date, venue, status, activity_type)
         values ($1,$2,'lsg',$3,$4,'Calendar fixture',$5::date,'Hall',$6,'academic')
         returning id`,
        [calOrgId, unitId, createdBy, title, calDate, status],
      );
      calProposals.push(row.rows[0].id);
      return row.rows[0].id;
    };

    const engEvent = await makeCalEvent(`${calMarker} eng event`, "unit", engineering, "upcoming", "pending", null, calOwnerId, "usg");
    const eduEvent = await makeCalEvent(`${calMarker} edu event`, "unit", education, "upcoming", "pending", null, calOwnerId, "usg");
    const uniEvent = await makeCalEvent(`${calMarker} uni event`, "university", null, "upcoming", "pending", null, calOwnerId, "usg");
    const engApprovedProposal = await makeCalProposal(`${calMarker} eng approved`, engineering, "approved", calPedroId);
    const eduApprovedProposal = await makeCalProposal(`${calMarker} edu approved`, education, "approved", calCarloId);
    const cancelledEvent = await makeCalEvent(`${calMarker} cancelled`, "university", null, "cancelled", "pending", null, calOwnerId, "usg");
    const rejectedEvent = await makeCalEvent(`${calMarker} rejected`, "university", null, "rejected", "pending", null, calOwnerId, "usg");
    const notHonoredEvent = await makeCalEvent(`${calMarker} not honored`, "university", null, "upcoming", "not_honored", null, calOwnerId, "usg");
    const cancelledAtEvent = await makeCalEvent(`${calMarker} cancelled_at`, "university", null, "upcoming", "pending", new Date().toISOString(), calOwnerId, "usg");

    const flattenIds = (res) =>
      Object.values(res.days ?? {}).flat().map((item) => item.itemId ?? item.id);

    const ownerCal = await callCal("smartgov.list_calendar", [owner, calMonth, 31]);
    const ownerIds = ownerCal.ok ? flattenIds(ownerCal) : [];
    check(
      "USG calendar includes same-org visible fixtures",
      ownerCal.ok === true && ownerIds.includes(engEvent) && ownerIds.includes(eduEvent) && ownerIds.includes(uniEvent) && ownerIds.includes(engApprovedProposal) && ownerIds.includes(eduApprovedProposal),
      JSON.stringify({ ok: ownerCal.ok, count: ownerIds.length }),
    );

    const pedroCal = await callCal("smartgov.list_calendar", [pedro, calMonth, 31]);
    const pedroIds = pedroCal.ok ? flattenIds(pedroCal) : [];
    check(
      "LSG calendar is limited to its own unit scope",
      pedroCal.ok === true && pedroIds.includes(engEvent) && pedroIds.includes(engApprovedProposal) && !pedroIds.includes(eduEvent) && !pedroIds.includes(eduApprovedProposal),
      JSON.stringify({ ok: pedroCal.ok, count: pedroIds.length }),
    );

    const carloCal = await callCal("smartgov.list_calendar", [carlo, calMonth, 31]);
    const carloIds = carloCal.ok ? flattenIds(carloCal) : [];
    check(
      "other LSG calendar is limited to its own unit scope",
      carloCal.ok === true && carloIds.includes(eduEvent) && carloIds.includes(eduApprovedProposal) && !carloIds.includes(engEvent) && !carloIds.includes(engApprovedProposal),
      JSON.stringify({ ok: carloCal.ok, count: carloIds.length }),
    );

    const excludedIds = [cancelledEvent, rejectedEvent, notHonoredEvent, cancelledAtEvent];
    check(
      "calendar excludes cancelled, rejected, and not_honored events",
      excludedIds.every((id) => !ownerIds.includes(id)) && excludedIds.every((id) => !pedroIds.includes(id)) && excludedIds.every((id) => !carloIds.includes(id)),
      JSON.stringify({ owner: excludedIds.filter((id) => ownerIds.includes(id)).length }),
    );
  } finally {
    if (calProposals.length) {
      await calClient.query("delete from smartgov.proposals where id = any($1::uuid[])", [calProposals]).catch(() => {});
    }
    if (calEvents.length) {
      await calClient.query("delete from smartgov.events where id = any($1::uuid[])", [calEvents]).catch(() => {});
    }
    await calClient.end();
  }
  console.log("Monitoring boundaries");
  const statusFamilies = ["pending", "under_review", "approved", "returned", "rejected", "cancelled"];
  const moduleKeys = [
    "proposals",
    "budgets",
    "events",
    "documents",
    "tasks",
    "requests",
    "surveys",
    "structures",
    "resolutions",
  ];

  const anonMonitorRpc = await supabase.rpc("monitoring_by_campus", {
    p_session_token: "invalid-token",
  });
  check(
    "anonymous monitoring RPC is denied",
    anonMonitorRpc.data?.ok === false && anonMonitorRpc.data?.reason === "unauthenticated",
    JSON.stringify(anonMonitorRpc.data ?? anonMonitorRpc.error),
  );

  const lsgMonitorRpc = await supabase.rpc("monitoring_by_campus", {
    p_session_token: pedro,
  });
  check(
    "LSG monitoring RPC is denied",
    lsgMonitorRpc.data?.ok === false && lsgMonitorRpc.data?.reason === "forbidden",
    JSON.stringify(lsgMonitorRpc.data ?? lsgMonitorRpc.error),
  );

  const anonMonitor = await get("/api/monitoring");
  check("anonymous monitoring API is denied", anonMonitor.status === 401, `got ${anonMonitor.status}`);
  const lsgMonitor = await get("/api/monitoring", pedro);
  check("LSG monitoring API is denied", lsgMonitor.status === 403, `got ${lsgMonitor.status}`);

  const monitorClient = new pg.Client({ connectionString: env.DATABASE_URL });
  await monitorClient.connect();
  const monitorProposals = [];
  const monitorBudgets = [];
  const monitorEvents = [];
  const monitorResolutions = [];
  const monitorTasks = [];
  const monitorRequests = [];
  const monitorStructures = [];
  const monitorSurveys = [];
  const monitorRequirementItems = [];
  const monitorDocumentVersions = [];
  const monitorDocumentSubmissions = [];
  const monitorMarker = `Authority monitoring fixture ${Date.now()}`;
  try {
    const ids = await monitorClient.query(
      `select a.id as owner_id, a.organization_id,
              (select id from smartgov.accounts where email = $2) as pedro_id
         from smartgov.accounts a
        where a.email = $1`,
      [emails.owner, emails.pedro],
    );
    const monitorOrgId = ids.rows[0].organization_id;
    const monitorOwnerId = ids.rows[0].owner_id;
    const monitorPedroId = ids.rows[0].pedro_id;
    const rootUnits = await monitorClient.query(
      `select id from public.governance_units
        where organization_id = $1 and unit_type = 'usg'
        order by id
        limit 1`,
      [monitorOrgId],
    );
    const allCampusId = rootUnits.rows[0]?.id ?? null;
    check(
      "monitoring fixtures resolve",
      Boolean(monitorOrgId && monitorOwnerId && monitorPedroId && engineering && education && allCampusId),
    );

    const baselineMonitorRpc = await supabase.rpc("monitoring_by_campus", {
      p_session_token: owner,
    });
    const baselineCampuses = baselineMonitorRpc.data?.campuses ?? [];
    const baselineEngCampus = baselineCampuses.find((campus) => campus.unitId === engineering);
    const baselineAllCampus = baselineCampuses.find((campus) => campus.unitId === allCampusId);
    check(
      "monitoring fixture baseline resolves",
      baselineMonitorRpc.data?.ok === true && Boolean(baselineEngCampus) && Boolean(baselineAllCampus),
      JSON.stringify({ ok: baselineMonitorRpc.data?.ok, campuses: baselineCampuses.length }),
    );

    const insert = async (sql, values, bucket) => {
      const row = await monitorClient.query(sql, values);
      bucket.push(row.rows[0].id);
      return row.rows[0].id;
    };

    await insert(
      `insert into smartgov.proposals
         (organization_id, unit_id, author_kind, created_by, title, description, event_date, venue, status, activity_type)
       values ($1,$2,'lsg',$3,$4,'Monitoring fixture','2099-02-01','Hall','submitted','academic')
       returning id`,
       [monitorOrgId, engineering, monitorPedroId, `${monitorMarker} proposal`],
       monitorProposals,
     );
    const documentRequirement = await insert(
      `insert into smartgov.requirement_items (organization_id, label, item_kind)
       values ($1,$2,'file') returning id`,
      [monitorOrgId, `${monitorMarker} document requirement`],
      monitorRequirementItems,
    );
    const documentVersion = await insert(
      `insert into smartgov.proposal_versions (proposal_id, version_number, submitted_by)
       values ($1,1,$2) returning id`,
      [monitorProposals[0], monitorPedroId],
      monitorDocumentVersions,
    );
    const documentSubmission = await insert(
      `insert into smartgov.item_submissions
         (version_id, requirement_item_id, submission_kind, storage_path,
          original_name, mime_type, size_bytes)
       values ($1,$2,'file',$3,$4,'text/plain',4) returning id`,
      [documentVersion, documentRequirement, `authority-monitor-${Date.now()}.txt`, `${monitorMarker}.txt`],
      monitorDocumentSubmissions,
    );
    await monitorClient.query(
      `insert into smartgov.document_catalog
         (submission_id, organization_id, title, group_kind, group_id, group_label)
       values ($1,$2,$3,'requirement',$4,$5)`,
      [documentSubmission, monitorOrgId, `${monitorMarker} document`, documentRequirement, `${monitorMarker} requirement`],
    );
    await insert(
      `insert into smartgov.budget_requests
         (organization_id, unit_id, requested_by, title, justification, status, requested_total)
       values ($1,$2,$3,$4,'Monitoring fixture','submitted',100)
       returning id`,
      [monitorOrgId, engineering, monitorPedroId, `${monitorMarker} budget`],
      monitorBudgets,
    );
    await insert(
      `insert into smartgov.events
         (organization_id, created_by, title, event_date, scope, unit_id, status, honor_status, source)
       values ($1,$2,$3,'2099-02-01','unit',$4,'upcoming','pending','lsg')
       returning id`,
      [monitorOrgId, monitorOwnerId, `${monitorMarker} event`, engineering],
      monitorEvents,
    );
    await insert(
      `insert into smartgov.resolutions
         (organization_id, unit_id, created_by, title, body, scope, status)
       values ($1,$2,$3,$4,'Monitoring fixture body','unit','submitted')
       returning id`,
      [monitorOrgId, engineering, monitorPedroId, `${monitorMarker} resolution`],
      monitorResolutions,
    );
    const taskId = await insert(
      `insert into smartgov.tasks (organization_id, title, created_by)
       values ($1,$2,$3) returning id`,
      [monitorOrgId, `${monitorMarker} task`, monitorOwnerId],
      monitorTasks,
    );
    await monitorClient.query(
      `insert into smartgov.task_assignments (task_id, unit_id, status)
       values ($1,$2,'assigned')`,
      [taskId, engineering],
    );
    await insert(
      `insert into smartgov.personal_requests
         (organization_id, unit_id, created_by, subject, cover_letter, needed_on, status)
       values ($1,$2,$3,$4,'Monitoring fixture cover letter','2099-02-01','submitted')
       returning id`,
      [monitorOrgId, engineering, monitorPedroId, `${monitorMarker} request`],
      monitorRequests,
    );
    await insert(
      `insert into smartgov.gov_structures
         (organization_id, unit_id, author_kind, term_label, starts_on, ends_on, status, document)
       values ($1,$2,'lsg',$3,'2099-01-01','2099-12-31','rejected','{}'::jsonb)
       returning id`,
      [monitorOrgId, engineering, `${monitorMarker} structure`],
      monitorStructures,
    );
    await insert(
      `insert into smartgov.surveys (organization_id, created_by, title, status)
       values ($1,$2,$3,'open') returning id`,
      [monitorOrgId, monitorOwnerId, `${monitorMarker} survey`],
      monitorSurveys,
    );

    const ownerMonitorRpc = await supabase.rpc("monitoring_by_campus", {
      p_session_token: owner,
    });
    const campuses = ownerMonitorRpc.data?.campuses ?? [];
    const totals = ownerMonitorRpc.data?.totals ?? {};
    const engCampus = campuses.find((campus) => campus.unitId === engineering);
    const allCampus = campuses.find((campus) => campus.unitId === allCampusId);
    check(
      "USG monitoring RPC returns scoped campus rows",
      ownerMonitorRpc.data?.ok === true && Array.isArray(campuses) && Boolean(engCampus),
      JSON.stringify({ ok: ownerMonitorRpc.data?.ok, campuses: campuses.length }),
    );
    check(
      "monitoring totals use the shared status vocabulary",
      statusFamilies.every((family) => typeof totals[family] === "number"),
      JSON.stringify(totals),
    );
    check(
      "every campus carries every module",
      campuses.length > 0 && campuses.every((campus) =>
        moduleKeys.every((key) => campus.modules?.some((module) => module.key === key))),
      `campuses=${campuses.length}`,
    );
    const statusCount = (campus, moduleKey, family) =>
      campus?.modules?.find((module) => module.key === moduleKey)?.statuses?.[family] ?? 0;
    const markerDelta = (campus, baselineCampus, moduleKey, family) =>
      statusCount(campus, moduleKey, family) - statusCount(baselineCampus, moduleKey, family);
    const expectedFamilies = {
      proposals: "pending",
      budgets: "pending",
      events: "pending",
      resolutions: "pending",
      tasks: "pending",
      requests: "pending",
      structures: "rejected",
    };
    const engMarkerDeltas = Object.entries(expectedFamilies).map(([key, family]) => ({
      key,
      family,
      delta: markerDelta(engCampus, baselineEngCampus, key, family),
    }));
    check(
      "monitoring groups marker fixtures by top-level unit",
      Boolean(engCampus) && Boolean(baselineEngCampus) &&
        engMarkerDeltas.every(({ delta }) => delta === 1),
      JSON.stringify(engMarkerDeltas),
    );
    const allCampusSurveyDelta = markerDelta(allCampus, baselineAllCampus, "surveys", "pending");
    const engCampusSurveyDelta = markerDelta(engCampus, baselineEngCampus, "surveys", "pending");
    check(
      "organization-wide marker rows appear in the all-campuses group",
      Boolean(allCampus) && allCampus.unitId === allCampusId && allCampus.unitName === "All campuses" &&
        allCampusSurveyDelta === 1 && engCampusSurveyDelta === 0,
      JSON.stringify({
        expectedCampusId: allCampusId,
        unitId: allCampus?.unitId,
        unitName: allCampus?.unitName,
        allCampusSurveyDelta,
        engCampusSurveyDelta,
      }),
    );
    const engDocumentDelta = markerDelta(engCampus, baselineEngCampus, "documents", "pending");
    const allCampusDocumentDelta = markerDelta(allCampus, baselineAllCampus, "documents", "pending");
    check(
      "monitoring groups requirement documents by the proposal's campus",
      Boolean(engCampus) && Boolean(baselineEngCampus) && Boolean(allCampus) &&
        Boolean(baselineAllCampus) && engDocumentDelta === 1 && allCampusDocumentDelta === 0,
      JSON.stringify({ engDocumentDelta, allCampusDocumentDelta }),
    );

    const ownerMonitor = await get("/api/monitoring", owner);
    const ownerMonitorJson = await ownerMonitor.json().catch(() => ({}));
    check("USG monitoring API succeeds", ownerMonitor.status === 200 && ownerMonitorJson.ok === true, `got ${ownerMonitor.status}`);
    check(
      "monitoring API returns the same scoped payload",
      Array.isArray(ownerMonitorJson.campuses) && ownerMonitorJson.campuses.some((campus) => campus.unitId === engineering),
      `campuses=${ownerMonitorJson.campuses?.length ?? 0}`,
    );

    const ownerManagePage = await get("/usg/manage", owner);
    const ownerManageHtml = await ownerManagePage.text();
    const ownerManageSource = ownerManageHtml.split(`${String.fromCharCode(92)}"`).join('"');
    check(
      "USG Manage exposes the Monitoring tab",
      ownerManagePage.status === 200 && ownerManageSource.includes('"label":"Monitoring","href":"/usg/manage?tab=monitoring"'),
      `status=${ownerManagePage.status} raw=${ownerManageHtml.includes("tab=monitoring")} normalized=${ownerManageSource.includes('"label":"Monitoring","href":"/usg/manage?tab=monitoring"')}`,
    );

    const lsgOverviewPage = await get("/lsg", pedro);
    const lsgManagePage = await get("/lsg/manage", pedro);
    const lsgHtml = `${await lsgOverviewPage.text()}\n${await lsgManagePage.text()}`;
    check(
      "LSG shell has no Monitoring navigation or Manage tab",
      !lsgHtml.includes('tab=monitoring') && !lsgHtml.includes("Monitoring by campus"),
    );
  } finally {
    if (monitorStructures.length) await monitorClient.query("delete from smartgov.gov_structures where id = any($1::uuid[])", [monitorStructures]).catch(() => {});
    if (monitorRequests.length) await monitorClient.query("delete from smartgov.personal_requests where id = any($1::uuid[])", [monitorRequests]).catch(() => {});
    if (monitorTasks.length) await monitorClient.query("delete from smartgov.tasks where id = any($1::uuid[])", [monitorTasks]).catch(() => {});
    if (monitorSurveys.length) await monitorClient.query("delete from smartgov.surveys where id = any($1::uuid[])", [monitorSurveys]).catch(() => {});
    if (monitorResolutions.length) await monitorClient.query("delete from smartgov.resolutions where id = any($1::uuid[])", [monitorResolutions]).catch(() => {});
    if (monitorBudgets.length) await monitorClient.query("delete from smartgov.budget_requests where id = any($1::uuid[])", [monitorBudgets]).catch(() => {});
    if (monitorEvents.length) await monitorClient.query("delete from smartgov.events where id = any($1::uuid[])", [monitorEvents]).catch(() => {});
    if (monitorDocumentSubmissions.length) await monitorClient.query("delete from smartgov.item_submissions where id = any($1::uuid[])", [monitorDocumentSubmissions]).catch(() => {});
    if (monitorDocumentVersions.length) await monitorClient.query("delete from smartgov.proposal_versions where id = any($1::uuid[])", [monitorDocumentVersions]).catch(() => {});
    if (monitorRequirementItems.length) await monitorClient.query("delete from smartgov.requirement_items where id = any($1::uuid[])", [monitorRequirementItems]).catch(() => {});
    if (monitorProposals.length) await monitorClient.query("delete from smartgov.proposals where id = any($1::uuid[])", [monitorProposals]).catch(() => {});
    await monitorClient.end();
  }

  console.log("Accomplishment report boundaries");
  const accomplishmentClient = new pg.Client({ connectionString: env.DATABASE_URL });
  await accomplishmentClient.connect();
  const createdAccomplishmentReports = [];
  const createdAccomplishmentEvents = [];
  try {
    const accountRows = await accomplishmentClient.query(
      `select id, email from smartgov.accounts where email = any($1::text[])`,
      [[emails.pedro, emails.carlo, emails.owner]],
    );
    const accountIdByEmail = new Map(accountRows.rows.map((row) => [row.email, row.id]));
    const pedroId = accountIdByEmail.get(emails.pedro);
    const carloId = accountIdByEmail.get(emails.carlo);
    const ownerAccountId = accountIdByEmail.get(emails.owner) ?? ownerId;
    check("accomplishment fixture accounts resolve", Boolean(pedroId && carloId && ownerAccountId));
    const ownerOrg = await accomplishmentClient.query(
      `select organization_id from smartgov.accounts where id = $1`,
      [ownerAccountId],
    );
    const orgId = ownerOrg.rows[0]?.organization_id;
    check("accomplishment fixture organization resolves", Boolean(orgId));

    const marker = `Authority accomplishment ${Date.now()}`;
    const insertEvent = async (createdBy, unitId, source, scope) => {
      const row = await accomplishmentClient.query(
        `insert into smartgov.events
           (organization_id, created_by, title, event_date, scope, unit_id,
            status, honor_status, source)
         values ($1,$2,$3,'2099-03-01',$4,$5,'honored','honored',$6)
         returning id`,
        [orgId, createdBy, `${marker} ${source} ${scope}`, scope, unitId, source],
      );
      const id = row.rows[0].id;
      createdAccomplishmentEvents.push(id);
      return id;
    };
    const engineeringEventId = await insertEvent(pedroId, engineering, "lsg", "unit");
    const educationEventId = await insertEvent(carloId, education, "lsg", "unit");
    const universityEventId = await insertEvent(ownerAccountId, null, "usg", "university");

    const submitReport = async (cookie, eventId, suffix) => {
      const res = await post("/api/accomplishment-reports", cookie, {
        eventId,
        narrative: `${marker} narrative ${suffix} describes what was completed and what follows.`,
        highlights: `${marker} result ${suffix}`,
        attachmentSubmissionId: null,
      });
      const json = await res.json().catch(() => ({}));
      if (typeof json.id === "string") createdAccomplishmentReports.push(json.id);
      return { status: res.status, json };
    };

    const anonList = await get(`/api/accomplishment-reports?eventId=${engineeringEventId}`);
    check("anonymous accomplishment denial", anonList.status === 401, `got ${anonList.status}`);
    const anonCreate = await post("/api/accomplishment-reports", "", {
      eventId: engineeringEventId,
      narrative: `${marker} anonymous narrative is long enough to be considered.`,
      highlights: "Anonymous",
    });
    check("anonymous cannot submit an accomplishment", anonCreate.status === 401, `got ${anonCreate.status}`);
    const anonDetail = await get(`/api/accomplishment-reports/${forgedId}`);
    check("anonymous cannot read an accomplishment", anonDetail.status === 401, `got ${anonDetail.status}`);
    const anonReview = await post(`/api/accomplishment-reports/${forgedId}/review`, "", {
      decision: "acknowledged",
    });
    check("anonymous cannot review an accomplishment", anonReview.status === 401, `got ${anonReview.status}`);

    const crossUnit = await submitReport(carlo, engineeringEventId, "cross-unit");
    check(
      "cross-unit accomplishment denial",
      crossUnit.status === 403 && crossUnit.json.reason === "forbidden",
      JSON.stringify(crossUnit.json),
    );
    const crossUnitDetail = await get(`/api/accomplishment-reports/${forgedId}`, carlo);
    check("forged accomplishment id is not found", crossUnitDetail.status === 404, `got ${crossUnitDetail.status}`);

    const lsgSubmit = await submitReport(pedro, engineeringEventId, "engineering");
    check(
      "LSG accomplishment submit",
      lsgSubmit.status === 200 && lsgSubmit.json.ok === true && Boolean(lsgSubmit.json.id),
      JSON.stringify(lsgSubmit.json),
    );
    const lsgReportId = lsgSubmit.json.id;

    const duplicate = await submitReport(pedro, engineeringEventId, "duplicate");
    check(
      "duplicate accomplishment prevention",
      duplicate.status === 400 && duplicate.json.reason === "duplicate_report",
      JSON.stringify(duplicate.json),
    );

    const duplicateRpc = await supabase.rpc("submit_accomplishment_report", {
      p_session_token: pedro,
      p_event_id: engineeringEventId,
      p_narrative: `${marker} direct duplicate narrative is long enough to be considered.`,
      p_highlights: "Direct duplicate",
      p_attachment_submission_id: null,
    });
    check(
      "duplicate accomplishment RPC is denied",
      duplicateRpc.data?.ok === false && duplicateRpc.data?.reason === "duplicate_report",
      JSON.stringify(duplicateRpc.data ?? duplicateRpc.error),
    );

    const returnWithoutRemark = await post(`/api/accomplishment-reports/${lsgReportId}/review`, owner, {
      decision: "returned",
    });
    const returnWithoutRemarkJson = await returnWithoutRemark.json().catch(() => ({}));
    check(
      "returning an accomplishment requires a remark",
      returnWithoutRemark.status === 400 && returnWithoutRemarkJson.reason === "remark_required",
      JSON.stringify({ status: returnWithoutRemark.status, body: returnWithoutRemarkJson }),
    );

    const returnRemark = `${marker} please revise`;
    const usgReturn = await post(`/api/accomplishment-reports/${lsgReportId}/review`, owner, {
      decision: "returned",
      remark: returnRemark,
    });
    const usgReturnJson = await usgReturn.json().catch(() => ({}));
    check(
      "USG can return an LSG accomplishment",
      usgReturn.status === 200 && usgReturnJson.ok === true && usgReturnJson.status === "returned",
      JSON.stringify({ status: usgReturn.status, body: usgReturnJson }),
    );

    const returnedDetail = await get(`/api/accomplishment-reports/${lsgReportId}`, owner);
    const returnedDetailJson = await returnedDetail.json().catch(() => ({}));
    const returnedItem = returnedDetailJson.item ?? {};
    check(
      "returned accomplishment carries the remark and review trail",
      returnedDetail.status === 200 &&
        returnedItem.status === "returned" &&
        returnedItem.decisionRemark === returnRemark &&
        (returnedItem.timeline ?? []).some(
          (entry) => entry.decision === "returned" && entry.remark === returnRemark,
        ),
      JSON.stringify({ status: returnedDetail.status, item: returnedItem }),
    );

    const resubmit = await submitReport(pedro, engineeringEventId, "resubmitted");
    check(
      "LSG resubmits a returned accomplishment in place",
      resubmit.status === 200 && resubmit.json.ok === true && resubmit.json.id === lsgReportId,
      JSON.stringify(resubmit.json),
    );

    const resubmittedDetail = await get(`/api/accomplishment-reports/${lsgReportId}`, owner);
    const resubmittedDetailJson = await resubmittedDetail.json().catch(() => ({}));
    const resubmittedItem = resubmittedDetailJson.item ?? {};
    check(
      "resubmitted accomplishment is submitted with review state cleared",
      resubmittedDetail.status === 200 &&
        resubmittedItem.status === "submitted" &&
        resubmittedItem.decisionRemark === null &&
        resubmittedItem.reviewedAt === null &&
        resubmittedItem.narrative ===
          `${marker} narrative resubmitted describes what was completed and what follows.` &&
        (resubmittedItem.timeline ?? []).some((entry) => entry.decision === "returned"),
      JSON.stringify({ status: resubmittedDetail.status, item: resubmittedItem }),
    );

    const resubmittedList = await get(`/api/accomplishment-reports?eventId=${engineeringEventId}`, pedro);
    const resubmittedListJson = await resubmittedList.json().catch(() => ({}));
    const resubmittedRows = resubmittedListJson.rows ?? [];
    check(
      "resubmit does not create a second report row",
      resubmittedList.status === 200 &&
        resubmittedRows.filter((row) => row.id === lsgReportId).length === 1 &&
        resubmittedRows.some((row) => row.id === lsgReportId && row.status === "submitted"),
      JSON.stringify({ status: resubmittedList.status, rows: resubmittedRows.map((row) => row.id) }),
    );

    const duplicateAfterResubmit = await submitReport(pedro, engineeringEventId, "duplicate-after-resubmit");
    check(
      "duplicate prevention still applies after resubmission",
      duplicateAfterResubmit.status === 400 &&
        duplicateAfterResubmit.json.reason === "duplicate_report",
      JSON.stringify(duplicateAfterResubmit.json),
    );

    const lsgList = await get(`/api/accomplishment-reports?eventId=${engineeringEventId}`, pedro);
    const lsgListJson = await lsgList.json().catch(() => ({}));
    check(
      "LSG list includes the submitted report",
      lsgList.status === 200 &&
        (lsgListJson.rows ?? []).some((row) => row.id === lsgReportId && row.status === "submitted"),
      JSON.stringify({ status: lsgList.status, rows: (lsgListJson.rows ?? []).map((row) => row.id) }),
    );
    const carloList = await get(`/api/accomplishment-reports?eventId=${engineeringEventId}`, carlo);
    const carloListJson = await carloList.json().catch(() => ({}));
    check(
      "other unit cannot list the report",
      carloList.status === 200 && !((carloListJson.rows ?? []).some((row) => row.id === lsgReportId)),
      JSON.stringify({ status: carloList.status, rows: (carloListJson.rows ?? []).map((row) => row.id) }),
    );
    const carloDetail = await get(`/api/accomplishment-reports/${lsgReportId}`, carlo);
    check("other unit cannot read the report", carloDetail.status === 404, `got ${carloDetail.status}`);
    const ownerDetail = await get(`/api/accomplishment-reports/${lsgReportId}`, owner);
    check("USG can read the submitted report", ownerDetail.status === 200, `got ${ownerDetail.status}`);

    const lsgReview = await post(`/api/accomplishment-reports/${lsgReportId}/review`, pedro, {
      decision: "acknowledged",
    });
    check("LSG accomplishment review denial", lsgReview.status === 403, `got ${lsgReview.status}`);

    const usgReview = await post(`/api/accomplishment-reports/${lsgReportId}/review`, owner, {
      decision: "acknowledged",
      remark: "Noted.",
    });
    const usgReviewJson = await usgReview.json().catch(() => ({}));
    check(
      "USG accomplishment review",
      usgReview.status === 200 && usgReviewJson.ok === true,
      JSON.stringify({ status: usgReview.status, body: usgReviewJson }),
    );

    const usgSubmit = await submitReport(owner, universityEventId, "university");
    check(
      "USG can submit an accomplishment",
      usgSubmit.status === 200 && usgSubmit.json.ok === true && Boolean(usgSubmit.json.id),
      JSON.stringify(usgSubmit.json),
    );
    const lsgReviewUsg = await post(`/api/accomplishment-reports/${usgSubmit.json.id}/review`, pedro, {
      decision: "acknowledged",
    });
    check("LSG cannot review an org report", lsgReviewUsg.status === 403, `got ${lsgReviewUsg.status}`);
    const usgReviewUsg = await post(`/api/accomplishment-reports/${usgSubmit.json.id}/review`, owner, {
      decision: "acknowledged",
    });
    check("USG cannot review its own report", usgReviewUsg.status === 403, `got ${usgReviewUsg.status}`);

    const otherUnitList = await get(`/api/accomplishment-reports?eventId=${educationEventId}`, pedro);
    const otherUnitJson = await otherUnitList.json().catch(() => ({}));
    check(
      "unseen event yields no reports",
      otherUnitList.status === 200 && (otherUnitJson.rows ?? []).length === 0,
      JSON.stringify(otherUnitJson),
    );
  } finally {
    if (createdAccomplishmentReports.length) {
      await accomplishmentClient
        .query("delete from smartgov.accomplishment_reports where id = any($1::uuid[])", [createdAccomplishmentReports])
        .catch(() => {});
    }
    if (createdAccomplishmentEvents.length) {
      await accomplishmentClient
        .query("delete from smartgov.events where id = any($1::uuid[])", [createdAccomplishmentEvents])
        .catch(() => {});
    }
    await accomplishmentClient.end();
  }

  console.log("Feedback boundaries");
  const feedbackClient = new pg.Client({ connectionString: env.DATABASE_URL });
  await feedbackClient.connect();
  const createdFeedbackIds = [];
  const otherOrgIds = new Set();
  try {
    const accountRows = await feedbackClient.query(
      `select id, email, organization_id from smartgov.accounts where email = any($1::text[])`,
      [[emails.pedro, emails.owner, emails.reviewer]],
    );
    const accountByEmail = new Map(accountRows.rows.map((row) => [row.email, row]));
    const pedroAccount = accountByEmail.get(emails.pedro);
    const ownerAccount = accountByEmail.get(emails.owner);
    const reviewerAccount = accountByEmail.get(emails.reviewer);
    check(
      "feedback fixture accounts resolve",
      Boolean(pedroAccount && ownerAccount && reviewerAccount),
    );

    const orgId = ownerAccount?.organization_id;
    check("feedback fixture organization resolves", Boolean(orgId));
    const otherOrg = await feedbackClient.query(
      `select id from public.organizations where id <> $1 order by created_at asc nulls last limit 1`,
      [orgId],
    );
    let otherOrgId = otherOrg.rows[0]?.id;
    if (!otherOrgId) {
      const stamp = Date.now();
      otherOrgId = (
        await feedbackClient.query(
          `insert into public.organizations (
             slug, name, governance_model, charter_number, academic_year, university_name
           ) values ($1, $2, 'federated', $3, '2026-2027', $4)
           returning id`,
          [
            `authority-check-${stamp}`,
            "Authority Check University",
            `AUTH-CHECK-${stamp}`,
            "Authority Check University",
          ],
        )
      ).rows[0].id;
      otherOrgIds.add(otherOrgId);
    }
    check("feedback fixture second organization resolves", Boolean(otherOrgId));

    const marker = `Authority feedback ${Date.now()}`;
    const submit = async (cookie, suffix) => {
      const res = await post("/api/feedback", cookie, {
        subject: `${marker} ${suffix}`,
        message: `${marker} message ${suffix} describes the issue in enough detail.`,
      });
      const json = await res.json().catch(() => ({}));
      if (typeof json.id === "string") createdFeedbackIds.push(json.id);
      return { status: res.status, json };
    };
    const forgedId = "00000000-0000-0000-0000-000000000000";

    const anonCreate = await post("/api/feedback", "", {
      subject: `${marker} anonymous`,
      message: `${marker} anonymous message is long enough to be reviewed.`,
    });
    check("anonymous feedback create denial", anonCreate.status === 401, `got ${anonCreate.status}`);
    const anonList = await get("/api/feedback");
    check("anonymous feedback list denial", anonList.status === 401, `got ${anonList.status}`);
    const anonDetail = await get(`/api/feedback/${forgedId}`);
    check("anonymous feedback detail denial", anonDetail.status === 401, `got ${anonDetail.status}`);
    const anonAck = await post(`/api/feedback/${forgedId}/acknowledge`, "", {});
    check("anonymous feedback acknowledge denial", anonAck.status === 401, `got ${anonAck.status}`);

    const invalid = await post("/api/feedback", pedro, { subject: "x", message: "short" });
    const invalidJson = await invalid.json().catch(() => ({}));
    check(
      "feedback invalid payload denial",
      invalid.status === 400 && invalidJson.reason === "invalid_feedback_subject",
      JSON.stringify({ status: invalid.status, body: invalidJson }),
    );

    const created = await submit(pedro, "unit");
    check(
      "feedback create",
      created.status === 200 && created.json.ok === true && Boolean(created.json.id),
      JSON.stringify(created.json),
    );
    const feedbackId = created.json.id;

    const pedroList = await get("/api/feedback", pedro);
    check("non-reviewer feedback list denial", pedroList.status === 403, `got ${pedroList.status}`);
    const pedroAck = await post(`/api/feedback/${feedbackId}/acknowledge`, pedro, {});
    check(
      "non-reviewer feedback acknowledge denial",
      pedroAck.status === 403,
      `got ${pedroAck.status}`,
    );

    const ownerList = await get("/api/feedback", owner);
    const reviewerList = await get("/api/feedback", reviewer);
    const ownerListJson = await ownerList.json().catch(() => ({}));
    const reviewerListJson = await reviewerList.json().catch(() => ({}));
    const findRow = (json) => (json.rows ?? []).find((row) => row.id === feedbackId);
    check(
      "reviewer feedback list",
      ownerList.status === 200 &&
        reviewerList.status === 200 &&
        findRow(ownerListJson)?.status === "new" &&
        findRow(reviewerListJson)?.subject === `${marker} unit`,
      JSON.stringify({
        owner: ownerList.status,
        reviewer: reviewerList.status,
        ownerRow: findRow(ownerListJson),
        reviewerRow: findRow(reviewerListJson),
      }),
    );

    const ownerDetail = await get(`/api/feedback/${feedbackId}`, owner);
    const ownerDetailJson = await ownerDetail.json().catch(() => ({}));
    check(
      "reviewer feedback detail",
      ownerDetail.status === 200 &&
        ownerDetailJson.item?.id === feedbackId &&
        ownerDetailJson.item?.message ===
          `${marker} message unit describes the issue in enough detail.`,
      JSON.stringify({ status: ownerDetail.status, item: ownerDetailJson.item }),
    );

    const reviewerAck = await post(`/api/feedback/${feedbackId}/acknowledge`, reviewer, {});
    const reviewerAckJson = await reviewerAck.json().catch(() => ({}));
    const ackDetail = await get(`/api/feedback/${feedbackId}`, owner);
    const ackDetailJson = await ackDetail.json().catch(() => ({}));
    check(
      "reviewer feedback acknowledge",
      reviewerAck.status === 200 &&
        reviewerAckJson.ok === true &&
        ackDetailJson.item?.status === "acknowledged" &&
        Boolean(ackDetailJson.item?.acknowledgedAt) &&
        ackDetailJson.item?.acknowledgedBy === reviewerAccount?.id,
      JSON.stringify({
        ack: { status: reviewerAck.status, body: reviewerAckJson },
        detail: { status: ackDetail.status, item: ackDetailJson.item },
      }),
    );

    const crossOrgRow = await feedbackClient.query(
      `insert into smartgov.feedback_entries (organization_id, subject, message)
       values ($1, $2, $3) returning id`,
      [
        otherOrgId,
        `${marker} other org`,
        `${marker} other org message is long enough to be reviewed.`,
      ],
    );
    const crossOrgId = crossOrgRow.rows[0]?.id;
    if (crossOrgId) createdFeedbackIds.push(crossOrgId);
    const scopedList = await get("/api/feedback", owner);
    const scopedJson = await scopedList.json().catch(() => ({}));
    const crossDetail = await get(`/api/feedback/${crossOrgId}`, owner);
    const crossAck = await post(`/api/feedback/${crossOrgId}/acknowledge`, owner, {});
    check(
      "feedback org scoping",
      Boolean(crossOrgId) &&
        scopedList.status === 200 &&
        !(scopedJson.rows ?? []).some((row) => row.id === crossOrgId) &&
        crossDetail.status === 404 &&
        crossAck.status === 404,
      JSON.stringify({
        crossOrgId,
        list: scopedList.status,
        detail: crossDetail.status,
        acknowledge: crossAck.status,
      }),
    );

    const rpcInvalid = await supabase.rpc("create_feedback", {
      p_session_token: "invalid-token",
      p_subject: `${marker} direct`,
      p_message: `${marker} direct message is long enough to be reviewed.`,
    });
    check(
      "feedback invalid token fails closed at RPC",
      rpcInvalid.data?.ok === false && rpcInvalid.data?.reason === "unauthenticated",
      JSON.stringify(rpcInvalid.data ?? rpcInvalid.error),
    );

    const lsgPage = await get("/lsg/manage?tab=feedback", pedro);
    const usgPage = await get("/usg/manage?tab=feedback", owner);
    const lsgHtml = await lsgPage.text();
    const usgHtml = await usgPage.text();
    const feedbackHtml = `${lsgHtml}${usgHtml}`;
    check(
      "no external form dependency",
      lsgPage.status === 200 &&
        usgPage.status === 200 &&
        /Feedback/i.test(lsgHtml) &&
        /Feedback/i.test(usgHtml) &&
        !/docs\.google\.com/i.test(feedbackHtml) &&
        !/<iframe\b/i.test(feedbackHtml) &&
        !/<form[^>]+action=["']https?:\/\//i.test(feedbackHtml),
      JSON.stringify({
        lsg: lsgPage.status,
        usg: usgPage.status,
        lsgHasLabel: /Feedback/i.test(lsgHtml),
        usgHasLabel: /Feedback/i.test(usgHtml),
      }),
    );
  } finally {
    if (createdFeedbackIds.length) {
      await feedbackClient
        .query("delete from smartgov.feedback_entries where id = any($1::uuid[])", [
          createdFeedbackIds,
        ])
        .catch(() => {});
    }
    if (otherOrgIds.size) {
      await feedbackClient
        .query("delete from public.organizations where id = any($1::uuid[])", [[...otherOrgIds]])
        .catch(() => {});
    }
    await feedbackClient.end();
  }

  console.log("Officer profile boundaries");
  const profileClient = new pg.Client({ connectionString: env.DATABASE_URL });
  await profileClient.connect();
  const originalProfile = new Map();
  try {
    const accountRows = await profileClient.query(
      `select id, email, full_name, campus_department, program, position
         from smartgov.accounts where email = any($1::text[])`,
      [[emails.pedro, emails.carlo, emails.owner]],
    );
    const accountByEmail = new Map(accountRows.rows.map((row) => [row.email, row]));
    const pedroAccount = accountByEmail.get(emails.pedro);
    const carloAccount = accountByEmail.get(emails.carlo);
    const ownerAccount = accountByEmail.get(emails.owner);
    check(
      "officer profile fixture accounts resolve",
      Boolean(pedroAccount && carloAccount && ownerAccount),
    );
    for (const row of [pedroAccount, carloAccount].filter(Boolean)) {
      originalProfile.set(row.id, {
        full_name: row.full_name ?? null,
        campus_department: row.campus_department ?? null,
        program: row.program ?? null,
        position: row.position ?? null,
      });
    }

    const marker = `Authority profile ${Date.now()}`;
    const updated = {
      fullName: `${marker} full name`,
      campusDepartment: `${marker} campus`,
      program: `${marker} program`,
      position: `${marker} position`,
    };

    const anonRead = await get("/api/profile/officer");
    const anonWrite = await patch("/api/profile/officer", "", updated);
    check(
      "anonymous officer profile denial",
      anonRead.status === 401 && anonWrite.status === 401,
      JSON.stringify({ read: anonRead.status, write: anonWrite.status }),
    );

    const selfRead = await get("/api/profile/officer", pedro);
    const selfReadJson = await selfRead.json().catch(() => ({}));
    check(
      "officer self profile read",
      selfRead.status === 200 &&
        selfReadJson.ok === true &&
        typeof selfReadJson.profile?.fullName === "string" &&
        typeof selfReadJson.profile?.campusDepartment === "string" &&
        typeof selfReadJson.profile?.program === "string" &&
        typeof selfReadJson.profile?.position === "string",
      JSON.stringify({ status: selfRead.status, ok: selfReadJson.ok }),
    );

    const selfWrite = await patch("/api/profile/officer", pedro, updated);
    const selfWriteJson = await selfWrite.json().catch(() => ({}));
    const stored = await profileClient.query(
      `select full_name, campus_department, program, position from smartgov.accounts where id = $1`,
      [pedroAccount?.id],
    );
    check(
      "officer self profile update",
      selfWrite.status === 200 &&
        selfWriteJson.ok === true &&
        stored.rows[0]?.full_name === updated.fullName &&
        stored.rows[0]?.campus_department === updated.campusDepartment &&
        stored.rows[0]?.program === updated.program &&
        stored.rows[0]?.position === updated.position,
      JSON.stringify({ status: selfWrite.status, ok: selfWriteJson.ok, stored: Boolean(stored.rows[0]) }),
    );

    const crossWrite = await patch("/api/profile/officer", pedro, {
      ...updated,
      accountId: carloAccount?.id,
      fullName: `${marker} hijacked`,
    });
    const crossWriteJson = await crossWrite.json().catch(() => ({}));
    const carloStored = await profileClient.query(
      `select full_name from smartgov.accounts where id = $1`,
      [carloAccount?.id],
    );
    check(
      "cross-officer profile update denial",
      crossWrite.status === 400 &&
        crossWriteJson.reason === "immutable_field" &&
        carloStored.rows[0]?.full_name !== `${marker} hijacked`,
      JSON.stringify({ status: crossWrite.status, reason: crossWriteJson.reason }),
    );

    const lsgList = await get("/api/profile/officer?scope=all", pedro);
    const lsgRpc = await supabase.rpc("list_officer_profiles", { p_session_token: pedro });
    check(
      "LSG non-owner officer list denial",
      lsgList.status === 403 &&
        lsgRpc.data?.ok === false &&
        lsgRpc.data?.reason === "forbidden",
      JSON.stringify({
        http: lsgList.status,
        rpcOk: lsgRpc.data?.ok,
        rpcReason: lsgRpc.data?.reason,
      }),
    );

    const reviewerList = await get("/api/profile/officer?scope=all", reviewer);
    check(
      "USG reviewer officer list denial",
      reviewerList.status === 403,
      `got ${reviewerList.status}`,
    );

    const ownerList = await get("/api/profile/officer?scope=all", owner);
    const ownerListJson = await ownerList.json().catch(() => ({}));
    const rows = ownerListJson.rows ?? [];
    check(
      "USG owner officer list",
      ownerList.status === 200 &&
        ownerListJson.ok === true &&
        rows.some((row) => row.accountId === pedroAccount?.id && row.fullName === updated.fullName) &&
        rows.some((row) => row.accountId === carloAccount?.id) &&
        rows.every((row) => typeof row.email === "string"),
      JSON.stringify({
        status: ownerList.status,
        ok: ownerListJson.ok,
        count: rows.length,
      }),
    );

    const immutable = await patch("/api/profile/officer", pedro, {
      ...updated,
      email: emails.carlo,
      role: "owner",
    });
    const immutableJson = await immutable.json().catch(() => ({}));
    check(
      "immutable officer field rejection",
      immutable.status === 400 && immutableJson.reason === "immutable_field",
      JSON.stringify({ status: immutable.status, reason: immutableJson.reason }),
    );
  } finally {
    for (const [id, values] of originalProfile) {
      await profileClient
        .query(
          `update smartgov.accounts
              set full_name = $2, campus_department = $3, program = $4, position = $5
            where id = $1`,
          [id, values.full_name, values.campus_department, values.program, values.position],
        )
        .catch(() => {});
    }
    await profileClient.end();
  }

  console.log("Federated HTTP denial matrix");
  const matrixReads = [
    ["resolutions", "/api/resolutions"],
    ["documents", "/api/documents"],
    ["budgets", "/api/budgets"],
    ["feed", "/api/feed"],
    ["monitoring", "/api/monitoring"],
    ["accomplishment reports", `/api/accomplishment-reports?eventId=${forgedId}`],
    ["feedback", "/api/feedback"],
    ["officer profile", "/api/profile/officer"],
  ];
  for (const [label, route] of matrixReads) {
    const response = await get(route);
    check(`anonymous API cannot read ${label}`, response.status === 401, `got ${response.status}`);
  }

  const matrixWrites = [
    ["resolutions", "/api/resolutions", {
      title: "Authority matrix resolution",
      body: "Authority matrix body text for an anonymous caller.",
    }],
    ["document approvals", `/api/documents/${forgedId}/approve`, { decision: "approved" }],
    ["event budgets", "/api/budgets", {
      title: "Authority matrix budget",
      justification: "Authority matrix justification.",
      eventId: forgedId,
      items: [{ label: "Paper", quantity: 1, unitCost: 10 }],
    }],
    ["feed calendar", "/api/feed", { month: "2026-11-01", days: 7 }],
    ["accomplishment reports", "/api/accomplishment-reports", {
      eventId: forgedId,
      narrative: "Authority matrix narrative text.",
    }],
    ["accomplishment reviews", `/api/accomplishment-reports/${forgedId}/review`, {
      decision: "acknowledged",
    }],
    ["feedback", "/api/feedback", {
      subject: "Authority matrix",
      message: "Authority matrix feedback message.",
    }],
    ["feedback acknowledgements", `/api/feedback/${forgedId}/acknowledge`, {}],
  ];
  for (const [label, route, body] of matrixWrites) {
    const response = await post(route, "", body);
    check(`anonymous API cannot write ${label}`, response.status === 401, `got ${response.status}`);
  }
  const anonProfilePatch = await patch("/api/profile/officer", "", { fullName: "Anonymous" });
  check("anonymous API cannot edit an officer profile", anonProfilePatch.status === 401, `got ${anonProfilePatch.status}`);

  const wrongSide = [
    ["monitoring", await get("/api/monitoring", pedro), 403],
    ["the officer roster", await get("/api/profile/officer?scope=all", pedro), 403],
    ["resolution review", await post(`/api/resolutions/${forgedId}/review`, pedro, { decision: "under_review" }), 403],
    ["document approval", await post(`/api/documents/${forgedId}/approve`, pedro, { decision: "approved" }), 403],
    ["accomplishment review", await post(`/api/accomplishment-reports/${forgedId}/review`, pedro, { decision: "acknowledged" }), 403],
    ["feedback review", await get("/api/feedback", pedro), 403],
    ["feedback acknowledgement", await post(`/api/feedback/${forgedId}/acknowledge`, pedro, {}), 403],
  ];
  for (const [label, response, expected] of wrongSide) {
    check(`LSG API cannot ${label}`, response.status === expected, `got ${response.status}`);
  }

  const lsgFeed = await get("/api/feed", pedro);
  const lsgFeedJson = await lsgFeed.json().catch(() => ({}));
  check(
    "LSG API feed is scoped to its own unit",
    lsgFeed.status === 200 && lsgFeedJson.scope === "unit",
    JSON.stringify({ status: lsgFeed.status, scope: lsgFeedJson.scope }),
  );

  const matrixClient = new pg.Client({ connectionString: env.DATABASE_URL });
  await matrixClient.connect();
  let crossAccountResolutionId = "";
  let matrixEventId = "";
  try {
    const crossAccountCreate = await post("/api/resolutions", carlo, {
      title: "Authority matrix cross-unit resolution",
      body: "Authority matrix body text for the education unit.",
    });
    const crossAccountJson = await crossAccountCreate.json().catch(() => ({}));
    crossAccountResolutionId = typeof crossAccountJson.id === "string" ? crossAccountJson.id : "";
    check(
      "LSG officer can create its own unit resolution in the matrix",
      crossAccountCreate.status === 200 && Boolean(crossAccountResolutionId),
      JSON.stringify(crossAccountJson),
    );
    if (crossAccountResolutionId) {
      const crossAccountRead = await get(`/api/resolutions/${crossAccountResolutionId}`, pedro);
      check(
        "LSG API cannot read another unit's resolution",
        crossAccountRead.status === 404,
        `got ${crossAccountRead.status}`,
      );
    }

    const matrixEventCreate = await post("/api/events", carlo, {
      title: "Authority matrix cross-unit event",
      description: "Authority matrix event for the education unit.",
      eventDate: "2026-12-01",
      scope: "unit",
      unitIds: [education],
    });
    const matrixEventJson = await matrixEventCreate.json().catch(() => ({}));
    matrixEventId = typeof matrixEventJson.eventId === "string" ? matrixEventJson.eventId : "";
    check(
      "LSG officer can create its own unit event in the matrix",
      matrixEventCreate.status === 200 && Boolean(matrixEventId),
      JSON.stringify(matrixEventJson),
    );
    if (matrixEventId) {
      const crossBudget = await post("/api/budgets", pedro, {
        title: "Authority matrix cross-unit budget",
        justification: "Authority matrix justification.",
        eventId: matrixEventId,
        items: [{ label: "Paper", quantity: 1, unitCost: 10 }],
      });
      check(
        "LSG API cannot attach a budget to another unit's event",
        crossBudget.status === 403 || crossBudget.status === 404,
        `got ${crossBudget.status}`,
      );
    }
  } finally {
    if (matrixEventId) {
      await matrixClient
        .query("delete from smartgov.budget_requests where event_id = $1", [matrixEventId])
        .catch(() => {});
      await matrixClient
        .query("delete from smartgov.events where id = $1", [matrixEventId])
        .catch(() => {});
    }
    if (crossAccountResolutionId) {
      await matrixClient
        .query("delete from smartgov.resolutions where id = $1", [crossAccountResolutionId])
        .catch(() => {});
    }
    await matrixClient.end();
  }

  console.log(`\n${checks - failures}/${checks} checks passed.`);

  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Authority check aborted: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
