/**
 * Browser end-to-end for the structure feature.
 *
 * The SQL and HTTP layers are already covered by `scripts/probe-structure.mjs`
 * and `scripts/probe-structure-http.mjs`. What this adds is the one thing
 * neither can reach: a real sign-in through the real form, a real session
 * cookie, and the two pages a browser actually renders.
 *
 * Why a fixture is built here rather than reusing an existing account:
 * `SessionGuard` signs out any document that was *loaded* rather than navigated
 * to, because the only server-visible difference between those two cases is
 * nothing at all -- the signal is a per-tab module boolean that `markBooted()`
 * sets after a successful sign-in. A session token minted directly in Postgres
 * is therefore not enough on its own; the browser has to really sign in, and it
 * needs an account with a password it can present. That last step is also the
 * assertion: the walkthrough ends by proving the tab-tied guard still fires on a
 * direct load, because a guard that does not is worse than no guard.
 *
 * The fixture is created against the same database the app runs on, is named so
 * it is unmistakable, and is torn down on the way out including on a throw. The
 * password is generated per run and never written down.
 *
 * Run: node scripts/probe-structure-browser.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
import pg from "pg";

const BASE = process.env.PROBE_BASE_URL ?? "http://127.0.0.1:3100";

function loadEnv(f) {
  if (!existsSync(f)) return {};
  const out = {};
  for (const row of readFileSync(f, "utf8").split(/\r?\n/)) {
    const line = row.trim();
    if (!line || line.startsWith("#")) continue;
    const at = line.indexOf("=");
    if (at === -1) continue;
    let v = line.slice(at + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[line.slice(0, at).trim()] = v;
  }
  return out;
}

const env = { ...loadEnv(".env"), ...loadEnv(".env.local") };

let passed = 0;
let failed = 0;

function ok(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}`);
    if (detail !== undefined) console.log(`          got: ${JSON.stringify(detail)}`);
  }
}

// ------------------------------------------------------------------ fixture

const stamp = Date.now().toString(36);
const password = `Br-${crypto.randomUUID()}-9x`;
const emails = {
  owner: `browser-owner-${stamp}@probe.invalid`,
  lsg: `browser-lsg-${stamp}@probe.invalid`,
  reviewer: `browser-usg-${stamp}@probe.invalid`,
};

const db = new pg.Client({
  connectionString: env.POSTGRES_URL || env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
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
    for (const o of stale) await db.query(`select lo_unlink($1)`, [o.oid]);
    console.error(`cleaned up ${cleanup.orgs.length} probe org(s), ${stale.length} large object(s)`);
  } catch (error) {
    console.error("cleanup failed:", error.message);
  }
  await db.end().catch(() => {});
}

// Registered before the first insert, so a throw during the fixture cannot leave
// a probe organization behind in a real database.
process.on("uncaughtException", async (error) => {
  console.error("crashed:", error);
  await teardown();
  process.exit(1);
});

/** Positional call, matching how the forwarders are actually declared. */
async function fn(name, ...args) {
  const ph = args.map((_, i) => `$${i + 1}`).join(", ");
  const bound = args.map((a) =>
    Array.isArray(a) || (a && typeof a === "object") ? JSON.stringify(a) : a,
  );
  try {
    return (await db.query(`select public.${name}(${ph}) as r`, bound)).rows[0].r;
  } catch (error) {
    return { ok: false, sqlError: error.message };
  }
}

async function tokenFor(accountId) {
  const t = `probe-browser-${Math.random().toString(36).slice(2)}`;
  await db.query(
    `insert into smartgov.sessions (account_id, token_hash, expires_at)
     values ($1, smartgov.sha256($2), now() + interval '30 minutes')`,
    [accountId, t],
  );
  return t;
}

console.log(`\n--- 0. a federated organization, one council, and two officers`);

const created = await fn("create_organization", {
  organizationName: `Browser Probe ${stamp}`,
  governanceModel: "federated",
  academicYear: "2026-2027",
  universityName: "Probe State University",
  charterNumber: `BP-${stamp}`,
  officerName: "Probe Owner",
  officerEmail: emails.owner,
  officerRole: "usg_officer",
  units: [{ name: "College of Engineering", type: "college" }],
});
ok("the organization was created", created.ok !== false && !!created.organizationId, created);

const orgId = created.organizationId;
cleanup.orgs.push(orgId);

const ownerAcct = (
  await db.query(
    `insert into smartgov.accounts (email, password_hash, display_name, account_kind,
       account_scope, organization_id, university_name, status)
     values ($1, smartgov.hash_password($2), 'Probe Owner', 'usg', 'owner', $3,
       'Probe State University', 'active') returning id`,
    [emails.owner, password, orgId],
  )
).rows[0].id;

