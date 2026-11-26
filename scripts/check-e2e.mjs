import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { readTestAccounts } from "./test-fixtures.mjs";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const SHOTS = "C:/Users/Julius M. Matro/Desktop/sir tonie projects/screenshots/audit";

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "desktop", width: 1440, height: 900 },
];

const FEDERATED_TABS = {
  usg: [
    { parent: "Request", path: "/usg/request", href: "/usg/request?tab=resolutions", tab: "resolutions", label: "Resolutions", anchor: "workspace-nav", kind: "nav", crumb: "Request" },
    { parent: "Events and Acts", path: "/usg/events", href: "/usg/events?tab=calendar", tab: "calendar", label: "Calendar", anchor: "workspace-nav", kind: "nav", crumb: "Events and Acts" },
    { parent: "Events and Acts", path: "/usg/events", href: "/usg/events?tab=future", tab: "future", label: "Future Events", anchor: "workspace-nav", kind: "nav", crumb: "Events and Acts" },
    { parent: "Events and Acts", path: "/usg/events", href: "/usg/events?tab=accomplishment", tab: "accomplishment", label: "Accomplishment", anchor: "workspace-nav", kind: "nav", crumb: "Events and Acts" },
    { parent: "Manage", path: "/usg/manage", href: "/usg/manage?tab=documents", tab: "documents", label: "Documents", anchor: "workspace-nav", kind: "nav", crumb: "Manage" },
    { parent: "Manage", path: "/usg/manage", href: "/usg/manage?tab=budget", tab: "budget", label: "Budget", anchor: "workspace-nav", kind: "nav", crumb: "Manage" },
    { parent: "Manage", path: "/usg/manage", href: "/usg/manage?tab=people&view=units", tab: "people", label: "People & Units", anchor: "workspace-nav", kind: "nav", crumb: "Manage" },
  ],
  lsg: [
    { parent: "Request", path: "/lsg/request", href: "/lsg/request?tab=resolutions", tab: "resolutions", label: "Resolutions", anchor: "workspace-nav", kind: "nav", crumb: "Request" },
    { parent: "Events and Acts", path: "/lsg/events", href: "/lsg/events?tab=calendar", tab: "calendar", label: "Calendar", anchor: "workspace-nav", kind: "nav", crumb: "Events and Acts" },
    { parent: "Events and Acts", path: "/lsg/events", href: "/lsg/events?tab=future", tab: "future", label: "Future Events", anchor: "workspace-nav", kind: "nav", crumb: "Events and Acts" },
    { parent: "Events and Acts", path: "/lsg/events", href: "/lsg/events?tab=accomplishment", tab: "accomplishment", label: "Accomplishment", anchor: "workspace-nav", kind: "nav", crumb: "Events and Acts" },
    { parent: "Manage", path: "/lsg/manage", href: "/lsg/manage?tab=documents", tab: "documents", label: "Documents", anchor: "workspace-nav", kind: "nav", crumb: "Manage" },
    { parent: "Manage", path: "/lsg/manage", href: "/lsg/manage?tab=budget", tab: "budget", label: "Budget", anchor: "workspace-nav", kind: "nav", crumb: "Manage" },
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

async function hideTourPrompts(page) {
  await page.addInitScript(() => {
    const install = () => {
      if (document.getElementById("e2e-hide-tours")) return;
      const style = document.createElement("style");
      style.id = "e2e-hide-tours";
      style.textContent =
        ".tour-prompt,.tour-floating-help,[data-testid='tour-prompt']{display:none!important}";
      document.head.appendChild(style);
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", install, { once: true });
    } else {
      install();
    }
  });
}

function fixture() {
  return readTestAccounts();
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
  const childLink = scope.locator(`a[href="${tab.href}"]`).first();
  if (!(await childLink.count())) {
    const parentLink = scope.getByRole("link", { name: new RegExp(`^${tab.parent}$`, "i") }).first();
    if (await parentLink.count()) await parentLink.click();
  }
  await childLink.click();
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
      const wide = (page.viewportSize()?.width ?? 1440) >= 1024;
      const scope = wide ? page : page.getByRole("dialog", { name: /workspace menu/i });
      const selected =
        tab.kind === "role"
          ? await page
              .getByRole("tab", { name: new RegExp(`^${tab.label}$`, "i") })
              .first()
              .getAttribute("aria-selected")
          : tab.kind === "nav"
            ? await scope
                .locator(`a[href="${tab.href}"]`)
                .first()
                .evaluate((el) => el.className.includes("bg-ink/[0.06]"))
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
  const documentsTab = FEDERATED_TABS[role].find((tab) => tab.tab === "documents");
  try {
    await openFederatedTab(page, role, documentsTab);
    await page.locator("#documents-filter-q").first().fill("no-such-federation-document-2026");
    await page.getByRole("button", { name: /search catalog/i }).first().click();
    await page.getByText(/no documents match these filters/i).first().waitFor({ timeout: 15000 });
    check(`${role} documents filter shows its empty state`, true);
  } catch (error) {
    check(`${role} documents filter shows its empty state`, false, error.message);
  }
}

async function feedbackPass(page, role, consoleErrors) {
  const title = `E2E feedback ${role} ${Date.now()}`;
  let publicPage = null;
  try {
    await nav(page, "Forms", new RegExp(`/${role}/forms`));
    await page.getByRole("tab", { name: "Feedback forms", exact: true }).click();
    await page.locator('[data-tour="forms-create"]').waitFor({ timeout: 30000 });
    check(`${role} canonical Forms exposes Feedback forms`, await page.getByTestId("feedback-form-new").isVisible());

    await page.getByTestId("feedback-form-new").click();
    await page.getByTestId("feedback-form-builder").waitFor({ timeout: 20000 });
    await page.waitForTimeout(1200);

    await page.getByLabel("Title", { exact: true }).fill(title);
    await page.getByRole("radio", { name: /^Public link\b/i }).first().check();
    await page.getByTestId("feedback-quick-add-full_name").click();
    check(
      `${role} quick-add appends a feedback question`,
      (await page.getByTestId("feedback-question").count()) === 1,
    );

    await page.getByRole("button", { name: "Save", exact: true }).first().click();
    await page.getByText("Saved.", { exact: true }).first().waitFor({ timeout: 20000 });
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("button")].some(
          (button) => button.textContent?.trim() === "Open form" && !button.disabled,
        ),
      null,
      { timeout: 20000 },
    );
    await page.getByRole("button", { name: "Open form", exact: true }).click();
    await page.getByText("Form opened.", { exact: true }).first().waitFor({ timeout: 20000 });

    const linkText = await page
      .getByText(/\/forms\/feedback\/[A-Za-z0-9_-]{32}/)
      .first()
      .textContent({ timeout: 20000 });
    const publicUrl = linkText?.trim() ?? "";
    check(
      `${role} opened feedback form exposes its canonical public link`,
      /^https?:\/\/.+\/forms\/feedback\/[A-Za-z0-9_-]{32}$/.test(publicUrl),
      publicUrl,
    );

    publicPage = await page.context().newPage();
    await hideTourPrompts(publicPage);
    publicPage.setDefaultTimeout(10000);
    publicPage.setDefaultNavigationTimeout(30000);
    publicPage.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("script tag")) {
        consoleErrors.push(`public: ${message.text()}`);
      }
    });
    publicPage.on("pageerror", (error) => consoleErrors.push(`public pageerror: ${error.message}`));
    await publicPage.goto(publicUrl, { waitUntil: "domcontentloaded" });
    await publicPage.getByTestId("public-feedback-form").waitFor({ timeout: 30000 });
    const heading = (await publicPage.locator("h1").first().textContent()) ?? "";
    check(`${role} public feedback page renders the opened form`, heading.includes(title));
    await publicPage.close();
    publicPage = null;

    await page.getByRole("button", { name: "Close form", exact: true }).click();
    await page.getByText("Form closed.", { exact: true }).first().waitFor({ timeout: 20000 });

    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Delete form", exact: true }).click();
    await page.getByTestId("feedback-form-new").waitFor({ timeout: 20000 });
    check(
      `${role} deletes the e2e feedback form`,
      (await page.getByText(title, { exact: true }).count()) === 0,
    );
  } catch (error) {
    check(`${role} feedback form lifecycle completes`, false, error.message);
  } finally {
    if (publicPage) await publicPage.close().catch(() => {});
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
  await feedbackPass(page, role, consoleErrors);

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
      await nav(page, "Forms", /\/usg\/forms/);
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
      await nav(page, "Forms", new RegExp(`${base}/forms`));
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: path.join(SHOTS, `${role}-forms-${viewport.name}.png`), fullPage: true });
      check(`${role} ${viewport.name} forms screenshot captured`, true);
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
  const context = await browser.newContext({ viewport: VIEWPORTS[2] });
  const page = await context.newPage();
  await hideTourPrompts(page);
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
