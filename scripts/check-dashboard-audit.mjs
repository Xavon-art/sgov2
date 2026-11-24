import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import pg from "pg";
import { assertNavIdsStable, LSG_STABLE_NAV_IDS, STABLE_NAV_IDS } from "./check-federated-features.mjs";

export const DASHBOARD_AUDIT_TARGET = 30;

const BASE = process.env.DASHBOARD_AUDIT_BASE_URL ?? "http://localhost:3000";
const CREDENTIALS =
  "C:/Users/Julius M. Matro/Desktop/sir tonie projects/credentials/smartgov-test-accounts.txt";
const text = readFileSync(CREDENTIALS, "utf8");
const lines = text.split(/\r?\n/);
const password = text.match(/Password for every account:\s*(\S+)/i)?.[1] ?? "";

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

function account(lineNumber) {
  const email = lines[lineNumber - 1].match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0];
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
  await signIn(page, account(14));
  await visit(page, "/usg/manage");
  check("owner keeps the Umbrella child link", (await page.locator('a[href="/usg/manage?tab=umbrella"]').count()) > 0);
  check("owner keeps the Invites child link", (await page.locator('a[href="/usg/manage?tab=invites"]').count()) > 0);
  check("owner keeps the Structure child link", (await page.locator('a[href="/usg/manage?tab=structure"]').count()) > 0);
}

async function officerNavAndApiCheck(page) {
  await signIn(page, account(9));
  await visit(page, "/usg/manage");
  check("USG officer does not see the owner-only Umbrella link", (await page.locator('a[href="/usg/manage?tab=umbrella"]').count()) === 0);
  check("USG officer does not see the owner-only Invites link", (await page.locator('a[href="/usg/manage?tab=invites"]').count()) === 0);
  check("USG officer does not see the owner-only Structure link", (await page.locator('a[href="/usg/manage?tab=structure"]').count()) === 0);

  const units = await page.evaluate(async () => {
    const res = await fetch("/api/units");
    const body = await res.json().catch(() => ({}));
    return { status: res.status, ok: body.ok, count: Array.isArray(body.units) ? body.units.length : -1 };
  });
  check("USG officer can read assignable units", units.status === 200 && units.ok && units.count > 0, JSON.stringify(units));

  const requestErrors = await visit(page, "/usg/request");
  check("USG officer Request page has no forbidden API response", requestErrors.length === 0, requestErrors.join(" | "));
  const eventErrors = await visit(page, "/usg/events");
  check("USG officer Events page has no forbidden API response", eventErrors.length === 0, eventErrors.join(" | "));
}

async function overviewCheck(page) {
  await signIn(page, account(17));
  const data = await page.evaluate(async () => {
    const get = async (url) => (await fetch(url)).json().catch(() => ({}));
    const [overview, tasks, requests] = await Promise.all([
      get("/api/overview"),
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

  await page.getByRole("button", { name: /^customize/i }).first().click();
  await page.getByRole("button", { name: /^reset$/i }).click();
  await page.waitForTimeout(700);

  const widgets = page.locator('[data-tour="workspace-widgets"]');
  check("overview renders the widget area", (await widgets.count()) === 1);
  for (const label of ["At a glance", "Report summary", "Task status", "Request status", "Workflow"]) {
    check(`overview renders the ${label} widget`, (await widgets.getByText(label, { exact: false }).count()) > 0);
  }

  await page.getByRole("button", { name: /^customize/i }).first().click();
  const reportCard = page.locator('[data-widget="reports"]');
  if ((await reportCard.getByRole("button", { name: /^show$/i }).count()) > 0) {
    await reportCard.getByRole("button", { name: /^show$/i }).click();
    await page.getByRole("button", { name: /^save layout$/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /^customize/i }).first().click();
  }
  await reportCard.getByRole("button", { name: /^hide$/i }).click();
  await page.getByRole("button", { name: /^save layout$/i }).click();
  await page.waitForTimeout(800);
  await visit(page, "/lsg/manage");
  await visit(page, "/lsg");
  await page
    .waitForFunction(
      () => {
        if (!document.querySelector('[data-tour="workspace-widgets"]')) return false;
        return !document.querySelector('[data-widget="reports"]');
      },
      null,
      { timeout: 8000 },
    )
    .catch(() => {});
  const hiddenState = await page.evaluate(async () => ({
    prefs: await (await fetch("/api/dashboard/layout")).json(),
    cards: document.querySelectorAll('[data-widget="reports"]').length,
  }));
  check(
    "hidden overview widget stays hidden after navigation",
    hiddenState.cards === 0,
    JSON.stringify(hiddenState),
  );

  await page.getByRole("button", { name: /^customize/i }).first().click();
  await page.getByRole("button", { name: /^reset$/i }).click();
  await page.waitForTimeout(600);
  check("reset restores hidden overview widgets", (await page.locator('[data-widget="reports"]').count()) > 0);
}

async function lsgRequestTourCheck(page) {
  await signIn(page, account(17));
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
