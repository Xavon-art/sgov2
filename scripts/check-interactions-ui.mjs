import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.INTERACTIONS_BASE_URL ?? "http://localhost:3000";
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

function fixture() {
  const text = readFileSync(CREDENTIALS, "utf8");
  const password = text.match(/Password for every account:\s*(\S+)/i)?.[1] ?? "";
  const emails = {};
  for (const line of text.split(/\r?\n/)) {
    const email = line.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0];
    if (!email) continue;
    if (/^\s*Owner\s*\/\s*Founder/i.test(line)) emails.usg = email;
    else if (/^\s*President\s+Pedro/i.test(line)) emails.lsg = email;
  }
  if (!password || !emails.usg || !emails.lsg) {
    throw new Error("Fixture credentials are missing expected accounts.");
  }
  return { password, emails };
}

async function signIn(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole("button", { name: /sign in/i }).first().click();
  await page.waitForURL(/\/(usg|lsg)/, { timeout: 60000 });
}

async function signOut(page) {
  await page.getByRole("button", { name: /sign out/i }).first().evaluate((el) => el.click());
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /sign out/i }).click();
  await page.waitForURL(/\/login/, { timeout: 30000 });
}

async function nav(page, label, expectedPath) {
  const wide = (page.viewportSize()?.width ?? 1440) >= 1024;
  if (!wide) {
    const openMenu = page.getByRole("button", { name: /open menu/i });
    if (await openMenu.count()) await openMenu.click();
  }
  const scope = wide ? page : page.getByRole("dialog", { name: /workspace menu/i });
  await scope.getByRole("link", { name: new RegExp(`^${label}$`, "i") }).first().click();
  await page.waitForURL(expectedPath, { timeout: 30000 });
  await page.locator("h1").first().waitFor({ timeout: 30000 });
}

async function notificationProbes(page) {
  await page.getByRole("button", { name: "Notifications" }).click();
  const item = page.getByRole("button", { name: /External notice/ });
  await item.waitFor();
  await item.click();
  await page.waitForTimeout(250);

  const openCalls = await page.evaluate(() => window.__openCalls ?? []);
  check(
    "external notification link opens safely in a new tab",
    openCalls.length === 1 &&
      openCalls[0][0] === "https://example.com/notice" &&
      openCalls[0][1] === "_blank" &&
      openCalls[0][2] === "noopener,noreferrer",
    JSON.stringify(openCalls),
  );

  const badge = page.getByRole("button", { name: "Notifications" }).locator("span").last();
  check("failed single notification read keeps the unread badge", (await badge.textContent())?.trim() === "1");
  const itemClass = (await item.getAttribute("class")) ?? "";
  check("failed single notification read does not mark the item read", !itemClass.includes("opacity-60"));

  await page.getByRole("button", { name: "Mark all read" }).click();
  await page.waitForTimeout(250);
  check("failed mark-all keeps the unread badge", (await badge.textContent())?.trim() === "1");
  await page.getByRole("button", { name: "Notifications" }).click();
}

async function failedLogoutProbe(page) {
  await page.route("**/api/auth/logout", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false }) }),
  );
  await page.getByRole("button", { name: /sign out/i }).first().evaluate((el) => el.click());
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /sign out/i }).click();
  await dialog.getByRole("alert").waitFor();

  check("failed logout keeps the user in the workspace", page.url().includes("/lsg"), page.url());
  const message = (await dialog.getByRole("alert").textContent()) ?? "";
  check("failed logout shows an actionable error", /could not sign out/i.test(message), message);

  await page.unroute("**/api/auth/logout");
  await dialog.getByRole("button", { name: /sign out/i }).click();
  await page.waitForURL(/\/login/, { timeout: 30000 });
  check("successful retry signs out", true);
}

async function requestFailureProbe(page, email, password) {
  await signIn(page, email, password);
  await page.route("**/api/requests", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    return route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, message: "blocked by test" }),
    });
  });
  await nav(page, "Request", /\/lsg\/request/);
  await page.getByRole("button", { name: /personal requests/i }).click();
  await page.getByRole("button", { name: /file request/i }).first().click();
  await page.locator("#pr-subject").fill("QA failure probe");
  await page.locator("#pr-cover").fill("Cover letter");
  await page.locator("#pr-purpose").fill("Purpose");
  await page.getByRole("button", { name: /^file request$/i }).last().click();
  await page.getByRole("alert").filter({ hasText: "blocked by test" }).waitFor();
  check("failed personal request shows the server error inline", true);
  await page.unroute("**/api/requests");
  await signOut(page);
}

