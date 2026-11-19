import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const SHOTS = "C:/Users/Julius M. Matro/Desktop/sir tonie projects/screenshots/audit";
const CREDENTIALS = "C:/Users/Julius M. Matro/Desktop/sir tonie projects/credentials/smartgov-test-accounts.txt";

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "desktop", width: 1440, height: 900 },
];

const FEDERATED_TABS = {
  usg: [
    { parent: "Request", path: "/usg/request", href: "/usg/request?tab=resolutions", tab: "resolutions", label: "Resolutions", anchor: "request-tabs", kind: "button", crumb: "Request" },
    { parent: "Events and Acts", path: "/usg/events", href: "/usg/events?tab=calendar", tab: "calendar", label: "Calendar", anchor: "events-toolbar", kind: "button", crumb: "Events and Acts" },
    { parent: "Events and Acts", path: "/usg/events", href: "/usg/events?tab=future", tab: "future", label: "Future Events", anchor: "events-toolbar", kind: "button", crumb: "Events and Acts" },
    { parent: "Events and Acts", path: "/usg/events", href: "/usg/events?tab=accomplishment", tab: "accomplishment", label: "Accomplishment", anchor: "events-toolbar", kind: "button", crumb: "Events and Acts" },
    { parent: "Manage", path: "/usg/manage", href: "/usg/manage?tab=documents", tab: "documents", label: "Documents", anchor: "manage-tabs", kind: "role", crumb: "Manage" },
    { parent: "Manage", path: "/usg/manage", href: "/usg/manage?tab=search", tab: "search", label: "Search", anchor: "manage-tabs", kind: "role", crumb: "Manage" },
    { parent: "Manage", path: "/usg/manage", href: "/usg/manage?tab=budget", tab: "budget", label: "Budget", anchor: "manage-tabs", kind: "role", crumb: "Manage" },
    { parent: "Manage", path: "/usg/manage", href: "/usg/manage?tab=monitoring", tab: "monitoring", label: "Monitoring", anchor: "manage-tabs", kind: "role", crumb: "Manage" },
    { parent: "Manage", path: "/usg/manage", href: "/usg/manage?tab=feedback", tab: "feedback", label: "Feedback", anchor: "manage-tabs", kind: "role", crumb: "Manage" },
    { parent: "Manage", path: "/usg/manage", href: "/usg/manage?tab=accounts", tab: "accounts", label: "Accounts", anchor: "manage-tabs", kind: "role", crumb: "Manage" },
  ],
  lsg: [
    { parent: "Request", path: "/lsg/request", href: "/lsg/request?tab=resolutions", tab: "resolutions", label: "Resolutions", anchor: "request-tabs", kind: "button", crumb: "Request" },
    { parent: "Events and Acts", path: "/lsg/events", href: "/lsg/events?tab=calendar", tab: "calendar", label: "Calendar", anchor: "events-toolbar", kind: "button", crumb: "Events and Acts" },
    { parent: "Events and Acts", path: "/lsg/events", href: "/lsg/events?tab=future", tab: "future", label: "Future Events", anchor: "events-toolbar", kind: "button", crumb: "Events and Acts" },
    { parent: "Events and Acts", path: "/lsg/events", href: "/lsg/events?tab=accomplishment", tab: "accomplishment", label: "Accomplishment", anchor: "events-toolbar", kind: "button", crumb: "Events and Acts" },
    { parent: "Manage", path: "/lsg/manage", href: "/lsg/manage?tab=documents", tab: "documents", label: "Documents", anchor: "manage-tabs", kind: "role", crumb: "Manage" },
    { parent: "Manage", path: "/lsg/manage", href: "/lsg/manage?tab=search", tab: "search", label: "Search", anchor: "manage-tabs", kind: "role", crumb: "Manage" },
    { parent: "Manage", path: "/lsg/manage", href: "/lsg/manage?tab=budget", tab: "budget", label: "Budget", anchor: "manage-tabs", kind: "role", crumb: "Manage" },
    { parent: "Manage", path: "/lsg/manage", href: "/lsg/manage?tab=feedback", tab: "feedback", label: "Feedback", anchor: "manage-tabs", kind: "role", crumb: "Manage" },
  ],
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
  const scope = wide
    ? page
    : page.getByRole("dialog", { name: /workspace menu/i });
  await scope
    .getByRole("link", { name: new RegExp(`^${label}$`, "i") })
    .first()
    .click();
  await page.waitForURL(expectedPath, { timeout: 30000 });
  await page.locator("h1").first().waitFor({ timeout: 30000 });
}

