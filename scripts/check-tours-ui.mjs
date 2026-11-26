import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { readTestAccounts } from "./test-fixtures.mjs";

const BASE = process.env.TOURS_BASE_URL ?? process.env.E2E_BASE_URL ?? "http://localhost:3000";
const SHOTS = "C:/Users/Julius M. Matro/Desktop/sir tonie projects/screenshots/tours";

const VIEWPORTS = [
  { name: "mobile", width: 360, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

const ROUTES = {
  usg: [
    "/usg",
    "/usg/structure",
    "/usg/request",
    "/usg/messages",
    "/usg/manage",
    "/usg/events",
    "/usg/settings",
    "/usg/forms",
  ],
  lsg: [
    "/lsg",
    "/lsg/request",
    "/lsg/messages",
    "/lsg/manage",
    "/lsg/events",
    "/lsg/settings",
    "/lsg/forms",
    "/my-council",
    "/my-council/structure",
  ],
};

const PUBLIC_ROUTES = [
  "/",
  "/login",
  "/create",
  "/create/governance-model",
  "/create/account",
  "/create/institution",
  "/create/units",
  "/create/review",
  "/create/verification",
  "/create/activated",
];

const NAV_LABELS = {
  "/usg": "Overview",
  "/usg/manage": "Manage",
  "/usg/request": "Request",
  "/usg/messages": "Inbox",
  "/usg/events": "Events and Acts",
  "/usg/forms": "Forms",
  "/usg/settings": "Settings",
  "/lsg": "Overview",
  "/lsg/manage": "Manage",
  "/lsg/request": "Request",
  "/lsg/events": "Events and Acts",
  "/lsg/forms": "Forms",
  "/lsg/settings": "Settings",
  "/my-council": "My Council",
  "/my-council/structure": "My Council",
};

const AWAY_ROUTES = { usg: "/usg/structure", lsg: "/lsg/request" };

const FEDERATED_TABS = {
  usg: [
    { parent: "Request", href: "/usg/request?tab=resolutions", tab: "resolutions", label: "Resolutions", anchor: "workspace-nav", kind: "nav", crumb: "Request" },
    { parent: "Events and Acts", href: "/usg/events?tab=calendar", tab: "calendar", label: "Calendar", anchor: "workspace-nav", kind: "nav", crumb: "Events and Acts" },
    { parent: "Events and Acts", href: "/usg/events?tab=future", tab: "future", label: "Future Events", anchor: "workspace-nav", kind: "nav", crumb: "Events and Acts" },
    { parent: "Events and Acts", href: "/usg/events?tab=accomplishment", tab: "accomplishment", label: "Accomplishment", anchor: "workspace-nav", kind: "nav", crumb: "Events and Acts" },
    { parent: "Manage", href: "/usg/manage?tab=documents", tab: "documents", label: "Documents", anchor: "workspace-nav", kind: "nav", crumb: "Manage" },
    { parent: "Manage", href: "/usg/manage?tab=budget", tab: "budget", label: "Budget", anchor: "workspace-nav", kind: "nav", crumb: "Manage" },
    { parent: "Manage", href: "/usg/manage?tab=people&view=units", tab: "people", label: "People & Units", anchor: "workspace-nav", kind: "nav", crumb: "Manage" },
  ],
  lsg: [
    { parent: "Request", href: "/lsg/request?tab=resolutions", tab: "resolutions", label: "Resolutions", anchor: "workspace-nav", kind: "nav", crumb: "Request" },
    { parent: "Events and Acts", href: "/lsg/events?tab=calendar", tab: "calendar", label: "Calendar", anchor: "workspace-nav", kind: "nav", crumb: "Events and Acts" },
    { parent: "Events and Acts", href: "/lsg/events?tab=future", tab: "future", label: "Future Events", anchor: "workspace-nav", kind: "nav", crumb: "Events and Acts" },
    { parent: "Events and Acts", href: "/lsg/events?tab=accomplishment", tab: "accomplishment", label: "Accomplishment", anchor: "workspace-nav", kind: "nav", crumb: "Events and Acts" },
    { parent: "Manage", href: "/lsg/manage?tab=documents", tab: "documents", label: "Documents", anchor: "workspace-nav", kind: "nav", crumb: "Manage" },
    { parent: "Manage", href: "/lsg/manage?tab=budget", tab: "budget", label: "Budget", anchor: "workspace-nav", kind: "nav", crumb: "Manage" },
  ],
};

let checks = 0;
let failures = 0;
let secrets = [];

function redact(value) {
  let text = String(value ?? "");
  for (const secret of secrets) {
    if (secret) text = text.split(secret).join("[redacted]");
  }
  return text;
}

function check(label, condition, detail = "") {
  checks += 1;
  if (condition) {
    console.log(`  PASS  ${redact(label)}`);
    return true;
  }
  failures += 1;
  console.log(`  FAIL  ${redact(label)}${detail ? `\n        ${redact(detail)}` : ""}`);
  return false;
}

function fixture() {
  return readTestAccounts();
}

function routeSlug(route) {
  const base =
    route === "/"
      ? "home"
      : route
          .replace(/^\/+|\/+$/g, "")
          .replace(/\*/g, "detail")
          .replace(/[^A-Za-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
  return base || "home";
}

function stepFile(info, step) {
  return path.join(
    SHOTS,
    info.role,
    routeSlug(info.route),
    info.viewport.name,
    `step-${String(step).padStart(2, "0")}.png`,
  );
}

function intersectionArea(a, b) {
  if (!a || !b || !a.width || !a.height || !b.width || !b.height) return 0;
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

function insideViewport(box, viewport, tolerance = 2) {
  return Boolean(
    box &&
      box.width > 0 &&
      box.height > 0 &&
      box.x >= -tolerance &&
      box.y >= -tolerance &&
      box.x + box.width <= viewport.width + tolerance &&
      box.y + box.height <= viewport.height + tolerance,
  );
}

async function helpButton(page) {
  const inSlot = page.locator("[data-tour-help-slot] button").first();
  if (await inSlot.count()) return inSlot;
  return page.locator(".tour-floating-help button").first();
}

async function waitForHelp(page) {
  try {
    const button = await helpButton(page);
    await button.waitFor({ state: "visible", timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

async function clickHelp(page) {
  const button = await helpButton(page);
  await button.click();
}

async function helpName(page) {
  const button = await helpButton(page);
  const value = await button.evaluate(
    (element) => element.getAttribute("aria-label") || element.textContent || "",
  );
  return String(value).trim();
}

function tourDialog(page) {
  return page.getByRole("dialog").filter({ has: page.locator(".tour-card") }).first();
}

async function readCounter(dialog) {
  const text = (await dialog.textContent().catch(() => "")) ?? "";
  const match = text.match(/Step\s+(\d+)\s+of\s+(\d+)/i);
  return match ? { current: Number(match[1]), total: Number(match[2]) } : null;
}

async function waitForCounterChange(page, dialog, previous, previousTarget = null) {
  let absent = 0;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (!(await dialog.count())) {
      absent += 1;
      if (absent >= 5) return null;
    } else {
      absent = 0;
      const current = await readCounter(dialog);
      if (current && current.current !== previous) return current;
      if (previousTarget && (await dialog.getAttribute("data-tour-target")) !== previousTarget) {
        return current ?? { current: previous + 1, total: previous + 1 };
      }
    }
    await page.waitForTimeout(100);
  }
  return null;
}

async function closeTour(page, dialog) {
  const skip = dialog.getByRole("button", { name: /^skip$/i }).first();
  if (await skip.count()) {
    try {
      await skip.click();
      await dialog.waitFor({ state: "hidden", timeout: 5000 });
      return true;
    } catch {}
  }
  await page.keyboard.press("Escape");
  return dialog
    .waitFor({ state: "hidden", timeout: 5000 })
    .then(() => true)
    .catch(() => false);
}

async function findSpotlightTarget(page, spotlight, expected = null) {
  const nodes = page.locator("[data-tour]");
  const total = await nodes.count();
  const viewport = page.viewportSize() ?? { width: 1440, height: 900 };
  const reference = spotlight ?? { x: 0, y: 0, width: viewport.width, height: viewport.height };
  if (expected) {
    const preferred = page.locator(`[data-tour="${expected}"]`).first();
    if (await preferred.isVisible().catch(() => false)) {
      const box = await preferred.boundingBox().catch(() => null);
      if (box && box.width && box.height && intersectionArea(box, reference) > 0) {
        return { name: expected, box };
      }
    }
  }
  let best = null;
  let bestArea = -1;
  for (let index = 0; index < total; index += 1) {
    const node = nodes.nth(index);
    if (!(await node.isVisible().catch(() => false))) continue;
    const box = await node.boundingBox().catch(() => null);
    if (!box || !box.width || !box.height) continue;
    const area = intersectionArea(box, reference);
    if (area > bestArea) {
      bestArea = area;
      best = { name: await node.getAttribute("data-tour"), box };
    }
  }
  return best;
}

async function captureStep(page, info, counter) {
  const label = `${info.role} ${info.route} ${info.viewport.name} step ${counter.current}`;
  const viewport = page.viewportSize() ?? info.viewport;
  const expectedTarget = await tourDialog(page).getAttribute("data-tour-target").catch(() => null);
  await page.waitForTimeout(120);
  const spotlight = await page.locator(".tour-spotlight").first().boundingBox().catch(() => null);
  const tooltip = await tourDialog(page)
    .locator(".tour-card")
    .first()
    .boundingBox()
    .catch(() => null);
  const target = await findSpotlightTarget(page, spotlight, expectedTarget);

  check(`${label} has a visible tour target`, Boolean(target), "No visible [data-tour] element overlaps the spotlight.");
  if (target) {
    check(
      `${label} target intersects the viewport`,
      intersectionArea(target.box, { x: 0, y: 0, width: viewport.width, height: viewport.height }) > 0,
      `${target.name ?? "?"} ${JSON.stringify(target.box)}`,
    );
  }
  const spotlightVisible = Boolean(spotlight && spotlight.width > 0 && spotlight.height > 0);
  check(`${label} spotlight is visible`, spotlightVisible, JSON.stringify(spotlight));
  if (spotlightVisible && target) {
    check(
      `${label} spotlight intersects target ${target.name ?? "?"}`,
      intersectionArea(spotlight, target.box) > 0,
      `${JSON.stringify(spotlight)} ${JSON.stringify(target.box)}`,
    );
  }
  check(
    `${label} tooltip is fully inside the viewport`,
    insideViewport(tooltip, viewport, 2),
    JSON.stringify(tooltip),
  );

  if (info.shots === false) return;
  const file = stepFile(info, counter.current);
  mkdirSync(path.dirname(file), { recursive: true });
  const saved = await page
    .screenshot({ path: file })
    .then(() => true)
    .catch(() => false);
  check(`${label} screenshot captured`, saved, file);
}

async function runTour(page, info) {
  await clickHelp(page);
  const dialog = tourDialog(page);
  const opened = await dialog
    .waitFor({ state: "visible", timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  check(`${info.label} help opens the tour dialog`, opened);
  if (!opened) return { closed: false, steps: 0 };

  let steps = 0;
  for (let guard = 0; guard < 24; guard += 1) {
    const counter = await readCounter(dialog);
    const previousTarget = await dialog.getAttribute("data-tour-target");
    if (!counter) {
      check(`${info.label} tour exposes a Step X of Y counter`, false);
      await closeTour(page, dialog);
      break;
    }
    steps = Math.max(steps, counter.current);
    await captureStep(page, info, counter);

    const finish = dialog.getByRole("button", { name: /^finish$/i }).first();
    const next = dialog.getByRole("button", { name: /^next$/i }).first();
    if (await finish.count()) {
      await finish.click();
      const closed = await dialog
        .waitFor({ state: "hidden", timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      check(`${info.label} Finish closes the tour on step ${counter.current}`, closed);
      return { closed, steps };
    }
    if (!(await next.count())) {
      check(`${info.label} step ${counter.current} has a Next or Finish button`, false);
      await closeTour(page, dialog);
      break;
    }
    await next.click();
    const advanced = await waitForCounterChange(page, dialog, counter.current, previousTarget);
    check(
      `${info.label} step ${counter.current} advances`,
      Boolean(advanced || !(await dialog.count())),
      JSON.stringify(advanced),
    );
    if (!advanced) {
      await closeTour(page, dialog);
      break;
    }
  }
  return { closed: !(await dialog.count()), steps };
}

async function clientNavigate(page, href) {
  const target = new URL(href, BASE);
  const arrivedAt = (url) => url.pathname === target.pathname && url.search === target.search;
  if (arrivedAt(new URL(page.url()))) return true;

  const pushed = await page.evaluate((nextHref) => {
    const router = window.next?.router;
    if (!router || typeof router.push !== "function") return false;
    router.push(nextHref);
    return true;
  }, href);
  if (pushed) {
    const arrived = await page
      .waitForURL(arrivedAt, { timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    if (arrived) return true;
  }

  let link = page.locator(`a[href="${href}"]:visible`).first();
  const menu = page.getByRole("button", { name: /open menu/i }).first();
  if (!(await link.count()) && (await menu.count())) {
    await menu.click().catch(() => {});
    link = page.getByRole("dialog", { name: /workspace menu/i }).locator(`a[href="${href}"]`).first();
  }
  const label = NAV_LABELS[href];
  if (!(await link.count()) && label) {
    const drawer = page.getByRole("dialog", { name: /workspace menu/i });
    const scope = (await drawer.count()) ? drawer : page;
    link = scope.getByRole("link", { name: new RegExp(`^${label}$`, "i") }).first();
  }
  if (!(await link.count())) return false;
  await link.click();
  return page
    .waitForURL(arrivedAt, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
}

async function federatedTabPass(page, role) {
  for (const tab of FEDERATED_TABS[role]) {
    try {
      const navigated = await clientNavigate(page, tab.href);
      check(`${role} ${tab.label} tab client navigation reaches its view`, navigated, tab.href);
      if (!navigated) continue;
      const crumbText = (await page.locator('[data-tour="workspace-breadcrumbs"]').first().textContent()) ?? "";
      const selected =
        tab.kind === "role"
          ? await page
              .getByRole("tab", { name: new RegExp(`^${tab.label}$`, "i") })
              .first()
              .getAttribute("aria-selected")
          : tab.kind === "nav"
            ? await page
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
        `${role} ${tab.label} tab shows breadcrumb and selection`,
        crumbText.includes(tab.crumb) && selectedOk,
        JSON.stringify({ crumbText, selected }),
      );
    } catch (error) {
      check(`${role} ${tab.label} tab pass completed`, false, error.message);
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
        `${role} cannot open ${otherRole} ${tab.label} tab`,
        url.pathname.startsWith(`/${role}`),
        page.url(),
      );
    } catch (error) {
      check(`${role} cannot open ${otherRole} ${tab.label} tab`, false, error.message);
    }
  }
}

async function findSurveyHref(page) {
  const link = page.locator('[data-tour="surveys-list"] a[href*="/surveys/"]').first();
  const ready = await link
    .waitFor({ state: "visible", timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  if (!ready) return null;
  return link.getAttribute("href");
}

async function resetProgress(page) {
  await page.evaluate(async () => {
    try {
      window.localStorage.removeItem("sgov-tour-progress-v1");
      const response = await fetch("/api/tours/progress", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      await fetch("/api/tours/progress", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          completed: {},
          dismissed: {},
          sidebarCollapsed: Boolean(body?.sidebarCollapsed),
        }),
      });
    } catch {}
    window.dispatchEvent(new Event("smartgov:tour-progress-reset"));
  });
  await page.waitForTimeout(100);
}

async function signIn(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  if (await tourDialog(page).count()) await page.keyboard.press("Escape");
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole("button", { name: /sign in/i }).first().click();
  await page.waitForURL(/\/(usg|lsg)/, { timeout: 60000 });
}

async function specialPasses(page, role) {
  const firstRoute = ROUTES[role][0];
  const awayRoute = AWAY_ROUTES[role];
  const desktop = VIEWPORTS[2];
  const mobile = VIEWPORTS[0];
  const label = (name) => `${role} ${firstRoute} ${name}`;
  const setDesktop = () => page.setViewportSize({ width: desktop.width, height: desktop.height });

  try {
    await setDesktop();
    await resetProgress(page);
    await clientNavigate(page, firstRoute);
    const previousTour = tourDialog(page);
    if (await previousTour.count()) await closeTour(page, previousTour);
    const ready = await waitForHelp(page);
    check(`${label("back")} help is available`, ready);
    if (ready) {
      await clickHelp(page);
      const dialog = tourDialog(page);
      await dialog.waitFor({ state: "visible", timeout: 10000 });
      const first = await readCounter(dialog);
      const firstTarget = await dialog.getAttribute("data-tour-target");
      check(`${label("back")} starts on step 1`, first?.current === 1, JSON.stringify(first));
      await dialog.getByRole("button", { name: /^next$/i }).first().click();
      const second = await waitForCounterChange(page, dialog, 1, firstTarget);
      check(`${label("back")} reaches step 2`, second?.current === 2, JSON.stringify(second));
      const secondTarget = await dialog.getAttribute("data-tour-target");
      await dialog.getByRole("button", { name: /^back$/i }).first().click();
      const previous = await waitForCounterChange(page, dialog, 2, secondTarget);
      check(`${label("back")} returns to step 1`, previous?.current === 1, JSON.stringify(previous));
      await closeTour(page, dialog);
    }
  } catch (error) {
    check(`${label("back")} pass completed`, false, error.message);
  }

  try {
    await setDesktop();
    await resetProgress(page);
    await clientNavigate(page, firstRoute);
    const previousTour = tourDialog(page);
    if (await previousTour.count()) await closeTour(page, previousTour);
    const ready = await waitForHelp(page);
    check(`${label("skip")} help is available`, ready);
    if (ready) {
      await clickHelp(page);
      const dialog = tourDialog(page);
      await dialog.waitFor({ state: "visible", timeout: 10000 });
      await dialog.getByRole("button", { name: /^skip$/i }).first().click();
      const skipped = await dialog
        .waitFor({ state: "hidden", timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      check(`${label("skip")} closes the tour`, skipped);
      await resetProgress(page);
      await clientNavigate(page, awayRoute);
      await clientNavigate(page, firstRoute);
      if (await waitForHelp(page)) {
        await clickHelp(page);
        const reopened = await dialog
          .waitFor({ state: "visible", timeout: 10000 })
          .then(() => true)
          .catch(() => false);
        check(`${label("escape")} help reopens the tour`, reopened);
        if (reopened) {
          await page.keyboard.press("Escape");
          const escaped = await dialog
            .waitFor({ state: "hidden", timeout: 5000 })
            .then(() => true)
            .catch(() => false);
          check(`${label("escape")} closes the tour`, escaped);
        }
      }
      await closeTour(page, dialog);
    }
  } catch (error) {
    check(`${label("skip/escape")} pass completed`, false, error.message);
  }

  try {
    await setDesktop();
    await resetProgress(page);
    await clientNavigate(page, firstRoute);
    const previousTour = tourDialog(page);
    if (await previousTour.count()) await closeTour(page, previousTour);
    const ready = await waitForHelp(page);
    check(`${label("resize")} help is available`, ready);
    if (ready) {
      await clickHelp(page);
      const dialog = tourDialog(page);
      await dialog.waitFor({ state: "visible", timeout: 10000 });
      await page.setViewportSize({ width: mobile.width, height: mobile.height });
      await page.waitForTimeout(400);
      const tooltip = await dialog
        .locator(".tour-card")
        .first()
        .boundingBox()
        .catch(() => null);
      check(
        `${label("resize")} tooltip stays in the viewport after desktop to mobile resize`,
        insideViewport(tooltip, { width: mobile.width, height: mobile.height }, 2),
        JSON.stringify(tooltip),
      );
      await closeTour(page, dialog);
    }
  } catch (error) {
    check(`${label("resize")} pass completed`, false, error.message);
  }

  try {
    await setDesktop();
    await resetProgress(page);
    await clientNavigate(page, firstRoute);
    const previousTour = tourDialog(page);
    if (await previousTour.count()) await closeTour(page, previousTour);
    const ready = await waitForHelp(page);
    check(`${label("persistence")} help is available`, ready);
    if (ready) {
      const result = await runTour(page, {
        role,
        route: firstRoute,
        viewport: desktop,
        label: label("persistence"),
        shots: false,
      });
      check(`${label("persistence")} tour was finished`, result.closed && result.steps > 0);
      await clientNavigate(page, awayRoute);
      await clientNavigate(page, firstRoute);
      if (await waitForHelp(page)) {
        await clickHelp(page);
        await page.waitForTimeout(1000);
        const dialogs = await tourDialog(page).count();
        check(`${label("persistence")} completed tour does not reopen`, dialogs === 0, `dialog count ${dialogs}`);
      }
    }
  } catch (error) {
    check(`${label("persistence")} pass completed`, false, error.message);
  }
}

async function rolePass(browser, role, email, password) {
  console.log(`\n${role.toUpperCase()} guided tour browser pass`);
  const context = await browser.newContext({ viewport: VIEWPORTS[2] });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(30000);

  try {
    const signedIn = await signIn(page, email, password)
      .then(() => true)
      .catch((error) => {
        check(`${role} signs in through the UI`, false, error.message);
        return false;
      });
    if (signedIn) {
      check(`${role} signs in through the UI`, true);
      check(`${role} lands in its workspace`, new URL(page.url()).pathname.startsWith(`/${role}`));
    }
    if (!signedIn) return;

    for (const route of ROUTES[role]) {
      for (const viewport of VIEWPORTS) {
        const info = {
          role,
          route,
          viewport,
          label: `${role} ${route} ${viewport.name}`,
        };
        try {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          await resetProgress(page);
          let href = route;
          if (route.endsWith("/*")) {
            await clientNavigate(page, `/${role}/surveys`);
            href = await findSurveyHref(page);
            const found = check(`${info.label} survey link exists under [data-tour="surveys-list"]`, Boolean(href));
            if (!found) continue;
          }
          const navigated = await clientNavigate(page, href);
          check(`${info.label} client navigation reaches the route`, navigated, href);
          if (!navigated) continue;
          const previousTour = tourDialog(page);
          if (await previousTour.count()) await closeTour(page, previousTour);
          const ready = await waitForHelp(page);
          check(`${info.label} help button is visible`, ready);
          if (!ready) continue;
          const name = await helpName(page);
          check(
            `${info.label} help button is named Take a tour of this page`,
            /take a tour of this page/i.test(name),
            name,
          );
          await runTour(page, info);
        } catch (error) {
          check(`${info.label} route pass completed`, false, error.message);
        }
      }
    }

    await federatedTabPass(page, role);
    await specialPasses(page, role);
  } finally {
    await context.close();
  }
}

async function publicPass(browser) {
  console.log("\nPUBLIC / CREATE guided tour browser pass");
  const context = await browser.newContext({ viewport: VIEWPORTS[2] });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(30000);

  try {
    for (const route of PUBLIC_ROUTES) {
      for (const viewport of VIEWPORTS) {
        const info = {
          role: "public",
          route,
          viewport,
          label: `public ${route} ${viewport.name}`,
        };
        try {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          const response = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
          check(`${info.label} page loads`, Boolean(response && response.status() < 400), `status ${response?.status()}`);
          await resetProgress(page);
          if (await tourDialog(page).count()) await page.keyboard.press("Escape");
          const ready = await waitForHelp(page);
          check(`${info.label} help button is visible`, ready);
          if (!ready) continue;
          const name = await helpName(page);
          check(
            `${info.label} help button is named Take a tour of this page`,
            /take a tour of this page/i.test(name),
            name,
          );
          await runTour(page, info);
        } catch (error) {
          check(`${info.label} route pass completed`, false, error.message);
        }
      }
    }
  } finally {
    await context.close();
  }
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  console.log("  SKIP  /invite/* requires a live invite token");
  console.log("  SKIP  /forms/*/* requires a live form id");

  let credentials;
  try {
    credentials = fixture();
  } catch (error) {
    check("credentials fixture is readable", false, error.message);
    console.log(`\n${checks - failures}/${checks} tour browser checks passed.`);
    process.exitCode = 1;
    return;
  }
  secrets = [credentials.password, credentials.emails.usg, credentials.emails.lsg];

  const browser = await chromium.launch();
  try {
    await rolePass(browser, "usg", credentials.emails.usg, credentials.password);
    await rolePass(browser, "lsg", credentials.emails.lsg, credentials.password);
    await publicPass(browser);
  } catch (error) {
    check("browser run completed", false, error.message);
  } finally {
    await browser.close();
  }

  console.log(`\n${checks - failures}/${checks} tour browser checks passed.`);
  if (failures > 0) process.exitCode = 1;
}

await main();