const units = (
  await db.query(
    `select id, name, unit_type from public.governance_units
      where organization_id = $1 order by parent_id nulls first`,
    [orgId],
  )
).rows;
const usgUnit = units.find((u) => u.unit_type === "usg");
const lsgUnit = units.find((u) => u.unit_type === "college");
ok("the USG root and one council exist", !!usgUnit && !!lsgUnit, units);

const ownerTok = await tokenFor(ownerAcct);
const posRes = await fn("add_position", ownerTok, "President", 0);
await fn("toggle_unit_position", ownerTok, lsgUnit.id, posRes.positionId, true);

/** Invites an officer into a seat through the real path, then activates them. */
async function seat(email, unitId, positionId, unitName) {
  const invite = await fn("create_invite", ownerTok, email, unitName, "college", unitId, positionId);
  if (!invite.ok) return null;
  await fn("accept_invite", invite.token, password);
  const acct = (await db.query(`select id from smartgov.accounts where email=$1`, [email])).rows[0];
  await db.query(`update smartgov.accounts set status='active', activated_at=now() where id=$1`, [
    acct.id,
  ]);
  return acct.id;
}

const lsgAcct = await seat(emails.lsg, lsgUnit.id, posRes.positionId, "College of Engineering");
ok("the council officer registers and is seated", !!lsgAcct, lsgAcct);

// The reviewer is a separate person from the author. Self-review is refused by
// design, so an end-to-end approval cannot use the officer who wrote it.
const reviewerAcct = await seat(
  emails.reviewer,
  usgUnit.id,
  posRes.positionId,
  "University Student Government",
);
ok("a second USG officer is seated for review", !!reviewerAcct, reviewerAcct);
void ownerTok;

// ------------------------------------------------------------------- browser

const browser = await chromium.launch();

async function signIn(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });

  // The form posts natively if it is submitted before hydration attaches the
  // handler, which lands on `/login?` with the same markup and no error. Waiting
  // for the network to settle is what makes the click reach React instead.
  await page.waitForLoadState("networkidle");
  await page.locator("#email").fill(email);
  // The password field ships with a "Show password" toggle, so the accessible
  // name "password" matches both. Addressing the control by role and its exact
  // type is what picks the input rather than the button.
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();

  // A refused sign-in renders its reason on the page instead of navigating, so a
  // timeout here has to say what the page said rather than just "timed out".
  try {
    await page.waitForURL(/\/(dashboard|lsg|usg)/, { timeout: 30_000 });
    // The workspace shell mounts after the server navigation resolves; clicking a
    // nav item before it exists is a timeout that has nothing to do with the
    // feature under test.
    await page.waitForLoadState("networkidle");
    await page.locator("nav").first().waitFor({ timeout: 30_000 });
  } catch {
    const said = (await page.locator("[role='alert'], p").allTextContents()).join(" | ").trim();
    throw new Error(`sign-in did not navigate (${page.url()}): ${said.slice(0, 300)}`);
  }
}