async function openFederatedTab(page, role, tab) {
  await nav(page, tab.parent, new RegExp(`${tab.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
  const wide = (page.viewportSize()?.width ?? 1440) >= 1024;
  if (!wide) {
    const openMenu = page.getByRole("button", { name: /open menu/i });
    if (await openMenu.count()) await openMenu.click();
  }
  const scope = wide
    ? page
    : page.getByRole("dialog", { name: /workspace menu/i });
  await scope.locator(`a[href="${tab.href}"]`).first().click();
  await page.waitForURL(
    (url) => url.pathname === tab.path && url.searchParams.get("tab") === tab.tab,
    { timeout: 30000 },
  );
  await page.locator("h1").first().waitFor({ timeout: 30000 });
}

async function federatedTabsPass(page, role) {
  for (const tab of FEDERATED_TABS[role]) {
    try {
      await openFederatedTab(page, role, tab);
      const crumb = page.locator('[data-tour="workspace-breadcrumbs"]').first();
      const crumbText = (await crumb.textContent()) ?? "";
      const selected =
        tab.kind === "role"
          ? await page
              .getByRole("tab", { name: new RegExp(`^${tab.label}$`, "i") })
              .first()
              .getAttribute("aria-selected")
          : await page
              .locator(`[data-tour="${tab.anchor}"] button`)
              .filter({ hasText: tab.label })
              .first()
              .evaluate((el) => el.className.includes("bg-ink"));
      const selectedOk = tab.kind === "role" ? selected === "true" : selected === true;
      check(
        `${role} opens ${tab.label} through the ${tab.parent} navigation`,
        crumbText.includes(tab.crumb) && selectedOk,
        JSON.stringify({ crumbText, selected }),
      );
    } catch (error) {
      check(`${role} opens ${tab.label} through the ${tab.parent} navigation`, false, error.message);
    }
  }

  const otherRole = role === "usg" ? "lsg" : "usg";
  for (const tab of FEDERATED_TABS[otherRole]) {
    try {
      const pushed = await page.evaluate((nextHref) => {
        const router = window.next?.router;
        if (!router || typeof router.push !== "function") return false;
        router.push(nextHref);
        return true;
      }, tab.href);
      if (!pushed) throw new Error("client router unavailable for the wrong-side probe");
      await page
        .waitForURL((url) => url.pathname.startsWith(`/${role}`), { timeout: 30000 })
        .catch(() => {});
      const url = new URL(page.url());
      check(
        `${role} cannot open ${otherRole} ${tab.label}`,
        url.pathname.startsWith(`/${role}`),
        page.url(),
      );
    } catch (error) {
      check(`${role} cannot open ${otherRole} ${tab.label}`, false, error.message);
    }
  }
}

async function federatedUiStatesPass(page, role) {
  if (role === "usg") {
    const searchTab = FEDERATED_TABS.usg.find((tab) => tab.tab === "search");
    try {
      await openFederatedTab(page, role, searchTab);
      await page.locator("#document-search-q").first().fill("no-such-federation-document-2026");
      await page.getByRole("button", { name: /search catalog/i }).first().click();
      await page.getByText(/no documents match this search/i).first().waitFor({ timeout: 15000 });
      check("USG document search shows its empty state", true);
    } catch (error) {
      check("USG document search shows its empty state", false, error.message);
    }
    return;
  }

  const feedbackTab = FEDERATED_TABS.lsg.find((tab) => tab.tab === "feedback");
  const handler = async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, message: "Forced submission failure." }),
      });
      return;
    }
    await route.continue();
  };
  try {
    await openFederatedTab(page, role, feedbackTab);
    await page.route("**/api/feedback", handler);
    await page.getByLabel("Subject", { exact: true }).first().fill("Federation failure state");
    await page
      .getByLabel("Message", { exact: true })
      .first()
      .fill("This submission is forced to fail in the browser gate.");
    const submit = page.getByRole("button", { name: /send feedback/i }).first();
    await submit.click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Forced submission failure." })
      .first()
      .waitFor({ timeout: 15000 });
    check("LSG feedback submission shows a visible failure", true);
    check("LSG feedback submit stays usable after failure", await submit.isEnabled());
  } catch (error) {
    check("LSG feedback submission shows a visible failure", false, error.message);
    check("LSG feedback submit stays usable after failure", false, error.message);
  } finally {
    await page.unroute("**/api/feedback", handler).catch(() => {});
  }
}

async function rolePass(page, role, email, password, consoleErrors) {
  console.log(`${role.toUpperCase()} browser pass`);
  await signIn(page, email, password);
  const base = `/${role}`;
  check(`${role} sign-in lands in its workspace`, page.url().includes(base));

  for (const [label, suffix] of [
    ["Manage", "/manage"],
    ["Request", "/request"],
    ["Events and Acts", "/events"],
    ["Survey", role === "usg" ? "/surveys" : "/surveys"],
    ["Settings", "/settings"],
    ["Overview", ""],
  ]) {
    try {
      await nav(page, label, new RegExp(`${base}${suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
      check(`${role} reaches ${label} through client navigation`, true);
    } catch (error) {
      check(`${role} reaches ${label} through client navigation`, false, error.message);
    }
  }

  await federatedTabsPass(page, role);
  await federatedUiStatesPass(page, role);

  try {
    await page.getByRole("button", { name: /sign out/i }).first().evaluate((el) => el.click());
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /stay signed in/i }).click();
    await dialog.waitFor({ state: "hidden" });
    check(`${role} sign-out dialog cancel keeps the session`, page.url().includes(base));
  } catch (error) {
    check(`${role} sign-out dialog cancel keeps the session`, false, error.message);
  }

  if (role === "usg") {
    try {
      await nav(page, "Survey", /\/usg\/surveys/);
      const title = page.locator("#s-title");
      await title.focus();
      await page.locator('button[type="submit"]').first().evaluate((el) => el.click());
      const valid = await title.evaluate((el) => el instanceof HTMLInputElement && el.checkValidity());
      check("owner survey form blocks an empty title", valid === false);
    } catch (error) {
      check("owner survey form blocks an empty title", false, error.message);
    }
  }

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    try {
      await nav(page, "Overview", new RegExp(`${base}`));
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: path.join(SHOTS, `${role}-overview-${viewport.name}.png`), fullPage: true });
      check(`${role} ${viewport.name} overview screenshot captured`, true);
    } catch (error) {
      check(`${role} ${viewport.name} overview screenshot captured`, false, error.message);
    }
    try {
      await nav(page, "Survey", new RegExp(`${base}/surveys`));
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: path.join(SHOTS, `${role}-survey-${viewport.name}.png`), fullPage: true });
      check(`${role} ${viewport.name} survey screenshot captured`, true);
    } catch (error) {
      check(`${role} ${viewport.name} survey screenshot captured`, false, error.message);
    }
  }

  check(`${role} had no browser console errors`, consoleErrors.length === 0, consoleErrors.join(" | "));
  await signOut(page);
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const { password, emails } = fixture();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORTS[2] });
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(30000);
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("script tag")) {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

  try {
    await rolePass(page, "usg", emails.usg, password, consoleErrors);
    consoleErrors.length = 0;
    await rolePass(page, "lsg", emails.lsg, password, consoleErrors);
  } catch (error) {
    check("browser run completed", false, error.message);
  } finally {
    await browser.close();
  }

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) process.exitCode = 1;
}

await main();