async function surveyDuplicateFailureProbe(page, email, password) {
  await signIn(page, email, password);
  const sourceId = "33333333-3333-4333-8333-333333333333";
  const listPattern = /\/api\/surveys$/;
  const detailPattern = /\/api\/surveys\/[^/]+$/;
  const questionPattern = /\/api\/surveys\/[^/]+\/questions$/;

  await page.route(listPattern, (route) => {
    const method = route.request().method();
    if (method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          surveys: [
            {
              id: sourceId,
              title: "QA Duplicate Source",
              description: null,
              status: "draft",
              accessMode: "public",
              responseCount: 0,
            },
          ],
        }),
      });
    }
    if (method === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, surveyId: "44444444-4444-4444-8444-444444444444" }),
      });
    }
    return route.continue();
  });
  await page.route(detailPattern, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        survey: {
          id: sourceId,
          title: "QA Duplicate Source",
          description: null,
          accessMode: "public",
          responseLimit: null,
          deadline: null,
        },
        questions: [
          {
            type: "short_text",
            title: "QA question",
            description: null,
            required: false,
            options: [],
            scaleMin: null,
            scaleMax: null,
            scaleLabelLow: null,
            scaleLabelHigh: null,
            orderIndex: 0,
          },
        ],
      }),
    }),
  );
  await page.route(questionPattern, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, message: "blocked by question copy" }),
    }),
  );

  await nav(page, "Survey", /\/lsg\/surveys/);
  await page.getByRole("button", { name: "Duplicate" }).click();
  await page.getByRole("alert").filter({ hasText: "blocked by question copy" }).waitFor();
  check("failed survey question copy shows the server error", true);
  check(
    "partial survey duplication is not reported as success",
    (await page.getByRole("status").filter({ hasText: "Survey duplicated." }).count()) === 0,
  );

  await page.unroute(questionPattern);
  await page.unroute(detailPattern);
  await page.unroute(listPattern);
  await signOut(page);
}

async function eventCancelProbes(page, email, password) {
  await signIn(page, email, password);
  const now = new Date().toISOString();
  const event = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "QA Cancel Probe",
    description: "Probe event",
    eventDate: "2026-11-20",
    eventTime: null,
    timezone: "Asia/Manila",
    venue: null,
    scope: "university",
    unitId: null,
    status: "open",
    honorStatus: "pending",
    honorReason: null,
    source: "local",
    supportFiles: null,
    files: [],
    scopes: [],
    claimNote: null,
    decisionNote: null,
    linkedRequest: null,
    cancelledAt: null,
    updatedAt: now,
    createdAt: now,
    createdBy: "qa",
    canDecide: false,
    canEdit: true,
    canClaim: false,
  };

  await page.route("**/api/events", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, events: [event] }) }),
  );

  let deleteCount = 0;
  const deletePattern = /\/api\/events\/[^/]+$/;
  await page.route(deletePattern, async (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    deleteCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 400));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  page.on("dialog", (dialog) => dialog.accept());

  await nav(page, "Events and Acts", /\/usg\/events/);
  await page.getByText("QA Cancel Probe").waitFor();
  const cancel = page.getByRole("button", { name: /^cancel$/i }).first();
  await cancel.click();
  await page.waitForTimeout(50);
  check("event cancel disables while the request is pending", await cancel.isDisabled());
  await cancel.evaluate((el) => el.click());
  await page.waitForTimeout(700);
  check("event cancel duplicate click sends one request", deleteCount === 1, `got ${deleteCount}`);

  await page.unroute(deletePattern);
  await page.route(deletePattern, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, message: "cancel blocked by test" }),
    }),
  );
  await page.getByRole("button", { name: /^cancel$/i }).first().click();
  await page.getByText("cancel blocked by test").waitFor();
  check("failed event cancel shows the server error", true);
  await signOut(page);
}

async function main() {
  const { password, emails } = fixture();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(30000);

  const consoleErrors = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().includes("script tag") &&
      !message.text().includes("the server responded with a status of 500")
    ) {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await page.addInitScript(() => {
    window.__openCalls = [];
    window.open = (...args) => {
      window.__openCalls.push(args);
      return null;
    };
  });

  await page.route(/\/api\/notifications\/unread$/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, count: 1 }) }),
  );
  await page.route(/\/api\/notifications\?limit=20$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        notifications: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            title: "External notice",
            body: "Open the linked document",
            link: "https://example.com/notice",
            readAt: null,
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    }),
  );
  await page.route(/\/api\/notifications\/read-all$/, (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false }) }),
  );
  await page.route(/\/api\/notifications\/[^/]+\/read$/, (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false }) }),
  );

  try {
    await signIn(page, emails.lsg, password);
    await notificationProbes(page);
    await failedLogoutProbe(page);
    await requestFailureProbe(page, emails.lsg, password);
    await surveyDuplicateFailureProbe(page, emails.lsg, password);
    await eventCancelProbes(page, emails.usg, password);
    check("no unexpected browser console errors", consoleErrors.length === 0, consoleErrors.join(" | "));
  } catch (error) {
    check("browser interaction run completed", false, error.message);
  } finally {
    await browser.close();
  }

  console.log(`\n${checks - failures}/${checks} interaction browser checks passed.`);
  if (failures > 0) process.exitCode = 1;
}

await main();
