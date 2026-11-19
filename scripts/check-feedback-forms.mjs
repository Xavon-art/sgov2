import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BASE = process.env.FEEDBACK_BASE_URL ?? "http://localhost:3000";
const CREDENTIALS =
  "C:/Users/Julius M. Matro/Desktop/sir tonie projects/credentials/smartgov-test-accounts.txt";

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

function readSource(path) {
  const absolute = join(ROOT, path);
  if (!existsSync(absolute)) {
    check(`${path} exists`, false, `missing file: ${path}`);
    return null;
  }
  return { absolute, source: readFileSync(absolute, "utf8") };
}

function stripCommentsAndStrings(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
    .replace(/`(?:[^`\\]|\\.)*`/g, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, " ")
    .replace(/'(?:[^'\\]|\\.)*'/g, " ");
}

function stripSqlComments(source) {
  return source.replace(/--.*$/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

function exportsMethod(code, method) {
  return new RegExp(
    `\\bexport\\s+(?:async\\s+function|function|const|let|var)\\s+${method}\\b` +
      `|\\bexport\\s*\\{[^}]*\\b${method}\\b[^}]*\\}`,
  ).test(code);
}

function usesWebApi(code) {
  return (
    /\b(?:Response|NextResponse)\s*\.\s*(?:json|redirect|next)\s*\(/.test(code) ||
    /\bnew\s+(?:Response|NextResponse|Request|NextRequest)\s*\(/.test(code) ||
    /\bRequest\s*\.\s*(?:json|text|formData|arrayBuffer|blob)\s*\(/.test(code)
  );
}

export function assertFile(path) {
  const exists = existsSync(join(ROOT, path));
  check(`file exists: ${path}`, exists);
  return exists;
}

export function assertIncludes(path, snippets) {
  const entry = readSource(path);
  if (!entry) return;
  const missing = snippets.filter((snippet) => !entry.source.includes(snippet));
  check(
    `${path} includes ${snippets.length} expected snippet(s)`,
    missing.length === 0,
    missing.length ? `missing: ${missing.join(" | ")}` : "",
  );
}

export function assertNoIncludes(path, snippets) {
  const entry = readSource(path);
  if (!entry) return;
  const source = stripCommentsAndStrings(entry.source);
  const present = snippets.filter((snippet) => source.includes(snippet));
  check(
    `${path} excludes ${snippets.length} forbidden snippet(s)`,
    present.length === 0,
    present.length ? `present: ${present.join(" | ")}` : "",
  );
}

export function assertRouteContract(path, methods) {
  const entry = readSource(path);
  if (!entry) return;
  const { absolute, source } = entry;
  const code = stripCommentsAndStrings(source);
  const missingMethods = methods.filter((method) => !exportsMethod(code, method));
  check(
    `${path} exports ${methods.join(", ")}`,
    missingMethods.length === 0,
    missingMethods.length ? `missing exports: ${missingMethods.join(", ")}` : "",
  );
  const usesNodeHttp = /\bIncomingMessage\b|\bServerResponse\b/.test(code);
  check(`${path} uses Web Request/Response APIs`, usesWebApi(code) && !usesNodeHttp);
  check(
    `${path} does not collide with page.tsx`,
    !existsSync(join(dirname(absolute), "page.tsx")),
  );
  if (path.includes("[")) {
    check(
      `${path} awaits dynamic params`,
      /await\s+(?:params|ctx\.params|context\.params)/.test(code),
    );
  }
}

export function assertSql(path, snippets) {
  const entry = readSource(path);
  if (!entry) return;
  const source = stripSqlComments(entry.source);
  const missing = snippets.filter((snippet) => !source.includes(snippet));
  check(
    `${path} includes ${snippets.length} expected SQL snippet(s)`,
    missing.length === 0,
    missing.length ? `missing: ${missing.join(" | ")}` : "",
  );
}

function normalizeSql(source) {
  return stripSqlComments(source)
    .replace(/\s+/g, " ")
    .replace(/\s*\(\s*/g, "(")
    .replace(/\s*\)\s*/g, ")")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s*\[\s*/g, "[")
    .replace(/\s*\]\s*/g, "]")
    .toLowerCase();
}

export function assertSqlFunctions(path, signatures) {
  const entry = readSource(path);
  if (!entry) return;
  const source = normalizeSql(entry.source);
  const missing = signatures.filter(
    (signature) => !source.includes(normalizeSql(signature)),
  );
  check(
    `${path} defines ${signatures.length} expected SQL function(s)`,
    missing.length === 0,
    missing.length ? `missing: ${missing.join(" | ")}` : "",
  );
}

function parseEnv() {
  const out = {};
  const path = join(ROOT, ".env.local");
  if (!existsSync(path)) return out;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    out[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return out;
}

function parseCredentials() {
  if (!existsSync(CREDENTIALS)) return null;
  const text = readFileSync(CREDENTIALS, "utf8");
  const password = text.match(/Password for every account:\s*(\S+)/i)?.[1] ?? "";
  const emails = {};
  for (const line of text.split(/\r?\n/)) {
    const email = line.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0];
    if (!email) continue;
    if (/^\s*Owner\s*\/\s*Founder/i.test(line)) emails.owner = email;
    else if (/^\s*President\s+Pedro/i.test(line)) emails.pedro = email;
  }
  if (!password || !emails.owner || !emails.pedro) return null;
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
  return `sgov_session=${token}`;
}

async function api(path, cookie, init = {}) {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(init.headers ?? {}),
    },
  });
}

function slugFromPath(path) {
  return path?.match(/\/feedback\/f\/([A-Za-z0-9_-]{32})$/)?.[1] ?? "";
}

async function cleanupForm(client, formId) {
  await client.query("delete from smartgov.feedback_responses where form_id = $1", [formId]);
  await client.query("delete from smartgov.feedback_questions where form_id = $1", [formId]);
  await client.query("delete from smartgov.feedback_form_scopes where form_id = $1", [formId]);
  await client.query("delete from smartgov.feedback_forms where id = $1", [formId]);
  await client.query(
    "delete from smartgov.rate_limits where bucket like 'feedback:submit:%' and bucket like '%' || $1::text || '#%'",
    [formId],
  );
}

async function feedbackIntegrationChecks() {
  let reachable = false;
  try {
    const res = await fetch(`${BASE}/login`, { redirect: "manual" });
    reachable = res.status < 500;
  } catch {
    reachable = false;
  }
  if (!reachable) {
    console.log("  SKIP  feedback API integration (server is not running)");
    return;
  }

  const env = parseEnv();
  const credentials = parseCredentials();
  if (!env.DATABASE_URL || !credentials) {
    console.log("  SKIP  feedback API integration (database or credentials unavailable)");
    return;
  }

  let owner = "";
  let pedro = "";
  try {
    owner = await login(credentials.emails.owner, credentials.password);
    pedro = await login(credentials.emails.pedro, credentials.password);
    check("owner and Pedro authenticate for feedback integration", Boolean(owner && pedro));
  } catch (error) {
    check("owner and Pedro authenticate for feedback integration", false, error.message);
    return;
  }

  const client = new pg.Client({
    connectionString: env.DATABASE_URL,
    ssl: /sslmode=require/.test(env.DATABASE_URL)
      ? { rejectUnauthorized: false }
      : undefined,
  });
  await client.connect();

  let formId = "";
  try {
    const createRes = await api("/api/feedback/forms", owner, {
      method: "POST",
      body: JSON.stringify({
        title: `Feedback integration ${Date.now()}`,
        description: null,
        scope: "university",
        unitIds: [],
        unitTypes: [],
        accessMode: "public_link",
        identityMode: "anonymous",
      }),
    });
    const createJson = await createRes.json();
    formId = createJson.formId ?? "";
    check(
      "owner creates a temporary feedback form",
      createRes.ok && createJson.ok === true && Boolean(formId),
      JSON.stringify(createJson),
    );
    if (!formId) throw new Error("temporary form was not created");

    const questionsRes = await api(`/api/feedback/forms/${formId}/questions`, owner, {
      method: "POST",
      body: JSON.stringify({
        questions: [
          {
            qtype: "short_text",
            fieldKey: null,
            title: "Formula answer",
            description: null,
            required: true,
            options: [],
            scaleMin: null,
            scaleMax: null,
            scaleLabelLow: null,
            scaleLabelHigh: null,
          },
        ],
      }),
    });
    const questionsJson = await questionsRes.json();
    check(
      "owner saves one feedback question",
      questionsRes.ok && questionsJson.ok === true && questionsJson.count === 1,
      JSON.stringify(questionsJson),
    );

    const detailRes = await api(`/api/feedback/forms/${formId}`, owner);
    const detailJson = await detailRes.json();
    const questionId = detailJson.questions?.[0]?.id ?? "";
    check("saved question has an id", Boolean(questionId));

    const openRes = await api(`/api/feedback/forms/${formId}/status`, owner, {
      method: "POST",
      body: JSON.stringify({ status: "open" }),
    });
    const openJson = await openRes.json();
    const slug = slugFromPath(openJson.publicPath);
    check(
      "opening a public form returns a 32-character slug",
      openRes.ok && openJson.ok === true && slug.length === 32,
      JSON.stringify(openJson),
    );

    const publicRes = await fetch(`${BASE}/api/feedback/public/${slug}`);
    const publicJson = await publicRes.json();
    check(
      "public form loads anonymously",
      publicRes.ok && publicJson.ok === true && publicJson.form?.questions?.length === 1,
      JSON.stringify(publicJson),
    );

    const submitRes = await fetch(`${BASE}/api/feedback/public/${slug}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        answers: { [questionId]: "=SUM(A1:A2)" },
        respondentName: "Ignored Name",
        respondentEmail: "ignored@example.test",
      }),
    });
    const submitJson = await submitRes.json();
    check(
      "public anonymous response is accepted",
      submitRes.ok && submitJson.ok === true && Boolean(submitJson.responseId),
      JSON.stringify(submitJson),
    );

    const responsesRes = await api(`/api/feedback/forms/${formId}/responses`, owner);
    const responsesJson = await responsesRes.json();
    const response = responsesJson.responses?.[0];
    check(
      "anonymous response stores null identity fields",
      responsesRes.ok &&
        responsesJson.ok === true &&
        response?.submittedBy === null &&
        response?.respondentName === null &&
        response?.respondentEmail === null,
      JSON.stringify(response),
    );

    const ackRes = await api(
      `/api/feedback/forms/${formId}/responses/${response?.id}/acknowledge`,
      owner,
      { method: "POST" },
    );
    const ackJson = await ackRes.json();
    check(
      "owner acknowledges the response",
      ackRes.ok && ackJson.ok === true && ackJson.status === "acknowledged",
      JSON.stringify(ackJson),
    );

    const exportRes = await api(`/api/feedback/forms/${formId}/export`, owner);
    const csv = await exportRes.text();
    check(
      "CSV export keeps the expected header",
      exportRes.ok && csv.startsWith("submitted_at,status,respondent_name,respondent_email,"),
      csv.slice(0, 160),
    );
    check("CSV export prefixes formula cells", csv.includes("'=SUM(A1:A2)"), csv);

    const closeRes = await api(`/api/feedback/forms/${formId}/status`, owner, {
      method: "POST",
      body: JSON.stringify({ status: "closed" }),
    });
    const closeJson = await closeRes.json();
    check("owner closes the form", closeRes.ok && closeJson.ok === true);
    const closedPublic = await fetch(`${BASE}/api/feedback/public/${slug}`);
    check("closed form is not public", closedPublic.status === 404, `got ${closedPublic.status}`);

    const reopenRes = await api(`/api/feedback/forms/${formId}/status`, owner, {
      method: "POST",
      body: JSON.stringify({ status: "open" }),
    });
    const reopenJson = await reopenRes.json();
    check("owner reopens the form", reopenRes.ok && reopenJson.ok === true);

    const regenRes = await api(`/api/feedback/forms/${formId}/link`, owner, {
      method: "POST",
    });
    const regenJson = await regenRes.json();
    const newSlug = slugFromPath(regenJson.publicPath);
    check(
      "regenerating the link returns a new 32-character slug",
      regenRes.ok && newSlug.length === 32 && newSlug !== slug,
      JSON.stringify(regenJson),
    );
    const oldSlugRes = await fetch(`${BASE}/api/feedback/public/${slug}`);
    const newSlugRes = await fetch(`${BASE}/api/feedback/public/${newSlug}`);
    check("old public slug stops working", oldSlugRes.status === 404, `got ${oldSlugRes.status}`);
    check("new public slug works", newSlugRes.status === 200, `got ${newSlugRes.status}`);

    const unauthForms = await fetch(`${BASE}/api/feedback/forms`);
    const unauthResponses = await fetch(
      `${BASE}/api/feedback/forms/${formId}/responses`,
    );
    check("anonymous form management returns 401", unauthForms.status === 401);
    check("anonymous response management returns 401", unauthResponses.status === 401);
  } catch (error) {
    check("feedback API integration completed", false, error.message);
  } finally {
    if (formId) {
      try {
        await cleanupForm(client, formId);
      } catch (error) {
        check("feedback integration cleanup succeeded", false, error.message);
      }
    }
    await client.end();
  }
}

