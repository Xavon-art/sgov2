import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { readTestAccounts } from "./test-fixtures.mjs";

const BASE = process.env.PHASE10_BASE_URL ?? process.env.E2E_BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.PHASE10_SHOTS ?? "C:/Users/Julius M. Matro/Desktop/sir tonie projects/screenshots/phase10";
const fixture = readTestAccounts();

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

async function dismissTour(page) {
  for (let index = 0; index < 3; index += 1) {
    const skip = page.getByRole("button", { name: /skip/i }).first();
    if ((await skip.count()) > 0 && (await skip.isVisible().catch(() => false))) {
      await skip.click().catch(() => {});
    }
    const close = page.getByRole("button", { name: /close tour/i }).first();
    if ((await close.count()) > 0 && (await close.isVisible().catch(() => false))) {
      await close.click().catch(() => {});
    }
    await page.waitForTimeout(150);
  }
}

async function signIn(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(fixture.password);
  await page.getByRole("button", { name: /sign in/i }).first().click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 30000 });
  await dismissTour(page);
}

async function gotoWorkspace(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await dismissTour(page);
}

async function continueWizard(page, label = "Continue") {
  await page.getByRole("button", { name: label, exact: true }).first().click();
}

async function createTask(page, title, unitName) {
  await gotoWorkspace(page, "/usg/request?tab=tasks");
  await page.locator('button[data-tour="request-create-task"]').click();
  const dialog = page.getByRole("dialog", { name: "Create task", exact: true });
  await dialog.waitFor({ timeout: 20000 });
  await dialog.locator("#task-title").fill(title);
  await dialog.locator("#task-details").fill("Phase 10 end-to-end task.");
  await dialog.locator("#task-prio").selectOption("normal");
  await continueWizard(dialog);

  await dialog.getByLabel("Assignment mode", { exact: true }).selectOption("specific-units");
  await dialog
    .locator("label")
    .filter({ hasText: unitName })
    .locator('input[type="checkbox"]')
    .first()
    .check();
  await continueWizard(dialog);

  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await dialog.getByLabel("Requirement 1 label", { exact: true }).fill("Evidence link");
  await dialog.getByLabel("Requirement 1 instructions", { exact: true }).fill("Paste a link to the completed work.");
  await dialog.getByLabel("Requirement 1 accepted types", { exact: true }).fill("link,file");
  await continueWizard(dialog);

  const due = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const dueDate = due.toISOString().slice(0, 10);
  await dialog.locator("#task-due").fill(dueDate);
  await dialog.locator("#task-time").fill("23:59");
  await dialog.locator("#task-grace").fill("15");
  await dialog.locator("#task-review-sla").fill("2");
  await continueWizard(dialog);

  await dialog.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByText(title, { exact: true }).first().waitFor({ timeout: 30000 });
  check("USG publishes a task through the canonical stepper", true);
}

async function extensionAndSubmit(page, title) {
  await gotoWorkspace(page, "/lsg/request?tab=tasks");
  await page.getByText(title, { exact: true }).first().click();
  await page.waitForTimeout(600);
  const taskUrl = page.url();
  check("LSG opens the published task with a deep link", taskUrl.includes("task="), taskUrl);

  await page.getByRole("button", { name: "Request extension", exact: true }).click();
  const proposed = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
  const pad = (value) => String(value).padStart(2, "0");
  const local = `${proposed.getFullYear()}-${pad(proposed.getMonth() + 1)}-${pad(proposed.getDate())}T${pad(proposed.getHours())}:${pad(proposed.getMinutes())}`;
  await page.locator('input[type="datetime-local"]').first().fill(local);
  await page.getByPlaceholder("Reason", { exact: true }).fill("Phase 10 extension check.");
  await page.getByRole("button", { name: "Submit request", exact: true }).click();
  await page.getByText("Phase 10 extension check.", { exact: true }).waitFor({ timeout: 20000 });
  check("LSG submits an extension request", true);

  await page.getByPlaceholder("Write your response to this task...").first().fill("Phase 10 submitted answer https://example.com/evidence");
  await page.getByRole("button", { name: "Submit for review", exact: true }).first().click();
  const confirm = page.getByRole("dialog", { name: "Submit for review", exact: true });
  await confirm.getByRole("button", { name: "Submit for review", exact: true }).click();
  await page.getByText("Under review", { exact: true }).first().waitFor({ timeout: 20000 });
  check("LSG submits the task answer for review with canonical status", true);
  return taskUrl;
}

