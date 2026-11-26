/**
 * End-to-end smoke and role-boundary check for the running app.
 *
 * Run against `npm run dev` (or `npm start`) at http://localhost:3000:
 *
 *   npm run check:smoke
 *
 * It is read-only: it signs in, reads pages and APIs, and asserts the walls
 * between the two workspaces. Nothing is created, changed, or deleted.
 *
 * The checks fall into three groups:
 *
 *   1. Anonymous -- pages bounce to /login and APIs answer 401.
 *   2. Session -- the cookie is HttpOnly + SameSite=Lax, and each role can
 *      reach its own tree but not the other's (307 redirect at the layout).
 *   3. Browser -- a real Chromium sign-in reaches the dashboard, a client-side
 *      navigation renders the seeded survey, and sign-out returns to /login.
 */
import { chromium } from "playwright";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const OWNER = { email: "owner@demo.smartgov.test", password: "SmartGov!2026" };
const LSG = { email: "pedro.engineering@demo.smartgov.test", password: "SmartGov!2026" };
const SEEDED_SURVEY = "Engineering Council Feedback";

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

async function login({ email, password }) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  return { status: res.status, setCookie, cookie: setCookie.split(";")[0] };
}

async function get(path, cookie) {
  return fetch(`${BASE}${path}`, {
    headers: cookie ? { cookie } : undefined,
    redirect: "manual",
  });
}

async function main() {
  console.log("Anonymous");
  for (const path of [
    "/api/overview",
    "/api/officers",
    "/api/invites",
    "/api/surveys",
    "/api/resolutions",
    "/api/documents",
    "/api/budgets",
    "/api/feed",
    "/api/accomplishment-reports",
    "/api/feedback",
    "/api/feedback/forms",
    "/api/feedback/available",
    "/api/feedback/forms/00000000-0000-0000-0000-000000000000/responses",
    "/api/profile/officer",
  ]) {
    const res = await get(path);
    check(`${path} answers 401 without a session`, res.status === 401, `got ${res.status}`);
  }
  for (const path of ["/usg", "/lsg"]) {
    const res = await get(path);
    check(`${path} redirects to /login`, res.status === 307 && res.headers.get("location") === "/login", `got ${res.status} ${res.headers.get("location") ?? ""}`);
  }
  const invalidPublic = await get("/api/feedback/public/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  check(
    "invalid public feedback slug answers 404 without a login redirect",
    invalidPublic.status === 404 && !invalidPublic.headers.get("location")?.includes("/login"),
    `got ${invalidPublic.status} ${invalidPublic.headers.get("location") ?? ""}`,
  );

  console.log("USG owner session");
  const owner = await login(OWNER);
  check("owner password login succeeds", owner.status === 200, `got ${owner.status}`);
  check("session cookie is HttpOnly", /httponly/i.test(owner.setCookie));
  check("session cookie is SameSite=Lax", /samesite=lax/i.test(owner.setCookie));
  check("owner reaches /usg", (await get("/usg", owner.cookie)).status === 200);
  const ownerIntoLsg = await get("/lsg", owner.cookie);
  check("owner is redirected out of /lsg", ownerIntoLsg.status === 307 && ownerIntoLsg.headers.get("location") === "/usg", `got ${ownerIntoLsg.status} ${ownerIntoLsg.headers.get("location") ?? ""}`);
  check("owner may list invites", (await get("/api/invites", owner.cookie)).status === 200);
  check("owner may list officers", (await get("/api/officers", owner.cookie)).status === 200);
  for (const path of [
    "/api/resolutions",
    "/api/documents",
    "/api/budgets",
    "/api/feed",
    "/api/accomplishment-reports",
    "/api/feedback",
    "/api/profile/officer",
  ]) {
    check(`owner may read ${path}`, (await get(path, owner.cookie)).status === 200);
  }
  const ownerIntoLsgTab = await get("/lsg/manage?tab=budget", owner.cookie);
  check(
    "owner is redirected out of the LSG budget tab",
    ownerIntoLsgTab.status === 307 && ownerIntoLsgTab.headers.get("location") === "/usg",
    `got ${ownerIntoLsgTab.status} ${ownerIntoLsgTab.headers.get("location") ?? ""}`,
  );

  console.log("LSG officer session");
  const lsg = await login(LSG);
  check("LSG password login succeeds", lsg.status === 200, `got ${lsg.status}`);
  check("LSG reaches /lsg", (await get("/lsg", lsg.cookie)).status === 200);
  const lsgIntoUsg = await get("/usg", lsg.cookie);
  check("LSG is redirected out of /usg", lsgIntoUsg.status === 307 && lsgIntoUsg.headers.get("location") === "/lsg", `got ${lsgIntoUsg.status} ${lsgIntoUsg.headers.get("location") ?? ""}`);
  check("LSG may not list invites", (await get("/api/invites", lsg.cookie)).status === 403);
  check("LSG may not list officers", (await get("/api/officers", lsg.cookie)).status === 403);
  check("LSG reaches its own overview API", (await get("/api/overview", lsg.cookie)).status === 200);
  for (const path of [
    "/api/resolutions",
    "/api/documents",
    "/api/budgets",
    "/api/feed",
    "/api/accomplishment-reports",
    "/api/profile/officer",
  ]) {
    check(`LSG may read ${path}`, (await get(path, lsg.cookie)).status === 200);
  }
  check("LSG may not read the feedback API", (await get("/api/feedback", lsg.cookie)).status === 403);
  check(
    "LSG may not list the officer roster",
    (await get("/api/profile/officer?scope=all", lsg.cookie)).status === 403,
  );
  const lsgIntoUsgTab = await get("/usg/manage?tab=people", lsg.cookie);
  check(
    "LSG is redirected out of the USG people tab",
    lsgIntoUsgTab.status === 307 && lsgIntoUsgTab.headers.get("location") === "/lsg",
    `got ${lsgIntoUsgTab.status} ${lsgIntoUsgTab.headers.get("location") ?? ""}`,
  );

  const bad = await login({ email: OWNER.email, password: "wrong-password" });
  check("wrong password is rejected", bad.status === 401 && !bad.cookie, `got ${bad.status}`);

  console.log("Browser");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("script tag")) {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

  try {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.locator('input[type="email"]').first().fill(OWNER.email);
    await page.locator('input[type="password"]').first().fill(OWNER.password);
    await page.getByRole("button", { name: /sign in/i }).first().click();
    await page.waitForURL(/\/(usg|lsg)/, { timeout: 60000 });
    check("browser sign-in reaches the workspace", page.url().includes("/usg"));

    const heading = await page.locator("h1").first().textContent();
    check("dashboard renders its heading", Boolean(heading?.trim()), heading ?? "");

    await page.getByRole("link", { name: /^overview$/i }).first().click();
    await page.getByRole("link", { name: /^survey$/i }).first().click();
    await page.waitForURL(/\/usg\/surveys/, { timeout: 30000 });
    await page.getByText(SEEDED_SURVEY).first().waitFor({ timeout: 30000 });
    check("client-side navigation reaches the seeded survey", true);

    await page.getByRole("button", { name: /sign out/i }).first().evaluate((el) => el.click());
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /sign out/i }).click();
    await page.waitForURL(/\/login/, { timeout: 30000 });
    check("sign-out returns to /login", true);
    check("no browser console errors", consoleErrors.length === 0, consoleErrors.join(" | "));
  } catch (error) {
    check("browser flow completed", false, error.message);
  } finally {
    await browser.close();
  }

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) process.exitCode = 1;
}

await main();

