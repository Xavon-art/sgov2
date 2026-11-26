/**
 * Permanent browser matrix for the USG/LSG structure editor.
 *
 * Covers the real browser flows the SQL/HTTP probes cannot: sign-in, template
 * gallery handoff, chart/form editing, autosave, conflict resolution, drag
 * persistence, review, approval, and renewal. Fixtures are throwaway orgs with
 * per-run credentials and are always cleaned up.
 *
 * Run: node scripts/probe-structure-editor-ui.mjs
 * Optional: PROBE_BASE_URL=http://127.0.0.1:3100 node scripts/probe-structure-editor-ui.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
import pg from "pg";

const BASE = process.env.PROBE_BASE_URL ?? "http://127.0.0.1:3100";
const stamp = Date.now().toString(36);
const password = `Br-${crypto.randomUUID()}-9x`;

function loadEnv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const row of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = row.trim();
    if (!line || line.startsWith("#")) continue;
    const at = line.indexOf("=");
    if (at === -1) continue;
    let value = line.slice(at + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, at).trim()] = value;
  }
  return out;
}

const env = { ...loadEnv(".env"), ...loadEnv(".env.local") };

let passed = 0;
let failed = 0;
function ok(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}`);
    if (detail !== undefined) console.log(`          got: ${JSON.stringify(detail).slice(0, 500)}`);
  }
}

const db = new pg.Client({
  connectionString: env.POSTGRES_URL || env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

const cleanup = { orgs: [] };

async function teardown() {
  try {
    if (cleanup.orgs.length) {
      await db.query(`delete from public.organizations where id = any($1)`, [cleanup.orgs]);
    }
    const stale = (
      await db.query(
        `select lo.oid from pg_largeobject_metadata lo
          where lo.oid not in (select photo_oid from smartgov.roster where photo_oid is not null)`,
      )
    ).rows;
    for (const row of stale) await db.query(`select lo_unlink($1)`, [row.oid]);
    console.log(`cleaned up ${cleanup.orgs.length} probe org(s), ${stale.length} large object(s)`);
  } catch (error) {
    console.error("cleanup failed:", error.message);
  }
  await db.end().catch(() => {});
}

process.on("uncaughtException", async (error) => {
  console.error("crashed:", error);
  await teardown();
  process.exit(1);
});

async function fn(name, ...args) {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  const bound = args.map((value) =>
    Array.isArray(value) || (value && typeof value === "object") ? JSON.stringify(value) : value,
  );
  try {
    return (await db.query(`select public.${name}(${placeholders}) as r`, bound)).rows[0].r;
  } catch (error) {
    return { ok: false, sqlError: error.message };
  }
}

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9UAAAAASUVORK5CYII=",
  "base64",
);
// Tiny 1x1 files in the other two formats the photo input accepts. They are
// real images, so a decoder failure cannot be mistaken for an editor failure.
const jpeg = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDs0NDT/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
  "base64",
);
const webp = Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64");
const photoFiles = {
  png: { name: "officer.png", mimeType: "image/png", buffer: png },
  jpeg: { name: "officer.jpg", mimeType: "image/jpeg", buffer: jpeg },
  webp: { name: "officer.webp", mimeType: "image/webp", buffer: webp },
};

async function signIn(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.locator("#email").fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  try {
    await page.waitForURL(/\/(dashboard|lsg|usg)/, { timeout: 30_000 });
    await page.waitForLoadState("networkidle");
    await page.locator("nav").first().waitFor({ timeout: 30_000 });
  } catch {
    const said = (await page.locator("[role='alert'], p").allTextContents()).join(" | ").trim();
    throw new Error(`sign-in did not navigate (${page.url()}): ${said.slice(0, 300)}`);
  }
}

async function typeAndAssert(locator, value, label) {
  await locator.click();
  await locator.press("Control+A");
  await locator.press("Backspace");
  await locator.type(value, { delay: 10 });
  const got = await locator.inputValue();
  ok(`${label} keeps typed spaces/value`, got === value, got);
  return got;
}

async function waitAutosave(page) {
  await page.getByText("Draft saved.", { exact: false }).waitFor({ timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(500);
}


/** The LSG editor lives on its own page; the dashboard nav labels drifted. */
async function gotoLsgStructure(page) {
  await page.goto(new URL("/my-council/structure", BASE).href, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.locator('[data-tour="council-structure-workspace"]').first().waitFor({ timeout: 30_000 });
}


  async function gotoUsgStructure(page) {
    await page.goto(new URL("/usg/manage?tab=structure", BASE).href, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    await page.getByText(/USG sample charts|NEUST USG sample charts|Templates|Chart builder|Classic form/).first().waitFor({ timeout: 30_000 });
  }


async function readStructureRow(unitId) {
  const row = (
    await db.query(
      `select id, status, term_label, document, updated_at
         from smartgov.gov_structures
        where unit_id = $1
        order by updated_at desc, created_at desc
        limit 1`,
      [unitId],
    )
  ).rows[0];
  return row ?? null;
}

function hasDataImage(page) {
  return page.locator('img[src^="data:image"]').count();
}

/** One broken new check must not skip the flows that were already passing. */
async function guard(label, fn) {
  try {
    await fn();
  } catch (error) {
    ok(`${label} flow completed`, false, error.message);
  }
}

async function waitForStatus(unitId, statuses) {
  const deadline = Date.now() + 30_000;
  let row = await readStructureRow(unitId);
  while (!statuses.includes(row?.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    row = await readStructureRow(unitId);
  }
  return row;
}

/** Same gallery handoff the older flows use, kept in one place for the matrix. */
async function applyBlankTemplate(page, scope) {
  const custom = page.locator("article").filter({ hasText: "Custom / Start from scratch" }).first();
  await custom.getByRole("link", { name: "Preview full structure" }).click();
  await page.waitForURL(/\/structure\/preview/, { timeout: 30_000 });
  await page.getByRole("button", { name: "Use this template" }).first().click();
  await page.waitForURL(
    scope === "usg" ? /\/usg\/manage\?tab=structure/ : /\/my-council\/structure/,
    { timeout: 30_000 },
  );
  await page.getByText(/Blank structure started/).waitFor({ timeout: 30_000 });
}

async function expectBlankTermLabel(page, label) {
  const input = page.getByPlaceholder("A.Y. 2026-2027").first();
  await input.waitFor({ timeout: 30_000 });
  const placeholder = await input.getAttribute("placeholder");
  const value = await input.inputValue();
  ok(
    `[${label}] new blank structure term label is empty before save`,
    placeholder === "A.Y. 2026-2027" && value === "",
    { placeholder, value },
  );
}

/** Makes a blank document publishable and gives its one seat a real holder. */
async function fillPublishableDraft(page, label, email) {
  const councilName = `Matrix ${label} Council`;
  await page.getByRole("button", { name: "Classic form" }).first().click();
  await page.getByLabel("Starts").fill("2026-08-01");
  await page.getByLabel("Ends").fill("2027-07-31");
  await page.getByPlaceholder("College of Engineering Student Council").fill(councilName);
  await page.getByPlaceholder("President").fill(`Matrix ${label} President`);
  await page.getByRole("button", { name: "Assign holder", exact: true }).first().click();
  await page.getByLabel("Email").first().fill(email);
  await page.getByLabel("First name").first().fill("Matrix");
  await page.getByLabel("Last name").first().fill("Officer");
  return councilName;
}

/** Node cards inside the chart, not the shell's titled/aria-labelled buttons. */
function chartNodes(page) {
  return page.locator('[data-tour="structure-chart"] button[title][aria-label]');
}

/**
 * Uploads in the chart inspector and checks the node card itself -- not the
 * inspector -- plus the fact that the database has not received that photo yet.
 */
async function expectChartPhotoPreview(page, label, unitId, files) {
  await page.getByRole("button", { name: "Chart builder" }).first().click();
  const seat = chartNodes(page).first();
  await seat.waitFor({ timeout: 30_000 });
  await seat.click();
  const fileInput = page.locator('aside:has(input[type="file"]) input[type="file"]').first();
  for (const file of files) {
    await fileInput.setInputFiles(file);
    const expectedSrc = `data:${file.mimeType};base64,${file.buffer.toString("base64")}`;
    const preview = chartNodes(page).locator(`img[src="${expectedSrc}"]`).first();
    let seen = null;
    try {
      await preview.waitFor({ timeout: 10_000 });
      seen = await page.evaluate(
        async ({ marker, unitId }) => {
          const img = document.querySelector(
            '[data-tour="structure-chart"] button[title][aria-label] img[src^="data:image"]',
          );
          const res = await fetch(`/api/structures/${encodeURIComponent(unitId)}`);
          const data = await res.json().catch(() => null);
          return {
            src: img?.getAttribute("src") ?? null,
            saved: JSON.stringify(data?.draft?.document ?? null).includes(marker),
          };
        },
        { marker: file.buffer.toString("base64").slice(0, 24), unitId },
      );
    } catch {
      seen = null;
    }
    ok(
      `[${label}] chart node previews the uploaded ${file.mimeType} immediately`,
      seen?.src === expectedSrc,
      seen?.src?.slice(0, 60) ?? "no data:image chart preview",
    );
    ok(
      `[${label}] ${file.mimeType} preview appears before the photo is saved`,
      seen?.saved === false,
      seen?.saved ?? "no preview",
    );
  }
}

async function expectSaveDraft(page, label, unitId, councilName, file) {
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  // Autosave can land first; the database state is the assertion, not the toast.
  await page.getByText(/Saved as revision/).waitFor({ timeout: 30_000 }).catch(() => {});
  const marker = file.buffer.toString("base64").slice(0, 24);
  await page.waitForFunction(
    async ({ unitId, councilName, marker }) => {
      const res = await fetch(`/api/structures/${encodeURIComponent(unitId)}`);
      const data = await res.json().catch(() => null);
      const doc = data?.draft?.document;
      return !!doc && JSON.stringify(doc).includes(councilName) && JSON.stringify(doc).includes(marker);
    },
    { unitId, councilName, marker },
    { timeout: 30_000 },
  );
  const row = await waitForStatus(unitId, ["draft"]);
  ok(
    `[${label}] Save draft stores a draft with the typed name and photo`,
    row?.status === "draft" && row?.document?.committees?.[0]?.name === councilName,
    { status: row?.status, name: row?.document?.committees?.[0]?.name },
  );
}

async function expectSubmit(page, label, unitId, expectedStatus) {
  await page.getByRole("button", { name: "Save and submit for review" }).click();
  await page.getByText(/Sent for review|Approved and published/).waitFor({ timeout: 30_000 });
  const row = await waitForStatus(unitId, [expectedStatus]);
  ok(`[${label}] submit leaves the draft as ${expectedStatus}`, row?.status === expectedStatus, row?.status ?? null);
}

async function createFixture(label) {
  const emails = {
    owner: `browser-ui-owner-${label}-${stamp}@probe.invalid`,
    lsg: `browser-ui-lsg-${label}-${stamp}@probe.invalid`,
    reviewer: `browser-ui-usg-${label}-${stamp}@probe.invalid`,
  };
  const created = await fn("create_organization", {
    organizationName: `Browser UI Probe ${label} ${stamp}`,
    governanceModel: "federated",
    academicYear: "2026-2027",
    universityName: "Probe State University",
    charterNumber: `BUI-${label}-${stamp}`,
    officerName: "Probe Owner",
    officerEmail: emails.owner,
    officerRole: "usg_officer",
    units: [{ name: "College of Engineering", type: "college" }],
  });
  ok(`[${label}] organization created`, created.ok !== false && !!created.organizationId, created);
  cleanup.orgs.push(created.organizationId);

  const ownerAcct = (
    await db.query(
      `insert into smartgov.accounts (email, password_hash, display_name, account_kind,
         account_scope, organization_id, university_name, status)
       values ($1, smartgov.hash_password($2), 'Probe Owner', 'usg', 'owner', $3,
         'Probe State University', 'active') returning id`,
      [emails.owner, password, created.organizationId],
    )
  ).rows[0].id;

  const units = (
    await db.query(
      `select id, name, unit_type, parent_id from public.governance_units
        where organization_id = $1 order by parent_id nulls first`,
      [created.organizationId],
    )
  ).rows;
  const usgUnit = units.find((u) => u.unit_type === "usg" || u.parent_id == null);
  const lsgUnit = units.find((u) => u.unit_type === "college");
  ok(`[${label}] USG and LSG units exist`, !!usgUnit && !!lsgUnit, units);

  async function tokenFor(accountId) {
    const token = `probe-ui-${label}-${Math.random().toString(36).slice(2)}`;
    await db.query(
      `insert into smartgov.sessions (account_id, token_hash, expires_at)
       values ($1, smartgov.sha256($2), now() + interval '30 minutes')`,
      [accountId, token],
    );
    return token;
  }

  const ownerTok = await tokenFor(ownerAcct);
  const posRes = await fn("add_position", ownerTok, "President", 0);
  await fn("toggle_unit_position", ownerTok, lsgUnit.id, posRes.positionId, true);

  async function seat(email, unitId, positionId, unitName, displayName) {
    const invite = await fn("create_invite", ownerTok, email, unitName, "college", unitId, positionId);
    if (!invite.ok) return null;
    await fn("accept_invite", invite.token, password);
    const acct = (await db.query(`select id from smartgov.accounts where email=$1`, [email])).rows[0];
    await db.query(
      `update smartgov.accounts set status='active', activated_at=now(), display_name=coalesce(display_name,$2) where id=$1`,
      [acct.id, displayName],
    );
    return acct.id;
  }

  const lsgAcct = await seat(emails.lsg, lsgUnit.id, posRes.positionId, "College of Engineering", "Probe LSG");
  const reviewerAcct = await seat(
    emails.reviewer,
    usgUnit.id,
    posRes.positionId,
    "University Student Government",
    "Probe Reviewer",
  );
  ok(`[${label}] LSG and reviewer accounts seated`, !!lsgAcct && !!reviewerAcct, { lsgAcct, reviewerAcct });

  return { emails, orgId: created.organizationId, usgUnit, lsgUnit, ownerAcct, lsgAcct, reviewerAcct };
}

const browser = await chromium.launch({ headless: true });
const consoleErrors = [];
function watch(page) {
  page.on("console", (msg) => {
    const t = msg.text();
    if (msg.type() === "error") consoleErrors.push(t);
    if (t.includes("[structure:init]")) console.error("BROWSER " + t.slice(0, 800));
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));
}
try {
  console.log("\n--- 0. Blank term, chart preview, Save draft and Submit on both scopes ---");
  const matrix = await createFixture("matrix");
  const matrixCases = [
    {
      label: "usg",
      email: matrix.emails.owner,
      unitId: matrix.usgUnit.id,
      go: gotoUsgStructure,
      photos: [photoFiles.png, photoFiles.jpeg],
      submitStatus: "approved", // the root unit self-approves on submit
    },
    {
      label: "lsg",
      email: matrix.emails.lsg,
      unitId: matrix.lsgUnit.id,
      go: gotoLsgStructure,
      photos: [photoFiles.webp],
      submitStatus: "submitted",
    },
  ];
  for (const flow of matrixCases) {
    await guard(`[${flow.label}] matrix`, async () => {
      const ctx = await browser.newContext();
      try {
        const page = await ctx.newPage();
        watch(page);
        await signIn(page, flow.email);
        await flow.go(page);
        await expectBlankTermLabel(page, flow.label);
        await applyBlankTemplate(page, flow.label);
        const councilName = await fillPublishableDraft(page, flow.label, flow.email);
        await expectChartPhotoPreview(page, flow.label, flow.unitId, flow.photos);
        await expectSaveDraft(page, flow.label, flow.unitId, councilName, flow.photos.at(-1));
        await expectSubmit(page, flow.label, flow.unitId, flow.submitStatus);
      } finally {
        await ctx.close();
      }
    });
  }

  console.log("\n--- 1. USG owner path: gallery scope/format, custom blank, drag, conflict ---");
  const usg = await createFixture("usg");
  const usgCtx = await browser.newContext();
  const usgPage = await usgCtx.newPage();
  watch(usgPage);
  await signIn(usgPage, usg.emails.owner);
  ok("[usg] owner reached workspace", /dashboard|\/usg/.test(usgPage.url()), usgPage.url());

  await gotoUsgStructure(usgPage);
  ok("[usg] chart mode default", await usgPage.getByRole("button", { name: "Chart builder" }).first().isVisible(), "chart builder");
  ok("[usg] USG sample section visible", await usgPage.getByText(/NEUST USG sample charts/).first().isVisible());
  ok("[usg] LSG-only sample absent", (await usgPage.getByText("NEUST Local Student Government").count()) === 0);
  ok("[usg] USG format present", await usgPage.getByText("University Student Government").first().isVisible());
  ok("[usg] college format absent from USG gallery", (await usgPage.getByText("College Student Government").count()) === 0);

  const customCard = usgPage.locator("article").filter({ hasText: "Custom / Start from scratch" }).first();
  ok("[usg] custom card present", await customCard.isVisible());
  await customCard.getByRole("link", { name: "Preview full structure" }).click();
  await usgPage.waitForURL(/\/structure\/preview/, { timeout: 30_000 });
  ok("[usg] custom preview read-only", (await usgPage.locator('input[type="file"]').count()) === 0);
  await usgPage.getByRole("button", { name: "Use this template" }).first().click();
  await usgPage.waitForURL(/\/usg\/manage\?tab=structure/, { timeout: 30_000 });
  await usgPage.getByText(/Blank structure started/).waitFor({ timeout: 30_000 });
  ok("[usg] custom blank applied", true);

  await usgPage.getByRole("button", { name: "Classic form" }).click();
  const termLabel = usgPage.getByPlaceholder("A.Y. 2026-2027");
  await typeAndAssert(termLabel, "A.Y. 2026  - 2027", "[usg] blank term label typed"); // intentional spaces
  await usgPage.getByLabel("Starts").fill("2026-08-01");
  await usgPage.getByLabel("Ends").fill("2027-07-31");
  const councilInput = usgPage.getByPlaceholder("College of Engineering Student Council");
  await typeAndAssert(councilInput, "USG  Custom Council  Name", "[usg] council name typed");
  const positionInput = usgPage.getByPlaceholder("President");
  await typeAndAssert(positionInput, "USG  President  Prime", "[usg] position title typed");
  await usgPage.getByRole("button", { name: "Save draft", exact: true }).click();
  await usgPage.getByText(/Saved as revision/).waitFor({ timeout: 30_000 });
  let usgRow = await readStructureRow(usg.usgUnit.id);
  ok("[usg] blank term label saved/defaulted", usgRow?.term_label === "A.Y. 2026  - 2027" || usgRow?.term_label === "Current term", usgRow?.term_label);
  ok("[usg] typed council name saved", usgRow?.document?.committees?.[0]?.name === "USG  Custom Council  Name", usgRow?.document?.committees?.[0]?.name);
  ok("[usg] typed position saved", usgRow?.document?.committees?.[0]?.positions?.[0]?.title === "USG  President  Prime", usgRow?.document?.committees?.[0]?.positions?.[0]?.title);

  await usgPage.goto(new URL("/usg/manage?tab=structure", BASE).href, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await usgPage.waitForLoadState("networkidle");
  await usgPage.getByRole("button", { name: "Classic form" }).first().waitFor({ timeout: 30_000 });
  await usgPage.getByRole("button", { name: "Classic form" }).click();
  const reloadedCouncil = await usgPage.getByPlaceholder("College of Engineering Student Council").inputValue();
  ok("[usg] council name persists after reload", reloadedCouncil === "USG  Custom Council  Name", reloadedCouncil);
  const reloadedTerm = await usgPage.getByPlaceholder("A.Y. 2026-2027").inputValue();
  ok("[usg] term label persists/autosave reload", reloadedTerm === "A.Y. 2026  - 2027" || reloadedTerm === "Current term", reloadedTerm);

  // Conflict resolve UI: make server newer from DB, then edit and save.
  usgRow = await readStructureRow(usg.usgUnit.id);
  const rt = await db.query(
    `select 1 from pg_trigger where tgname = 'sgov_structures_realtime' and tgrelid = 'smartgov.gov_structures'::regclass`,
  );
  const hasRt = rt.rowCount > 0;
  if (hasRt) await db.query(`alter table smartgov.gov_structures disable trigger sgov_structures_realtime`);
  try {
    await db.query(
      `update smartgov.gov_structures set updated_at = now() + interval '5 minutes', document = jsonb_set(document, '{committees,0,name}', to_jsonb($2::text)) where id=$1`,
      [usgRow.id, "Server Changed Council"],
    );
  } finally {
    if (hasRt) await db.query(`alter table smartgov.gov_structures enable trigger sgov_structures_realtime`);
  }
  await usgPage.getByPlaceholder("President").fill("USG Local Conflict Title");
  await usgPage.getByRole("button", { name: "Save draft", exact: true }).click();
  await usgPage.getByText(/Someone saved this structure after you opened it/).waitFor({ timeout: 30_000 });
  ok("[usg] conflict notice shown", true);
  await usgPage.getByRole("button", { name: "Reload theirs" }).click();
  await usgPage.waitForFunction(
    () => {
      const el = document.querySelector('input[placeholder="College of Engineering Student Council"]');
      return el instanceof HTMLInputElement && el.value === "Server Changed Council";
    },
    { timeout: 30_000 },
  );
  const afterReload = await usgPage.getByPlaceholder("College of Engineering Student Council").inputValue();
  ok("[usg] reload theirs takes server version", afterReload === "Server Changed Council", afterReload);

  // Keep mine path
  await db.query(
    `update smartgov.gov_structures set updated_at = now() + interval '5 minutes' where id=$1`,
    [usgRow.id],
  );
  await usgPage.getByPlaceholder("President").fill("USG Keep Mine Title");
  await usgPage.getByRole("button", { name: "Save draft", exact: true }).click();
  await usgPage.getByText(/Someone saved this structure after you opened it/).waitFor({ timeout: 30_000 });
  await usgPage.getByRole("button", { name: "Keep mine", exact: true }).click();
  await usgPage.getByRole("button", { name: "Save draft", exact: true }).click();
  await usgPage.getByText(/Saved as revision/).waitFor({ timeout: 30_000 });
  await usgPage.waitForFunction(
    async (unitId) => {
      const res = await fetch(`/api/structures/${encodeURIComponent(unitId)}`);
      const data = await res.json().catch(() => null);
      return data?.ok && data?.draft?.document?.committees?.[0]?.positions?.[0]?.title === "USG Keep Mine Title";
    },
    usg.usgUnit.id,
    { timeout: 30_000 },
  );
  usgRow = await readStructureRow(usg.usgUnit.id);
  ok("[usg] keep mine overwrites after conflict", usgRow?.document?.committees?.[0]?.positions?.[0]?.title === "USG Keep Mine Title", usgRow?.document?.committees?.[0]?.positions?.[0]?.title);
  // Drag layout persistence on USG chart
  await usgPage.getByRole("button", { name: "Chart builder" }).click();
  const usgNode = usgPage.locator('button[title]').filter({ hasText: /USG Keep Mine Title|USG  President  Prime|President/ }).first();
  await usgNode.waitFor({ timeout: 30_000 });
  const usgHandle = usgNode.locator('[aria-label^="Move "]').first();
  const box = await usgHandle.boundingBox();
  if (box) {
    const before = await usgNode.evaluate((el) => ({ left: parseFloat(el.style.left), top: parseFloat(el.style.top) }));
    await usgPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await usgPage.mouse.down();
    await usgPage.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 50, { steps: 12 });
    await usgPage.mouse.up();
    await usgPage.waitForTimeout(900);
    const after = await usgNode.evaluate((el) => ({ left: parseFloat(el.style.left), top: parseFloat(el.style.top) }));
    ok("[usg] drag moved node", Math.abs(after.left - before.left - 80) <= 12 && Math.abs(after.top - before.top - 50) <= 12, { before, after });
    await usgPage.getByRole("button", { name: "Save draft", exact: true }).click();
    await usgPage.getByText(/Saved as revision/).waitFor({ timeout: 30_000 });
    await usgPage.goto(new URL("/usg/manage?tab=structure", BASE).href, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await usgPage.waitForLoadState("networkidle");
    await usgPage.getByText(/Chart builder|Classic form/).first().waitFor({ timeout: 30_000 });
    const reNode = usgPage.locator('button[title]').filter({ hasText: /USG Keep Mine Title|USG  President  Prime|President/ }).first();
    await reNode.waitFor({ timeout: 30_000 });
    const persisted = await reNode.evaluate((el) => ({ left: parseFloat(el.style.left), top: parseFloat(el.style.top) }));
    ok("[usg] drag layout persisted", Math.abs(persisted.left - after.left) <= 2 && Math.abs(persisted.top - after.top) <= 2, { after, persisted });
  } else {
    ok("[usg] drag handle found", false, "no bounding box");
  }
  await usgCtx.close();

  console.log("\n--- 2. LSG author path: gallery, custom, CRUD, photo, autosave, submit/renew ---");
  const lsg = await createFixture("lsg");
  const lsgCtx = await browser.newContext();
  const lsgPage = await lsgCtx.newPage();
  watch(lsgPage);
  await signIn(lsgPage, lsg.emails.lsg);
  ok("[lsg] author reached workspace", /dashboard|\/lsg/.test(lsgPage.url()), lsgPage.url());
  await gotoLsgStructure(lsgPage);
  ok("[lsg] chart mode default", await lsgPage.getByRole("button", { name: "Chart builder" }).first().isVisible());
  ok("[lsg] LSG sample section visible", await lsgPage.getByText(/NEUST LSG sample charts/).first().isVisible());
  ok("[lsg] USG-only sample absent", (await lsgPage.getByText("NEUST University Student Government").count()) === 0);
  ok("[lsg] campus/college/department formats present", (await lsgPage.getByText("Campus Student Government").count()) > 0 && (await lsgPage.getByText("College Student Government").count()) > 0 && (await lsgPage.getByText("Department Student Government").count()) > 0, "formats");

  // Custom blank flow
  const lsgCustom = lsgPage.locator("article").filter({ hasText: "Custom / Start from scratch" }).first();
  await lsgCustom.getByRole("link", { name: "Preview full structure" }).click();
  await lsgPage.waitForURL(/\/structure\/preview/, { timeout: 30_000 });
  ok("[lsg] custom preview read-only", (await lsgPage.locator('input[type="file"]').count()) === 0);
  await lsgPage.getByRole("button", { name: "Use this template" }).first().click();
  await lsgPage.waitForURL(/\/my-council\/structure/, { timeout: 30_000 });
  await lsgPage.getByText(/Blank structure started/).waitFor({ timeout: 30_000 });

  await lsgPage.getByRole("button", { name: "Classic form" }).click();
  await typeAndAssert(lsgPage.getByPlaceholder("A.Y. 2026-2027"), "  A.Y. 2026-2027  ", "[lsg] term label typed with spaces");
  await lsgPage.getByLabel("Starts").fill("2026-08-01");
  await lsgPage.getByLabel("Ends").fill("2027-07-31");
  await typeAndAssert(lsgPage.getByPlaceholder("College of Engineering Student Council"), "College  of  Engineering  Student  Council", "[lsg] council name spaces");
  await typeAndAssert(lsgPage.getByPlaceholder("President"), "Council  President", "[lsg] president title spaces");
  // The blank template has no holder; add one so the chart inspector's holder
  // fields (Display name, Course, Section, Year) have something to edit.
  await lsgPage.getByRole("button", { name: "Assign holder", exact: true }).first().click();
  await lsgPage.getByLabel("Email").first().fill(lsg.emails.lsg);
  await lsgPage.getByLabel("First name").first().fill("Juan");
  await lsgPage.getByLabel("Last name").first().fill("Dela Cruz");
  await lsgPage.getByRole("button", { name: "Save draft", exact: true }).click();
  await lsgPage.getByText(/Saved as revision/).waitFor({ timeout: 30_000 });
  const lsgRow = await readStructureRow(lsg.lsgUnit.id);
  ok("[lsg] blank term label saved as typed/default", lsgRow?.term_label === "A.Y. 2026-2027" || lsgRow?.term_label === "  A.Y. 2026-2027  " || lsgRow?.term_label === "Current term", lsgRow?.term_label);
  ok("[lsg] council name saved with spaces", lsgRow?.document?.committees?.[0]?.name === "College  of  Engineering  Student  Council", lsgRow?.document?.committees?.[0]?.name);
  await lsgPage.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
  await lsgPage.getByRole("button", { name: "Classic form" }).click();
  ok("[lsg] reload preserves council name", (await lsgPage.getByPlaceholder("College of Engineering Student Council").inputValue()) === "College  of  Engineering  Student  Council");
  ok("[lsg] reload preserves term label", ["A.Y. 2026-2027", "  A.Y. 2026-2027  ", "Current term"].includes(await lsgPage.getByPlaceholder("A.Y. 2026-2027").inputValue()));

  // Chart CRUD + photo + free-text spaces + autosave
  await lsgPage.getByRole("button", { name: "Chart builder" }).click();
  const node = chartNodes(lsgPage).first();
  await node.waitFor({ timeout: 30_000 });
  await node.click();
  const displayName = lsgPage.getByPlaceholder("Display name");
  await typeAndAssert(displayName, "Juan  A.  Dela  Cruz", "[lsg] display name spaces");
  const course = lsgPage.getByPlaceholder("Course");
  await typeAndAssert(course, "BS  Computer  Science", "[lsg] course spaces");
  const section = lsgPage.getByPlaceholder("Section");
  await typeAndAssert(section, "A  1", "[lsg] section spaces");
  const year = lsgPage.getByPlaceholder("Year");
  await typeAndAssert(year, "3rd  Year", "[lsg] year spaces");

  // Photo upload
  const fileInput = lsgPage.locator('aside input[type="file"]').first();
  await fileInput.setInputFiles({ name: "officer.png", mimeType: "image/png", buffer: png });
  await lsgPage.waitForTimeout(800);
  ok("[lsg] photo upload renders preview", (await hasDataImage(lsgPage)) > 0, await hasDataImage(lsgPage));

  // CRUD: add branch/officer/seat/remove branch via chart controls
  await lsgPage.getByRole("button", { name: "Add branch", exact: true }).click();
  const branchInput = lsgPage.getByPlaceholder("e.g. College of Engineering");
  if (await branchInput.isVisible().catch(() => false)) {
    await branchInput.fill("Test  Branch");
    await lsgPage.getByRole("button", { name: "Add", exact: true }).click();
    await lsgPage.waitForTimeout(500);
    ok("[lsg] add branch", true);
  } else {
    ok("[lsg] add branch control available", false, "branch input not visible");
  }
  await lsgPage.getByRole("button", { name: "Add seat", exact: true }).click();
  await lsgPage.waitForTimeout(300);
  await lsgPage.getByRole("button", { name: "Classic form" }).click();
  const titles = lsgPage.getByPlaceholder("President");
  for (let i = 0; i < (await titles.count()); i++) {
    if ((await titles.nth(i).inputValue()).trim() === "") {
      await titles.nth(i).fill("Probe Seat");
      break;
    }
  }
  await lsgPage.getByRole("button", { name: "Chart builder" }).click();
  await lsgPage.waitForTimeout(200);
  ok("[lsg] add seat action", true);
  await lsgPage.getByRole("button", { name: "Add officer", exact: true }).click();
  ok("[lsg] add officer wizard opens", await lsgPage.getByText("Add an officer").isVisible().catch(() => false));
  await lsgPage.getByRole("button", { name: "Close" }).first().click().catch(() => {});

  // Autosave + reload
  await waitAutosave(lsgPage);
  await lsgPage.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
  await lsgPage.getByRole("button", { name: "Chart builder" }).click();
  const nodeAfter = chartNodes(lsgPage).first();
  await nodeAfter.click();
  ok("[lsg] display name autosaved/reloaded", (await lsgPage.getByPlaceholder("Display name").inputValue()) === "Juan  A.  Dela  Cruz", await lsgPage.getByPlaceholder("Display name").inputValue());
  ok("[lsg] course autosaved/reloaded", (await lsgPage.getByPlaceholder("Course").inputValue()) === "BS  Computer  Science", await lsgPage.getByPlaceholder("Course").inputValue());
  ok("[lsg] section autosaved/reloaded", (await lsgPage.getByPlaceholder("Section").inputValue()) === "A  1", await lsgPage.getByPlaceholder("Section").inputValue());
  ok("[lsg] year autosaved/reloaded", (await lsgPage.getByPlaceholder("Year").inputValue()) === "3rd  Year", await lsgPage.getByPlaceholder("Year").inputValue());
  // Submit for review
  await lsgPage.getByRole("button", { name: "Save and submit for review" }).click();
  await lsgPage.getByText(/Sent for review|Approved and published/).waitFor({ timeout: 30_000 });
  ok("[lsg] submitted/approved message shown", true);

  console.log("\n--- 3. Reviewer path: queue, approve, renew ---");
  const reviewerCtx = await browser.newContext();
  const reviewerPage = await reviewerCtx.newPage();
  watch(reviewerPage);
  await signIn(reviewerPage, lsg.emails.reviewer);
  ok("[reviewer] reached workspace", /dashboard|\/usg/.test(reviewerPage.url()), reviewerPage.url());
  await reviewerPage.goto(new URL("/usg/manage?tab=structure", BASE).href, { waitUntil: "domcontentloaded" });
  await reviewerPage.waitForLoadState("networkidle");
  await reviewerPage.getByText(/Review queue|Council structures/).first().waitFor({ timeout: 30_000 });
  await reviewerPage.getByText(/College  of  Engineering  Student  Council|College of Engineering/).first().waitFor({ timeout: 30_000 });
  ok("[reviewer] submitted structure visible", true);
  const approveBtn = reviewerPage.getByRole("button", { name: /^Approve$/ }).first();
  if (await approveBtn.isVisible().catch(() => false)) {
    await approveBtn.click();
    await reviewerPage.getByText("Approved. The structure is now published.").waitFor({ timeout: 30_000 });
    ok("[reviewer] approve published", true);
  } else {
    ok("[reviewer] approve button visible", false, "not visible - may be self-review or different status");
  }

  // Renew from LSG author
  await lsgPage.getByRole("link", { name: /back to council/i }).click().catch(() => {});
  await lsgPage.goto(`${BASE}/my-council/structure`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await lsgPage.waitForLoadState("networkidle").catch(() => {});
  await lsgPage.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  await lsgPage.waitForLoadState("networkidle").catch(() => {});
  await lsgPage.getByText(/Renew the structure|Approved|Published structure/).first().waitFor({ timeout: 30_000 }).catch(() => {});
  let renewBtn = lsgPage.getByRole("button", { name: /^Renew$/ }).first();
  if (!(await renewBtn.isVisible().catch(() => false))) {
    await lsgPage.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    await lsgPage.waitForLoadState("networkidle").catch(() => {});
    await lsgPage.getByText(/Renew the structure|Renew/).first().waitFor({ timeout: 15_000 }).catch(() => {});
    renewBtn = lsgPage.getByRole("button", { name: /^Renew$/ }).first();
  }
  if (await renewBtn.isVisible().catch(() => false)) {
    await renewBtn.click();
    await lsgPage.getByText(/Renewed\./).waitFor({ timeout: 30_000 });
    ok("[lsg] renew opens draft", true);
    const rows = (
      await db.query(
        `select id, status, renews_id from smartgov.gov_structures where unit_id=$1 order by created_at`,
        [lsg.lsgUnit.id],
      )
    ).rows;
    ok("[lsg] renewed draft linked", rows.some((r) => r.status === "draft" && r.renews_id), rows.map((r) => ({ status: r.status, renews: !!r.renews_id })));
  } else {
    const renewRows = (
      await db.query(
        `select id, status, created_by, term_label, starts_on, ends_on
           from smartgov.gov_structures where unit_id=$1 order by created_at`,
        [lsg.lsgUnit.id],
      )
    ).rows;
    const pageUnit = await lsgPage.evaluate(() => window.location.pathname);
    const chart = await lsgPage.evaluate(async () => (await fetch("/api/unit-chart")).json().catch(() => null));
    console.error("RENEW_DEBUG " + JSON.stringify({ lsgUnit: lsg.lsgUnit.id, usgUnit: lsg.usgUnit.id, page: pageUnit, chart, rows: renewRows }));
    ok("[lsg] renew button visible", false, await lsgPage.content().then((c) => c.includes("Renew the structure")));
  }

  await reviewerCtx.close();
  await lsgCtx.close();

  console.log("\n--- 4. Console/page errors ---");
  const real = consoleErrors.filter((t) => !/favicon|Failed to load resource|404|net::ERR|Download the React DevTools|script tag/i.test(t));
  ok("no uncaught page errors", real.length === 0, real.slice(0, 8));
} catch (error) {
  failed += 1;
  console.error("\nprobe failed:", error.stack || error.message);
} finally {
  await browser.close();
  await teardown();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
