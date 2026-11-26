/**
 * Captures the officer-chart surfaces for the hand-off report.
 *
 * Run: node scripts/screenshot-structure.mjs
 * Requires a server on http://localhost:3000 and the demo seed applied.
 * Screenshots land in the shared screenshots folder, not in the repo.
 */
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.SCREENSHOT_BASE_URL ?? "http://localhost:3000";
const OUT =
  process.env.SCREENSHOT_DIR ??
  "C:\\Users\\Julius M. Matro\\Desktop\\sir tonie projects\\screenshots\\structure";
const CREDENTIALS =
  "C:\\Users\\Julius M. Matro\\Desktop\\sir tonie projects\\credentials\\smartgov-test-accounts.txt";

const text = existsSync(CREDENTIALS) ? readFileSync(CREDENTIALS, "utf8") : "";
const secret = text.match(/Password for every account:\s*(\S+)/)?.[1];
if (!secret) {
  console.error("Could not read the demo password from the credentials file.");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

async function withAccount(email, run) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  async function settle(selector, timeout = 90_000) {
    await page.waitForSelector(selector, { timeout });
    for (let i = 0; i < 3; i += 1) {
      const notNow = page.getByRole("button", { name: /^Not now$/ });
      if (await notNow.count()) await notNow.first().click().catch(() => {});
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(900);
  }

  async function clickLink(label) {
    const link = page.getByRole("link", { name: label, exact: true }).first();
    await link.waitFor({ timeout: 60_000 });
    await link.click();
    await page.waitForTimeout(2500);
  }

  async function shot(name) {
    for (let i = 0; i < 3; i += 1) {
      const notNow = page.getByRole("button", { name: /^Not now$/ });
      if (await notNow.count()) await notNow.first().click().catch(() => {});
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(500);
    const file = `${OUT}\\${name}.png`;
    await page.screenshot({ path: file, fullPage: true });
    console.log("saved", file);
  }

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').first().fill(secret);
  await page.getByRole("button", { name: /Sign in/i }).click();
  await page.waitForURL((url) => /^\/(usg|lsg)/.test(url.pathname), { timeout: 30_000 });
  await page.waitForTimeout(2000);

  try {
    await run({ page, settle, clickLink, shot });
  } finally {
    await context.close();
  }
}

// USG: the approved chart on the structure page, then the review queue.
await withAccount("owner@demo.smartgov.test", async ({ page, settle, clickLink, shot }) => {
  await clickLink("Manage");
  await page.getByRole("tab", { name: "Government structure" }).first().click();
  await page.waitForTimeout(3000);
  await clickLink("Open the structure queue");
  await settle('[data-tour="structure-mode"]');
  await shot("usg-structure-chart");
});

// LSG: a council with no draft starts in the chart builder.
await withAccount("carlo.education@demo.smartgov.test", async ({ page, settle, clickLink, shot }) => {
  await clickLink("Manage");
  await clickLink("Government structure");
  await settle('[data-tour="structure-chart"]', 120_000);
  await shot("lsg-structure-builder");

  await page.getByRole("button", { name: /^Add officer$/ }).first().click();
  await page.waitForSelector("text=Add an officer", { timeout: 15_000 });
  await page.waitForTimeout(600);
  await shot("lsg-officer-wizard");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /^Classic form$/ }).click();
  await page.waitForTimeout(1200);
  await shot("lsg-structure-form");
});

// Organization chart: the published root chart plus the roster view.
await withAccount("owner@demo.smartgov.test", async ({ page, settle, shot }) => {
  await settle("text=Overview");
  const manage = page.getByRole("link", { name: /^Manage/ }).first();
  if (await manage.count()) {
    await manage.click();
    await page.waitForTimeout(400);
  }
  await page.getByRole("link", { name: /^Government structure$/ }).first().click();
  await settle('[data-tour="manage-structure"]', 120_000);
  await page.getByRole("link", { name: /^View published chart$/ }).first().click();
  await settle('[data-tour="org-chart-published"]', 120_000);
  await shot("org-chart");
});

await browser.close();
console.log("\ndone ->", OUT);