async function approveTaskAndExtension(page, taskUrl) {
  await gotoWorkspace(page, new URL(taskUrl).pathname + new URL(taskUrl).search);
  await page.getByRole("button", { name: "Approve", exact: true }).last().click();
  await page.waitForTimeout(700);
  check("USG approves the pending extension", true);

  await gotoWorkspace(page, "/usg/request?tab=review");
  const row = page.locator("[data-review-task-id]").filter({ hasText: "Phase 10 E2E task" }).first();
  await row.getByRole("button", { name: "Review", exact: true }).click();
  await page.getByPlaceholder("Required for Return and Reject").first().fill("Phase 10 approval.");
  await page.getByRole("button", { name: "Approve", exact: true }).first().click();
  await page.getByText("Approved", { exact: true }).first().waitFor({ timeout: 20000 });
  check("USG approves the submitted requirement", true);
}

async function checkRedirects(page) {
  const cases = [
    ["/usg/officers", "/usg/manage"],
    ["/usg/survey", "/usg/forms"],
    ["/lsg/survey", "/lsg/forms"],
    ["/lsg/resolutions", "/lsg/request"],
    ["/dashboard/manage", "/dashboard"],
  ];
  for (const [from, expected] of cases) {
    await page.goto(`${BASE}${from}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    const pathname = new URL(page.url()).pathname;
    check(`${from} redirects to canonical surface`, pathname === expected, `${pathname} != ${expected}`);
  }
}

async function checkCanonicalForms(page) {
  await gotoWorkspace(page, "/usg/forms");
  await page.getByRole("tab", { name: "Feedback forms", exact: true }).click();
  check("USG Forms exposes the canonical Feedback forms tab", await page.getByTestId("feedback-form-new").isVisible());
  check("Manage no longer owns a Feedback tab", (await page.getByRole("tab", { name: "Feedback", exact: true }).count()) === 0);
  const dead = await page.locator('a[href="#"], a:not([href])').count();
  check("workspace nav has no dead anchors", dead === 0, `${dead} dead anchors`);
}

async function checkBudgetSurfaces(page) {
  await gotoWorkspace(page, "/lsg/manage?tab=budget&budgetTab=overview");
  check("LSG budget overview renders allocation metrics", await page.getByText("Remaining allocation", { exact: true }).first().isVisible());

  await gotoWorkspace(page, "/lsg/manage?tab=budget&budgetTab=request");
  await page.getByRole("button", { name: "Request budget", exact: true }).click().catch(() => {});
  await page.locator("#lsg-budget-title").fill("Phase 10 over-allocation probe");
  await page.locator("#lsg-budget-justification").fill("This request must be blocked by the allocation RPC.");
  await continueWizard(page, "Continue to lines");
  await page.getByLabel("Line 1 name", { exact: true }).fill("Oversized item");
  await page.getByLabel("Line 1 quantity", { exact: true }).fill("1000000");
  await page.getByLabel("Line 1 unit cost", { exact: true }).fill("1000000");
  await continueWizard(page, "Continue to files");
  await continueWizard(page, "Review request");
  await page.getByRole("button", { name: "Submit request", exact: true }).click();
  await page.waitForTimeout(1200);
  const body = await page.locator("body").innerText();
  check("LSG over-allocation is blocked", /allocat/i.test(body), body.slice(-600));

  await gotoWorkspace(page, "/usg/manage?tab=budget&budgetTab=review");
  check("USG budget review exposes campus grouping", await page.getByText("Group by campus", { exact: true }).first().isVisible());
  check("USG budget review exposes the campus filter", await page.getByLabel("Campus filter", { exact: true }).isVisible());
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error" && !message.text().includes("favicon")) consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));
mkdirSync(SHOTS, { recursive: true });

try {
  const owner = fixture.emails.usg;
  const lsg = fixture.emails.lsg;
  const lsgUnit = fixture.lsgAccounts.find((account) => /Engineering/i.test(account.unitName ?? ""))?.unitName ?? "College of Engineering";
  const title = `Phase 10 E2E task ${Date.now()}`;

  await signIn(page, owner);
  await checkRedirects(page);
  await checkCanonicalForms(page);
  await createTask(page, title, lsgUnit);

  await signIn(page, lsg);
  const taskUrl = await extensionAndSubmit(page, title);

  await signIn(page, owner);
  await approveTaskAndExtension(page, taskUrl);
  await checkBudgetSurfaces(page);

  check("no unexpected browser console errors", consoleErrors.length === 0, consoleErrors.join(" | "));
} catch (error) {
  check("phase10 e2e run completes", false, error?.stack ?? String(error));
  await page.screenshot({ path: `${SHOTS}/phase10-failure.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

console.log(`\n${checks - failures}/${checks} Phase 10 E2E checks passed.`);
if (failures > 0) process.exitCode = 1;