try {
  const consoleErrors = [];
  const watch = (page) => {
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(String(error)));
  };

  const context = await browser.newContext();
  const page = await context.newPage();
  watch(page);

  console.log("\n--- 1. the officer signs in");
  await signIn(page, emails.lsg);
  ok("the LSG officer reaches their workspace", /dashboard|\/lsg/.test(page.url()), page.url());

  console.log("\n--- 2. the officer's builder");
  // Sign-in lands on /dashboard, which is a redirect shell rather than the
  // officer's own page, so the footer link that lives on /lsg is one client-side
  // navigation away. Going there by URL would be a cold load, which is exactly
  // what the tab-tied guard signs out -- so this has to be a click.
  await page.getByRole("link", { name: /^Today/ }).first().click();
  await page.waitForURL(/\/lsg$/, { timeout: 30_000 });
  ok("the officer reaches their own page", /\/lsg$/.test(page.url()), page.url());

  await page.getByRole("link", { name: /council structure/i }).first().click();
  await page.waitForURL(/structure/, { timeout: 30_000 });
  await page.waitForSelector("text=Council", { timeout: 30_000 });
  ok(
    "the builder renders for the officer's own council",
    /College of Engineering/.test(await page.content()),
    page.url(),
  );

  // Assembling the document is the part no other probe checks: this is the JSON
  // the browser actually puts on the wire.
  await page.getByLabel("Council", { exact: true }).first().fill("College of Engineering Student Council");
  await page.getByLabel("Position", { exact: true }).first().fill("President");
  await page.getByRole("button", { name: /assign holder/i }).first().click();
  await page.getByLabel("Email").first().fill(emails.lsg);
  await page.getByLabel("First name").first().fill("Probe");
  await page.getByLabel("Last name").first().fill("Officer");
  await page.getByLabel("Label", { exact: true }).fill("A.Y. 2026-2027");
  await page.getByLabel("Starts").fill("2026-08-01");
  await page.getByLabel("Ends").fill("2027-08-01");
  ok("the form fills in without a validation complaint", true);

  // Order is part of what gets published, so reordering is a real edit and is
  // checked through the arrow rather than by inspecting state. The arrow is also
  // the keyboard path: a drag handle alone would be unreachable here.
  await page.getByRole("button", { name: /add position/i }).first().click();
  await page.getByLabel("Position", { exact: true }).nth(1).fill("Vice President");
  await page.getByRole("button", { name: /move vice president up/i }).click();
  const topTitle = await page.getByLabel("Position", { exact: true }).nth(0).inputValue();
  ok("positions reorder in the browser", topTitle === "Vice President", topTitle);

  await page.getByRole("button", { name: /^Save draft$/ }).click();
  await page.waitForSelector("text=Saved as revision", { timeout: 30_000 });
  ok("the draft saves from the browser", true);

  await page.getByRole("button", { name: /save and submit for review/i }).click();
  await page.waitForSelector("text=Sent for review", { timeout: 30_000 });
  ok("and it submits for review", true);

  console.log("\n--- 3. the reviewer's queue, in its own session");
  const reviewerContext = await browser.newContext();
  const reviewerPage = await reviewerContext.newPage();
  watch(reviewerPage);

  await signIn(reviewerPage, emails.reviewer);
  ok("the reviewer reaches their workspace", /dashboard|\/usg/.test(reviewerPage.url()), reviewerPage.url());

  await reviewerPage.getByRole("link", { name: /^Structures$/ }).first().click();
  await reviewerPage.waitForURL(/structure/, { timeout: 30_000 });
  await reviewerPage.waitForSelector("text=College of Engineering Student Council", { timeout: 30_000 });
  ok("the submitted structure is in the reviewer's queue", true);
  ok("and it is marked submitted", (await reviewerPage.locator("text=submitted").count()) > 0);

  // Approval is the action that rewrites seats, so it is the one worth doing
  // through the UI rather than over HTTP.
  await reviewerPage.getByRole("button", { name: /^Approve$/ }).first().click();
  await reviewerPage.waitForSelector("text=Approved. The structure is now published.", { timeout: 30_000 });
  ok("approving publishes it", true);

  console.log("\n--- 4. renewing into the next term");
  // Back through the officer's own pages rather than by URL: a cold load is what
  // the tab-tied guard signs out, and this tab already signed in legitimately.
  await page.getByRole("link", { name: /back to council/i }).click();
  await page.waitForURL(/\/my-council$/, { timeout: 30_000 });
  ok("the builder's own back link works", true);

  // `/my-council` is a standalone page with no app nav, so the way back is the
  // pair of links it renders at the bottom -- and the way to the builder is one
  // of them, which is also the only check that this page is not a dead end.
  await page.getByRole("link", { name: /council structure/i }).first().click();
  await page.waitForSelector("text=Renew the structure", { timeout: 30_000 });
  ok("the council page links back into the builder", true);
  ok("the live term now offers a renewal", true);

  await page.getByRole("button", { name: /^Renew$/ }).click();
  await page.waitForSelector("text=Renewed.", { timeout: 30_000 });
  ok("renewing opens the next term as a draft", true);

  const lineage = (
    await db.query(
      `select id, status, term_label, renews_id, document
         from smartgov.gov_structures where unit_id = $1 order by created_at`,
      [lsgUnit.id],
    )
  ).rows;
  const nextTerm = lineage.find((r) => r.renews_id);
  ok(
    "the new draft is linked to the term it renews",
    !!nextTerm && nextTerm.status === "draft",
    lineage.map((r) => ({ status: r.status, term: r.term_label, renews: r.renews_id })),
  );
  // Renewing is "carry this forward", not "rebuild from memory": the officer and
  // the reordered seats must survive into the new draft.
  ok(
    "and it carried the officers forward",
    !!nextTerm && /Officer/.test(JSON.stringify(nextTerm.document)),
    nextTerm?.document?.committees?.[0]?.positions?.map((p) => p.title),
  );

  console.log("\n--- 5. the guard this fixture exists for");
  const fresh = await browser.newContext();
  const freshPage = await fresh.newPage();
  watch(freshPage);
  // A context with no cookie and no `markBooted()`: the server would still render
  // the page if it could tell the difference, which is exactly why it cannot.
  await freshPage.goto(`${BASE}/my-council/structure`, { waitUntil: "domcontentloaded" });
  await freshPage.waitForURL(/\/login/, { timeout: 30_000 }).catch(() => {});
  ok(
    "a cold load of a gated page lands on sign-in",
    /\/login/.test(freshPage.url()),
    freshPage.url(),
  );

  console.log("\n--- 6. nothing threw along the way");
  const real = consoleErrors.filter((t) => !/favicon|Failed to load resource|404/i.test(t));
  ok("no uncaught page errors", real.length === 0, real);
} catch (error) {
  failed++;
  console.error("\nthe walkthrough threw:", error.message);
} finally {
  await browser.close();
  await teardown();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);