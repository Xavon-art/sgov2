import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import pg from "pg";
import { assertNavIdsStable, LSG_STABLE_NAV_IDS, STABLE_NAV_IDS } from "./check-federated-features.mjs";
import { readTestAccounts } from "./test-fixtures.mjs";

export const DASHBOARD_AUDIT_TARGET = 30;

const BASE = process.env.DASHBOARD_AUDIT_BASE_URL ?? "http://localhost:3000";
const fixture = readTestAccounts();
const password = fixture.password;
const ACCOUNTS = {
  owner: fixture.emails.usg,
  nonOwner: fixture.emails.reviewer ?? fixture.emails.lsg2,
  lsg: fixture.emails.lsg,
};

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

function account(role) {
  const email = ACCOUNTS[role];
  if (!email || !password) throw new Error("Fixture credentials are missing expected accounts.");
  return email;
}

function loadEnv(source) {
  const values = {};
  let file;
  try {
    file = readFileSync(source, "utf8");
  } catch {
    return values;
  }
  for (const line of file.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function withParam(url, key, value) {
  if (new RegExp(`[?&]${key}=`, "i").test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${key}=${value}`;
}

const ORPHAN_LABELS = [
  "feedback_form_scopes.form_id",
  "feedback_questions.form_id",
  "feedback_responses.form_id",
  "feedback_responses.acknowledged_by",
  "feedback_forms.created_by",
];

async function feedbackOrphanChecks() {
  const env = loadEnv(new URL("../.env.local", import.meta.url));
  const rawUrl = process.env.DATABASE_URL || env.DATABASE_URL;
  if (!rawUrl) {
    for (const label of ORPHAN_LABELS) {
      check(`${label} has no orphaned rows`, false, "DATABASE_URL is not set");
    }
    return;
  }

  const pool = new pg.Pool({
    connectionString: withParam(withParam(rawUrl, "sslmode", "require"), "uselibpqcompat", "true"),
    max: 1,
    application_name: "smartgov_dashboard_audit",
    connectionTimeoutMillis: 5000,
    query_timeout: 15000,
    statement_timeout: 8000,
  });

  try {
    const { rows } = await pool.query(`
      select 'feedback_form_scopes.form_id' as name, count(*)::int as orphans
        from smartgov.feedback_form_scopes s
        left join smartgov.feedback_forms f on f.id = s.form_id
       where f.id is null
      union all
      select 'feedback_questions.form_id', count(*)::int
        from smartgov.feedback_questions q
        left join smartgov.feedback_forms f on f.id = q.form_id
       where f.id is null
      union all
      select 'feedback_responses.form_id', count(*)::int
        from smartgov.feedback_responses r
        left join smartgov.feedback_forms f on f.id = r.form_id
       where f.id is null
      union all
      select 'feedback_responses.acknowledged_by', count(*)::int
        from smartgov.feedback_responses r
        left join smartgov.accounts a on a.id = r.acknowledged_by
       where r.acknowledged_by is not null and a.id is null
      union all
      select 'feedback_forms.created_by', count(*)::int
        from smartgov.feedback_forms f
        left join smartgov.accounts a on a.id = f.created_by
       where a.id is null
    `);
    const counts = new Map(rows.map((row) => [row.name, Number(row.orphans)]));
    for (const label of ORPHAN_LABELS) {
      const orphans = counts.get(label);
      check(
        `${label} has no orphaned rows`,
        orphans === 0,
        `orphans=${orphans ?? "missing"}`,
      );
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 240) : String(error);
    for (const label of ORPHAN_LABELS) {
      check(`${label} has no orphaned rows`, false, detail);
    }
  } finally {
    await pool.end().catch(() => {});
  }
}

async function dismissTour(page) {
  for (let i = 0; i < 4; i += 1) {
    const dialog = page.getByRole("dialog");
    if (!(await dialog.count())) return;
    const skip = dialog.getByRole("button", { name: /skip|close|later|not now/i }).first();
    if (await skip.count()) await skip.click();
    else await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
  }
}

async function signIn(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  await dismissTour(page);
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole("button", { name: /sign in/i }).first().click();
  await page.waitForFunction(() => /^\/(usg|lsg)(\/|$)/.test(window.location.pathname), null, {
    timeout: 60000,
  });
  await page.waitForTimeout(600);
  await dismissTour(page);
}

async function visit(page, href) {
  const anchor = page.locator(`a[href="${href}"]`).first();
  if (!(await anchor.count())) throw new Error(`No visible link for ${href}`);
  const badResponses = [];
  const onResponse = (response) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${new URL(response.url()).pathname}`);
  };
  page.on("response", onResponse);
  await anchor.click();
  await page.waitForTimeout(900);
  await dismissTour(page);
  page.off("response", onResponse);
  return badResponses;
}

async function ownerNavCheck(page) {
  await signIn(page, account("owner"));
  await visit(page, "/usg/manage");
  check("owner keeps the People & Units child link", (await page.locator('a[href="/usg/manage?tab=people&view=units"]').count()) > 0);
  check("owner keeps the Structure child link", (await page.locator('a[href="/usg/manage?tab=structure"]').count()) > 0);
}

async function officerNavAndApiCheck(page) {
  await signIn(page, account("nonOwner"));
  await visit(page, "/usg/manage");
  check("non-owner account does not see the owner-only People & Units link", (await page.locator('a[href="/usg/manage?tab=people&view=units"]').count()) === 0);
  check("non-owner account does not see the owner-only Structure link", (await page.locator('a[href="/usg/manage?tab=structure"]').count()) === 0);

  const units = await page.evaluate(async () => {
    const res = await fetch("/api/units");
    const body = await res.json().catch(() => ({}));
    return { status: res.status, ok: body.ok, count: Array.isArray(body.units) ? body.units.length : -1 };
  });
  check("non-owner account can read assignable units", units.status === 200 && units.ok && units.count > 0, JSON.stringify(units));

  const requestErrors = await visit(page, "/usg/request");
  check("non-owner Request page has no forbidden API response", requestErrors.length === 0, requestErrors.join(" | "));
  const eventErrors = await visit(page, "/usg/events");
  check("non-owner Events page has no forbidden API response", eventErrors.length === 0, eventErrors.join(" | "));
}

async function overviewCheck(page) {
  await signIn(page, account("lsg"));
  const data = await page.evaluate(async () => {
    const get = async (url) => (await fetch(url)).json().catch(() => ({}));
    const [overview, tasks, requests] = await Promise.all([
      get("/api/overview?side=lsg"),
      get("/api/tasks"),
      get("/api/requests"),
    ]);
    return { overview, tasks, requests };
  });
  const expectedTasks = (data.tasks.tasks ?? []).filter((task) => !task.closed).length;
  const expectedRequests = (data.requests.requests ?? []).filter((req) => req.status === "submitted").length;
  check("overview task count matches the open task list", data.overview.counts?.tasksOpen === expectedTasks, `got ${data.overview.counts?.tasksOpen}, expected ${expectedTasks}`);
  check("overview request count matches the submitted request list", data.overview.counts?.requestsOpen === expectedRequests, `got ${data.overview.counts?.requestsOpen}, expected ${expectedRequests}`);

  const breakdown = data.overview.breakdown ?? {};
  for (const key of ["tasks", "requests", "events", "surveys"]) {
    check(`overview exposes ${key} report breakdown`, Boolean(breakdown[key] && typeof breakdown[key] === "object"));
  }

  const statusCounts = data.overview.lsg?.statusCounts ?? {};
  check(
    "overview returns the LSG linear path payload",
    Boolean(data.overview.lsg),
    JSON.stringify(data.overview.lsg ?? null),
  );
  check(
    "LSG status strip exposes all five statuses",
    ["pending", "under_review", "returned", "approved", "overdue"].every(
      (key) => typeof statusCounts[key] === "number",
    ),
    JSON.stringify(statusCounts),
  );

  await visit(page, "/lsg");
  check("overview renders the status strip", (await page.locator('[data-tour="workspace-tiles"]').count()) === 1);
  check("overview renders the next action panel", (await page.locator('[data-tour="workspace-overview-action"]').count()) === 1);
  check("overview renders the due soon panel", (await page.locator('[data-tour="workspace-overview-list"]').count()) === 1);
  check("overview renders recent USG decisions", (await page.getByText("Recent USG decisions", { exact: false }).count()) > 0);
  check("overview renders the unit budget panel", (await page.locator('[data-tour="workspace-overview-budget"]').count()) === 1);
  check("overview renders shortcuts", (await page.locator('[data-tour="workspace-shortcuts"]').count()) === 1);
  check("overview no longer exposes saved-layout customization", (await page.getByRole("button", { name: /^customize/i }).count()) === 0);
}

async function lsgRequestTourCheck(page) {
  await signIn(page, account("lsg"));
  await page.evaluate(() => window.next.router.push("/lsg/request"));
  await page.locator('[data-tour="request-file-personal"]').first().waitFor({ state: "attached", timeout: 15000 }).catch(() => {});
  await dismissTour(page);
  check("LSG Request tour can find the File request control", (await page.locator('[data-tour="request-file-personal"]').count()) > 0);
  check("LSG Request tour can find the Task list", (await page.locator('[data-tour="request-task-list"]').count()) > 0);
}

async function main() {
  assertNavIdsStable("usg", STABLE_NAV_IDS);
  assertNavIdsStable("lsg", LSG_STABLE_NAV_IDS);
  await feedbackOrphanChecks();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(15000);
  try {
    await ownerNavCheck(page);
    await officerNavAndApiCheck(page);
    await lsgRequestTourCheck(page);
    await overviewCheck(page);
  } catch (error) {
    check("dashboard audit completed", false, error.message.slice(0, 300));
  } finally {
    await browser.close();
  }
  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (
    checks !== DASHBOARD_AUDIT_TARGET ||
    checks - failures !== DASHBOARD_AUDIT_TARGET
  ) {
    console.error(
      `dashboard audit target changed: expected ${DASHBOARD_AUDIT_TARGET}/${DASHBOARD_AUDIT_TARGET}, got ${checks - failures}/${checks}`,
    );
    process.exitCode = 1;
  }
  if (failures > 0) process.exitCode = 1;
}

await main();
