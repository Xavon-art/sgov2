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
    else if (/^\s*Member\s+Bea/i.test(line)) emails.member = email;
  }
  if (!password || Object.keys(emails).length < 4) {
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
  check("four fixture roles authenticate", Boolean(owner && pedro && carlo && member));

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
    const engineering = units.rows.find((row) => row.name === "College of Engineering")?.id;
    const education = units.rows.find((row) => row.name === "College of Education")?.id;
    check("two distinct LSG units resolve", Boolean(engineering && education && engineering !== education));

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

    console.log("T4 forged identifiers");
    const forgedSurvey = await call("smartgov.create_survey_otp", ["00000000-0000-0000-0000-000000000000", emails.member]);
    check("forged survey id is rejected", forgedSurvey.ok === false && forgedSurvey.reason === "not_found", JSON.stringify(forgedSurvey));

    const forgedVersionUnit = await call("smartgov.list_requirement_answer_versions", [pedro, requirementA.rows[0].id, education]);
    check("forged unit id cannot widen LSG scope", forgedVersionUnit.ok === false && forgedVersionUnit.reason === "forbidden", JSON.stringify(forgedVersionUnit));

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

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Authority check aborted: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