async function main() {
  assertFile("supabase/migrations/20260101003300_feedback_forms.sql");
  assertSql("supabase/migrations/20260101003300_feedback_forms.sql", [
    "create table if not exists smartgov.feedback_forms",
    "create table if not exists smartgov.feedback_form_scopes",
    "create table if not exists smartgov.feedback_questions",
    "create table if not exists smartgov.feedback_responses",
    "public_slug",
    "scope",
    "access_mode",
    "identity_mode",
    "order_index",
    "qtype",
    "field_key",
    "scale_label_low",
    "scale_label_high",
    "acknowledged_by",
    "acknowledged_at",
    "submitted_at",
    "alter table smartgov.account_permissions drop constraint if exists account_permissions_known",
    "permission in ('can_invite', 'can_target_units')",
    "alter table smartgov.feedback_forms enable row level security",
    "alter table smartgov.feedback_form_scopes enable row level security",
    "alter table smartgov.feedback_questions enable row level security",
    "alter table smartgov.feedback_responses enable row level security",
    "revoke all on smartgov.feedback_forms from public, anon, authenticated",
    "revoke all on smartgov.feedback_form_scopes from public, anon, authenticated",
    "revoke all on smartgov.feedback_questions from public, anon, authenticated",
    "revoke all on smartgov.feedback_responses from public, anon, authenticated",
  ]);
  assertNoIncludes("supabase/migrations/20260101003300_feedback_forms.sql", [
    "create policy",
    "grant select on smartgov.feedback_forms",
    "grant insert on smartgov.feedback_forms",
    "grant update on smartgov.feedback_forms",
    "grant delete on smartgov.feedback_forms",
    "grant select on smartgov.feedback_form_scopes",
    "grant insert on smartgov.feedback_form_scopes",
    "grant update on smartgov.feedback_form_scopes",
    "grant delete on smartgov.feedback_form_scopes",
    "grant select on smartgov.feedback_questions",
    "grant insert on smartgov.feedback_questions",
    "grant update on smartgov.feedback_questions",
    "grant delete on smartgov.feedback_questions",
    "grant select on smartgov.feedback_responses",
    "grant insert on smartgov.feedback_responses",
    "grant update on smartgov.feedback_responses",
    "grant delete on smartgov.feedback_responses",
    "service_role",
  ]);

  assertSqlFunctions("supabase/migrations/20260101003300_feedback_forms.sql", [
    "create or replace function smartgov.feedback_form_can_manage(p_account smartgov.accounts, p_form smartgov.feedback_forms) returns boolean",
    "create or replace function smartgov.feedback_form_can_review(p_account smartgov.accounts, p_form smartgov.feedback_forms) returns boolean",
    "create or replace function smartgov.feedback_form_matches_account(p_account smartgov.accounts, p_form smartgov.feedback_forms) returns boolean",
    "create or replace function smartgov.feedback_form_is_locked(p_form_id uuid) returns boolean",
    "create or replace function smartgov.list_feedback_forms(p_session_token text) returns jsonb",
    "create or replace function smartgov.get_feedback_form(p_session_token text, p_form_id uuid) returns jsonb",
    "create or replace function smartgov.create_feedback_form(p_session_token text, p_title text, p_description text, p_scope text, p_unit_ids uuid[], p_unit_types text[], p_access_mode text, p_identity_mode text) returns jsonb",
    "create or replace function smartgov.update_feedback_form(p_session_token text, p_form_id uuid, p_title text, p_description text, p_scope text, p_unit_ids uuid[], p_unit_types text[], p_access_mode text, p_identity_mode text) returns jsonb",
    "create or replace function smartgov.validate_feedback_form_audience(p_account smartgov.accounts, p_scope text, p_unit_ids uuid[], p_unit_types text[]) returns jsonb",
  ]);
  assertSqlFunctions("supabase/migrations/20260101003300_feedback_forms.sql", [
    "create or replace function smartgov.save_feedback_questions(p_session_token text, p_form_id uuid, p_questions jsonb) returns jsonb",
    "create or replace function smartgov.set_feedback_form_status(p_session_token text, p_form_id uuid, p_status text) returns jsonb",
    "create or replace function smartgov.regenerate_feedback_link(p_session_token text, p_form_id uuid) returns jsonb",
    "create or replace function smartgov.delete_feedback_form(p_session_token text, p_form_id uuid) returns jsonb",
  ]);
  assertSqlFunctions("supabase/migrations/20260101003340_feedback_status_transition_fix.sql", [
    "create or replace function smartgov.set_feedback_form_status(p_session_token text, p_form_id uuid, p_status text) returns jsonb",
  ]);
  assertSql("supabase/migrations/20260101003340_feedback_status_transition_fix.sql", [
    "set status = v_status",
  ]);
  assertSql("supabase/migrations/20260101003300_feedback_forms.sql", [
    "grant execute on function public.list_feedback_forms(text) to anon, authenticated",
    "grant execute on function public.get_feedback_form(text, uuid) to anon, authenticated",
    "grant execute on function public.create_feedback_form(text, text, text, text, uuid[], text[], text, text) to anon, authenticated",
    "grant execute on function public.update_feedback_form(text, uuid, text, text, text, uuid[], text[], text, text) to anon, authenticated",
    "grant execute on function public.save_feedback_questions(text, uuid, jsonb) to anon, authenticated",
    "grant execute on function public.set_feedback_form_status(text, uuid, text) to anon, authenticated",
    "grant execute on function public.regenerate_feedback_link(text, uuid) to anon, authenticated",
    "grant execute on function public.delete_feedback_form(text, uuid) to anon, authenticated",
  ]);
  assertSql("supabase/migrations/20260101003300_feedback_forms.sql", [
    "questions_locked",
    "no_questions",
    "invalid_questions",
    "form_not_open",
    "responses_exist",
    "gen_random_bytes(24)",
  ]);
  assertNoIncludes("supabase/migrations/20260101003300_feedback_forms.sql", [
    "grant execute on function public.list_feedback_forms(text) to public",
    "grant execute on function public.get_feedback_form(text, uuid) to public",
    "grant execute on function public.create_feedback_form(text, text, text, text, uuid[], text[], text, text) to public",
    "grant execute on function public.update_feedback_form(text, uuid, text, text, text, uuid[], text[], text, text) to public",
    "grant execute on function public.save_feedback_questions(text, uuid, jsonb) to public",
    "grant execute on function public.set_feedback_form_status(text, uuid, text) to public",
    "grant execute on function public.regenerate_feedback_link(text, uuid) to public",
    "grant execute on function public.delete_feedback_form(text, uuid) to public",
  ]);

  assertSqlFunctions("supabase/migrations/20260101003300_feedback_forms.sql", [
    "create or replace function smartgov.list_available_feedback_forms(p_session_token text) returns jsonb",
    "create or replace function smartgov.get_feedback_form_for_response(p_session_token text, p_form_id uuid) returns jsonb",
    "create or replace function smartgov.submit_feedback_response(p_session_token text, p_form_id uuid, p_answers jsonb, p_respondent_name text, p_respondent_email text) returns jsonb",
    "create or replace function smartgov.get_public_feedback_form(p_slug text) returns jsonb",
    "create or replace function smartgov.submit_public_feedback_response(p_slug text, p_answers jsonb, p_respondent_name text, p_respondent_email text) returns jsonb",
  ]);
  assertSql("supabase/migrations/20260101003300_feedback_forms.sql", [
    "feedback:submit:",
    "feedback:public:",
    "consume_rate_limit",
    "rate_limited",
    "invalid_answers",
    "invalid_respondent",
    "invalid_slug",
    "v_submitted_by := null",
    "v_respondent_name := null",
    "v_respondent_email := null",
    "grant execute on function public.list_available_feedback_forms(text) to anon, authenticated",
    "grant execute on function public.get_feedback_form_for_response(text, uuid) to anon, authenticated",
    "grant execute on function public.submit_feedback_response(text, uuid, jsonb, text, text) to anon, authenticated",
    "grant execute on function public.get_public_feedback_form(text) to anon, authenticated",
    "grant execute on function public.submit_public_feedback_response(text, jsonb, text, text) to anon, authenticated",
  ]);
  assertNoIncludes("supabase/migrations/20260101003300_feedback_forms.sql", [
    "grant execute on function public.list_available_feedback_forms(text) to public",
    "grant execute on function public.get_feedback_form_for_response(text, uuid) to public",
    "grant execute on function public.submit_feedback_response(text, uuid, jsonb, text, text) to public",
    "grant execute on function public.get_public_feedback_form(text) to public",
    "grant execute on function public.submit_public_feedback_response(text, jsonb, text, text) to public",
  ]);

  assertSqlFunctions("supabase/migrations/20260101003300_feedback_forms.sql", [
    "create or replace function smartgov.list_feedback_responses(p_session_token text, p_form_id uuid) returns jsonb",
    "create or replace function smartgov.acknowledge_feedback_response(p_session_token text, p_response_id uuid) returns jsonb",
  ]);
  assertSql("supabase/migrations/20260101003300_feedback_forms.sql", [
    "feedback_response_acknowledge",
    "case when v_form.identity_mode = 'anonymous' then null",
    "grant execute on function public.list_feedback_responses(text, uuid) to anon, authenticated",
    "grant execute on function public.acknowledge_feedback_response(text, uuid) to anon, authenticated",
  ]);
  assertNoIncludes("supabase/migrations/20260101003300_feedback_forms.sql", [
    "grant execute on function public.list_feedback_responses(text, uuid) to public",
    "grant execute on function public.acknowledge_feedback_response(text, uuid) to public",
  ]);

  assertFile("src/lib/feedback.ts");
  assertFile("src/app/api/feedback/route.ts");
  assertFile("src/app/api/feedback/[id]/route.ts");
  assertFile("src/app/api/feedback/[id]/acknowledge/route.ts");
  assertIncludes("src/lib/feedback.ts", [
    "createFeedback",
    "listFeedback",
    "getFeedback",
    "acknowledgeFeedback",
  ]);

  const managementRoutes = [
    ["src/app/api/feedback/forms/route.ts", ["GET", "POST"]],
    ["src/app/api/feedback/forms/[id]/route.ts", ["GET", "PATCH", "DELETE"]],
    ["src/app/api/feedback/forms/[id]/questions/route.ts", ["POST"]],
    ["src/app/api/feedback/forms/[id]/status/route.ts", ["POST"]],
    ["src/app/api/feedback/forms/[id]/link/route.ts", ["POST"]],
    ["src/app/api/feedback/forms/[id]/responses/route.ts", ["GET"]],
    [
      "src/app/api/feedback/forms/[id]/responses/[responseId]/acknowledge/route.ts",
      ["POST"],
    ],
    ["src/app/api/feedback/forms/[id]/export/route.ts", ["GET"]],
  ];
  for (const [path, methods] of managementRoutes) {
    assertRouteContract(path, methods);
    assertIncludes(path, ["readSessionToken()"]);
  }

  assertRouteContract("src/app/api/feedback/available/route.ts", ["GET"]);
  assertIncludes("src/app/api/feedback/available/route.ts", [
    "readSessionToken()",
  ]);
  assertRouteContract("src/app/api/feedback/forms/[id]/respond/route.ts", [
    "GET",
    "POST",
  ]);
  assertIncludes("src/app/api/feedback/forms/[id]/respond/route.ts", [
    "readSessionToken()",
  ]);
  assertRouteContract("src/app/api/feedback/public/[slug]/route.ts", [
    "GET",
    "POST",
  ]);
  assertNoIncludes("src/app/api/feedback/public/[slug]/route.ts", [
    "readSessionToken",
    "p_session_token",
  ]);
  assertFile("src/app/feedback/f/[token]/page.tsx");
  assertIncludes("src/app/feedback/f/[token]/page.tsx", [
    "PublicFeedbackForm",
    "await params",
    "getPublicFeedbackForm",
    "public-feedback-form-page",
  ]);
  assertNoIncludes("src/app/feedback/f/[token]/page.tsx", [
    'redirect("/login")',
    "currentAccount()",
  ]);
  assertFile("src/components/dashboard/PublicFeedbackForm.tsx");
  assertIncludes("src/components/dashboard/PublicFeedbackForm.tsx", [
    "public-feedback-form",
    "Response recorded",
  ]);

  assertFile("src/components/dashboard/FeedbackWorkspace.tsx");
  assertIncludes("src/components/dashboard/FeedbackWorkspace.tsx", [
    "FeedbackFormsPanel",
    "FeedbackResponsesPanel",
    "FeedbackAnswerPanel",
    "FeedbackPanel",
    "Forms",
    "Responses",
    "Answer",
    "Direct messages",
    'data-testid="feedback-workspace"',
  ]);
  assertIncludes("src/components/dashboard/FeedbackFormsPanel.tsx", [
    "/api/feedback/forms",
    "No feedback forms yet.",
    "FeedbackFormBuilder",
    'data-testid="feedback-form-new"',
    'data-testid="feedback-form-list"',
  ]);
  assertIncludes("src/components/dashboard/FeedbackFormBuilder.tsx", [
    "/api/feedback/forms/",
    "/questions",
    "/status",
    "/link",
    "can_target_units",
    "form_locked",
    "questionsLocked",
    "FeedbackQuestionEditor",
    'data-testid="feedback-form-builder"',
  ]);
  assertIncludes("src/app/usg/manage/ManageClient.tsx", ["FeedbackWorkspace"]);
  assertNoIncludes("src/app/usg/manage/ManageClient.tsx", ["FeedbackPanel mode="]);
  assertIncludes("src/app/lsg/manage/page.tsx", ["FeedbackWorkspace"]);
  assertNoIncludes("src/app/lsg/manage/page.tsx", ["FeedbackPanel mode="]);

  assertFile("src/components/dashboard/FeedbackQuestionEditor.tsx");
  assertIncludes("src/components/dashboard/FeedbackQuestionEditor.tsx", [
    "Short answer",
    "Long answer",
    "Multiple choice",
    "Checkboxes",
    "Dropdown",
    "Rating",
    "Linear scale",
    "Date",
    "Time",
    "Full name",
    "Email",
    "Student number",
    "Year level",
    "Program",
    "Section",
    "Campus",
    "full_name",
    "student_number",
    "year_level",
    "feedback-quick-add-",
    'data-testid="feedback-question-editor"',
    'data-testid="feedback-question"',
    "questions_locked",
  ]);
  assertIncludes("src/components/dashboard/FeedbackFormBuilder.tsx", [
    "questions.length === 0",
    "canSave",
    "questionIssue",
  ]);

  assertFile("src/components/dashboard/FeedbackQuestionFields.tsx");
  assertIncludes("src/components/dashboard/FeedbackQuestionFields.tsx", [
    "FeedbackQuestionField",
    "isBlankAnswer",
  ]);
  assertIncludes("src/components/dashboard/PublicFeedbackForm.tsx", [
    "FeedbackQuestionField",
    "isBlankAnswer",
  ]);
  assertFile("src/components/dashboard/FeedbackResponsesPanel.tsx");
  assertIncludes("src/components/dashboard/FeedbackResponsesPanel.tsx", [
    "/api/feedback/forms",
    "/responses",
    "/acknowledge",
    "/export",
    "No responses yet.",
    "Anonymous",
    'data-testid="feedback-responses-panel"',
    'data-testid="feedback-response-row"',
  ]);
  assertFile("src/components/dashboard/FeedbackAnswerPanel.tsx");
  assertIncludes("src/components/dashboard/FeedbackAnswerPanel.tsx", [
    "/api/feedback/available",
    "/respond",
    "Response recorded",
    "No feedback forms are open for you right now.",
    'data-testid="feedback-answer-panel"',
  ]);

  assertIncludes("src/app/api/permissions/route.ts", [
    'const PERMISSIONS = new Set(["can_invite", "can_target_units"])',
    "Grantable permissions are widened by migration, not by input.",
  ]);
  assertIncludes("src/components/dashboard/AccountsPanel.tsx", [
    "/api/permissions",
    "Cross-unit feedback",
    "can_target_units",
    "USG-wide targeting stays USG-only.",
    'data-testid="feedback-cross-unit-toggle"',
  ]);

  await feedbackIntegrationChecks();

  console.log(
    failures === 0
      ? `\nall ${checks} checks passed\n`
      : `\n${failures} of ${checks} checks FAILED\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

await main();
