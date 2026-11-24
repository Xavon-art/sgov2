import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

export const STABLE_NAV_IDS = Object.freeze([
  "overview",
  "manage",
  "request",
  "events",
  "survey",
  "settings",
]);
// The LSG workspace exposes its inbox as a first-class top-level destination;
// USG keeps Inbox nested under Request. Both lists are intentional.
export const LSG_STABLE_NAV_IDS = Object.freeze([
  "overview",
  "manage",
  "messages",
  "request",
  "events",
  "survey",
  "settings",
]);
export const STABLE_WIDGET_IDS = Object.freeze([
  "stats",
  "reports",
  "task-chart",
  "request-chart",
  "flow",
]);
export const STATUS_DISPLAY_VOCABULARY = Object.freeze({
  pending: "Pending",
  under_review: "Under review",
  approved: "Approved",
  returned: "Returned",
  rejected: "Rejected",
  cancelled: "Cancelled",
});
export const STATUS_DISPLAY_VOCABULARY_SURFACES = Object.freeze({
  request: Object.freeze([
    "pending",
    "under_review",
    "approved",
    "returned",
    "rejected",
    "cancelled",
  ]),
  events: Object.freeze([
    "pending",
    "under_review",
    "approved",
    "returned",
    "rejected",
    "cancelled",
  ]),
});
export const STATUS_DISPLAY_FAMILIES = Object.freeze({
  pending: Object.freeze(["submitted", "assigned", "awaiting", "draft"]),
  under_review: Object.freeze(["under_review", "in_progress", "claimed"]),
  approved: Object.freeze(["approved", "published", "done", "honored", "verified"]),
  returned: Object.freeze(["returned", "queried"]),
  rejected: Object.freeze(["rejected"]),
  cancelled: Object.freeze(["cancelled"]),
});

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

function readSource(path) {
  const absolute = join(ROOT, path);
  if (!existsSync(absolute)) {
    check(`${path} exists`, false, `missing file: ${path}`);
    return null;
  }
  return { absolute, source: readFileSync(absolute, "utf8") };
}

function stripCommentsAndStrings(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
    .replace(/`(?:[^`\\]|\\.)*`/g, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, " ")
    .replace(/'(?:[^'\\]|\\.)*'/g, " ");
}

function exportsMethod(code, method) {
  return new RegExp(
    `\\bexport\\s+(?:async\\s+function|function|const|let|var)\\s+${method}\\b` +
      `|\\bexport\\s*\\{[^}]*\\b${method}\\b[^}]*\\}`,
  ).test(code);
}

function usesWebApi(code) {
  return (
    /\b(?:Response|NextResponse)\s*\.\s*(?:json|redirect|next)\s*\(/.test(code) ||
    /\bnew\s+(?:Response|NextResponse|Request|NextRequest)\s*\(/.test(code) ||
    /\bRequest\s*\.\s*(?:json|text|formData|arrayBuffer|blob)\s*\(/.test(code)
  );
}

function extractTopLevelNavIds(source) {
  const returnIndex = source.search(/return\s*\[/);
  if (returnIndex === -1) return [];
  const start = source.indexOf("[", returnIndex);
  let arrayDepth = 0;
  let braceDepth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  const ids = [];
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (ch === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (ch === "\\") {
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "/" && next === "/") {
      lineComment = true;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      blockComment = true;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "[") {
      arrayDepth += 1;
      continue;
    }
    if (ch === "]") {
      arrayDepth -= 1;
      if (arrayDepth === 0) break;
      continue;
    }
    if (ch === "{") {
      braceDepth += 1;
      continue;
    }
    if (ch === "}") {
      braceDepth -= 1;
      continue;
    }
    if (
      ch === "i" &&
      arrayDepth === 1 &&
      braceDepth === 1 &&
      !/[A-Za-z0-9_$]/.test(source[i - 1] ?? "")
    ) {
      const match = /^id\s*:\s*(["'])([^"']+)\1/.exec(source.slice(i));
      if (match) {
        ids.push(match[2]);
        i += match[0].length - 1;
      }
    }
  }
  return ids;
}

export function readTopLevelNavIds(side) {
  const path = `src/components/dashboard/${side}-nav.ts`;
  const entry = readSource(path);
  return entry ? extractTopLevelNavIds(entry.source) : [];
}

export function assertNavIdsStable(side, expectedIds) {
  const ids = readTopLevelNavIds(side);
  const stable =
    ids.length === expectedIds.length && ids.every((id, index) => id === expectedIds[index]);
  if (!stable) {
    throw new Error(
      `${side} top-level nav ids changed: got [${ids.join(", ")}], expected [${expectedIds.join(", ")}]`,
    );
  }
}

export function extractWidgetIds(source) {
  const block = /const\s+WIDGETS\s*=\s*\[([\s\S]*?)\]\s+as\s+const/.exec(source)?.[1] ?? "";
  return [...block.matchAll(/\bid\s*:\s*["']([^"']+)["']/g)].map((match) => match[1]);
}

export function extractWidgetWhitelistIds(source) {
  const whitelist = /v_id\s+not\s+in\s*\(([^)]*)\)/.exec(source)?.[1] ?? "";
  return [...whitelist.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

export function assertFile(path) {
  const exists = existsSync(join(ROOT, path));
  check(`file exists: ${path}`, exists);
  return exists;
}

export function assertIncludes(path, snippets) {
  const entry = readSource(path);
  if (!entry) return;
  const missing = snippets.filter((snippet) => !entry.source.includes(snippet));
  check(
    `${path} includes ${snippets.length} expected snippet(s)`,
    missing.length === 0,
    missing.length ? `missing: ${missing.join(" | ")}` : "",
  );
}

export function assertNoIncludes(path, snippets) {
  const entry = readSource(path);
  if (!entry) return;
  const present = snippets.filter((snippet) => entry.source.includes(snippet));
  check(
    `${path} excludes ${snippets.length} forbidden snippet(s)`,
    present.length === 0,
    present.length ? `present: ${present.join(" | ")}` : "",
  );
}

export function assertRouteContract(path, methods) {
  const entry = readSource(path);
  if (!entry) return;
  const { absolute, source } = entry;
  const code = stripCommentsAndStrings(source);
  const missingMethods = methods.filter((method) => !exportsMethod(code, method));
  check(
    `${path} exports ${methods.join(", ")}`,
    missingMethods.length === 0,
    missingMethods.length ? `missing exports: ${missingMethods.join(", ")}` : "",
  );
  const usesNodeHttp = /\bIncomingMessage\b|\bServerResponse\b/.test(code);
  check(`${path} uses Web Request/Response APIs`, usesWebApi(code) && !usesNodeHttp);
  check(
    `${path} does not collide with page.tsx`,
    !existsSync(join(dirname(absolute), "page.tsx")),
  );
  if (path.includes("[")) {
    check(
      `${path} awaits dynamic params`,
      /await\s+(?:params|ctx\.params|context\.params)/.test(code),
    );
  }
}

export function assertNavStable(side, expectedIds) {
  const ids = readTopLevelNavIds(side);
  const stable =
    ids.length === expectedIds.length && ids.every((id, index) => id === expectedIds[index]);
  check(
    `${side} top-level nav ids are unchanged`,
    stable,
    `got [${ids.join(", ")}], expected [${expectedIds.join(", ")}]`,
  );
}

export function assertWidgetListStable(path, expectedIds) {
  const entry = readSource(path);
  if (!entry) return;
  const ids = extractWidgetIds(entry.source);
  check(
    `${path} default widget list is unchanged`,
    ids.length === expectedIds.length && ids.every((id, index) => id === expectedIds[index]),
    `got [${ids.join(", ")}], expected [${expectedIds.join(", ")}]`,
  );
  check(
    `${path} derives DEFAULT_WIDGETS from WIDGETS`,
    /const\s+DEFAULT_WIDGETS[^=]*=\s*WIDGETS\.map\(/.test(entry.source),
  );
}

export function assertWidgetWhitelistStable(path, expectedIds) {
  const entry = readSource(path);
  if (!entry) return;
  const ids = extractWidgetWhitelistIds(entry.source);
  check(
    `${path} whitelists the unchanged widget ids`,
    ids.length === expectedIds.length && ids.every((id, index) => id === expectedIds[index]),
    `got [${ids.join(", ")}], expected [${expectedIds.join(", ")}]`,
  );
  const defaults = [...entry.source.matchAll(/'\[([^\]]+)\]'::jsonb/g)].map((match) =>
    match[1].split(",").map((id) => id.trim().replace(/"/g, "")),
  );
  check(
    `${path} keeps the same default widget arrays`,
    defaults.length >= 2 &&
      defaults.every(
        (list) =>
          list.length === expectedIds.length &&
          list.every((id, index) => id === expectedIds[index]),
      ),
    `got ${JSON.stringify(defaults)}, expected ${JSON.stringify([[...expectedIds], [...expectedIds]])}`,
  );
}

export function assertDashboardAuditTargetStable() {
  const entry = readSource("scripts/check-dashboard-audit.mjs");
  if (!entry) return;
  const declaration = /export\s+const\s+DASHBOARD_AUDIT_TARGET\s*=\s*(\d+)\s*;/.exec(entry.source);
  const afterDeclaration = declaration
    ? entry.source.slice(declaration.index + declaration[0].length)
    : "";
  check(
    "check-dashboard-audit.mjs keeps the 30-check target",
    declaration?.[1] === "30" && /DASHBOARD_AUDIT_TARGET/.test(afterDeclaration),
  );
}

export function assertStatusVocabularyStable() {
  const expectedLabels = Object.freeze({
    pending: "Pending",
    under_review: "Under review",
    approved: "Approved",
    returned: "Returned",
    rejected: "Rejected",
    cancelled: "Cancelled",
  });
  const expectedSurfaces = Object.freeze({
    request: Object.freeze([
      "pending",
      "under_review",
      "approved",
      "returned",
      "rejected",
      "cancelled",
    ]),
    events: Object.freeze([
      "pending",
      "under_review",
      "approved",
      "returned",
      "rejected",
      "cancelled",
    ]),
  });
  check(
    "status vocabulary matches the shared display contract",
    JSON.stringify(STATUS_DISPLAY_VOCABULARY) === JSON.stringify(expectedLabels),
    `got ${JSON.stringify(STATUS_DISPLAY_VOCABULARY)}, expected ${JSON.stringify(expectedLabels)}`,
  );
  check(
    "Request and Events surfaces allow the literal shared labels",
    JSON.stringify(STATUS_DISPLAY_VOCABULARY_SURFACES) === JSON.stringify(expectedSurfaces),
    `got ${JSON.stringify(STATUS_DISPLAY_VOCABULARY_SURFACES)}, expected ${JSON.stringify(expectedSurfaces)}`,
  );
}

export function assertStatusFamiliesStable() {
  const expectedFamilies = Object.freeze({
    pending: Object.freeze(["submitted", "assigned", "awaiting", "draft"]),
    under_review: Object.freeze(["under_review", "in_progress", "claimed"]),
    approved: Object.freeze(["approved", "published", "done", "honored", "verified"]),
    returned: Object.freeze(["returned", "queried"]),
    rejected: Object.freeze(["rejected"]),
    cancelled: Object.freeze(["cancelled"]),
  });
  const sourceToDisplay = new Map(
    Object.entries(STATUS_DISPLAY_FAMILIES).flatMap(([display, sources]) =>
      sources.map((source) => [source, display]),
    ),
  );
  const expectedSources = Object.entries(expectedFamilies).flatMap(([display, sources]) =>
    sources.map((source) => [source, display]),
  );
  const allowedDisplays = new Set(Object.keys(STATUS_DISPLAY_VOCABULARY));
  check(
    "status source families match the design",
    JSON.stringify(STATUS_DISPLAY_FAMILIES) === JSON.stringify(expectedFamilies),
    `got ${JSON.stringify(STATUS_DISPLAY_FAMILIES)}, expected ${JSON.stringify(expectedFamilies)}`,
  );
  check(
    "every module-native status resolves to an approved display family",
    JSON.stringify([...sourceToDisplay.entries()]) === JSON.stringify(expectedSources) &&
      [...sourceToDisplay.values()].every((display) => allowedDisplays.has(display)),
    `got ${JSON.stringify([...sourceToDisplay.entries()])}`,
  );
}

const SELF = fileURLToPath(import.meta.url);
const SOURCE_DIRS = ["src", "scripts", "supabase", "public"];
const SOURCE_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".sql",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

function collectSourceFiles(directory, out) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(absolute, out);
    } else {
      const dot = entry.name.lastIndexOf(".");
      if (dot >= 0 && SOURCE_EXTENSIONS.has(entry.name.slice(dot))) out.push(absolute);
    }
  }
  return out;
}

export function assertNoExternalFormDependency() {
  const files = [];
  for (const directory of SOURCE_DIRS) {
    const absolute = join(ROOT, directory);
    if (existsSync(absolute)) collectSourceFiles(absolute, files);
  }
  const offenders = files.filter(
    (file) => file !== SELF && readFileSync(file, "utf8").includes("docs.google.com"),
  );
  check(
    "no source file contains docs.google.com",
    offenders.length === 0,
    offenders.length ? `found in ${offenders.join(", ")}` : "",
  );
}

const isMainEntry =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainEntry) {
  console.log("\nfederated feature contract\n");
  assertNavStable("usg", STABLE_NAV_IDS);
  assertNavStable("lsg", LSG_STABLE_NAV_IDS);
  assertWidgetListStable("src/components/dashboard/FederatedOverview.tsx", STABLE_WIDGET_IDS);
  assertWidgetWhitelistStable(
    "supabase/migrations/20260101003194_dashboard_widget_preferences.sql",
    STABLE_WIDGET_IDS,
  );
  assertDashboardAuditTargetStable();
  assertStatusVocabularyStable();
  assertStatusFamiliesStable();

  // ---- Task 3: Resolutions ----
  assertFile("supabase/migrations/20260101003200_resolutions.sql");
  assertFile("src/lib/resolutions.ts");
  assertFile("src/app/api/resolutions/route.ts");
  assertFile("src/app/api/resolutions/[id]/route.ts");
  assertFile("src/app/api/resolutions/[id]/review/route.ts");
  assertFile("src/components/dashboard/ResolutionPanel.tsx");
  assertIncludes("supabase/migrations/20260101003200_resolutions.sql", [
    "create_resolution",
    "list_resolutions",
    "get_resolution",
    "review_resolution",
    "revoke all",
    "grant execute",
  ]);
  assertRouteContract("src/app/api/resolutions/route.ts", ["GET", "POST"]);
  assertRouteContract("src/app/api/resolutions/[id]/route.ts", ["GET"]);
  assertRouteContract("src/app/api/resolutions/[id]/review/route.ts", ["POST"]);

  // ---- Task 4: Document catalog and search ----
  assertFile("supabase/migrations/20260101003210_document_catalog_and_search.sql");
  assertFile("src/lib/document-search.ts");
  assertFile("src/app/api/documents/route.ts");
  assertFile("src/app/api/documents/[submissionId]/route.ts");
  assertFile("src/app/api/documents/[submissionId]/approve/route.ts");
  assertFile("src/components/dashboard/DocumentLibraryPanel.tsx");
  assertFile("src/components/dashboard/DocumentSearchPanel.tsx");
  assertIncludes("supabase/migrations/20260101003210_document_catalog_and_search.sql", [
    "document_catalog",
    "search_documents",
    "set_document_metadata",
    "approve_document",
    "group_kind",
    "group_label",
    "to_tsvector",
    "revoke all",
    "grant execute",
  ]);
  assertRouteContract("src/app/api/documents/route.ts", ["GET"]);
  assertRouteContract("src/app/api/documents/[submissionId]/route.ts", ["PATCH"]);
  assertRouteContract("src/app/api/documents/[submissionId]/approve/route.ts", ["POST"]);

  // ---- Task 5: Event budget link and budget reflection ----
  assertFile("supabase/migrations/20260101003220_event_budget_link.sql");
  assertFile("src/components/dashboard/BudgetPanel.tsx");
  assertIncludes("supabase/migrations/20260101003220_event_budget_link.sql", [
    "event_id",
    "submit_event_budget",
    "budget_write_items",
    "proposal_id is null",
    "eventId",
    "revoke all",
    "grant execute",
  ]);
  assertIncludes("src/lib/budgets.ts", ["eventId", "eventTitle", "eventDate"]);
  assertIncludes("src/app/api/budgets/route.ts", ["eventId", "submit_event_budget"]);
  assertRouteContract("src/app/api/budgets/route.ts", ["GET", "POST"]);
  assertIncludes("src/components/dashboard/EventsWorkspace.tsx", ["Submit budget", "/api/budgets"]);

  // ---- Task 6: Unified calendar and future events ----
  assertFile("supabase/migrations/20260101003230_unified_calendar.sql");
  assertFile("src/components/dashboard/CalendarPanel.tsx");
  assertIncludes("supabase/migrations/20260101003230_unified_calendar.sql", [
    "create or replace function smartgov.list_calendar",
    "source",
    "itemId",
    "honorStatus",
    "smartgov.events",
    "smartgov.proposals",
  ]);
  assertIncludes("src/app/api/feed/route.ts", ["source"]);

  // ---- Task 7: Monitoring by campus ----
  assertFile("supabase/migrations/20260101003240_monitoring_by_campus.sql");
  assertFile("src/lib/monitoring.ts");
  assertFile("src/app/api/monitoring/route.ts");
  assertFile("src/components/dashboard/MonitoringPanel.tsx");
  assertIncludes("supabase/migrations/20260101003240_monitoring_by_campus.sql", [
    "monitoring_by_campus",
    "is_usg_side",
    "governance_units",
    "proposals",
    "budgets",
    "events",
    "documents",
    "resolutions",
  ]);
  assertRouteContract("src/app/api/monitoring/route.ts", ["GET"]);

  // ---- Task 8: Federated accomplishment reports ----
  assertFile("supabase/migrations/20260101003250_accomplishment_reports.sql");
  assertFile("src/lib/accomplishment-reports.ts");
  assertFile("src/app/api/accomplishment-reports/route.ts");
  assertFile("src/app/api/accomplishment-reports/[id]/route.ts");
  assertFile("src/app/api/accomplishment-reports/[id]/review/route.ts");
  assertFile("src/components/dashboard/AccomplishmentPanel.tsx");
  assertIncludes("supabase/migrations/20260101003250_accomplishment_reports.sql", [
    "accomplishment_reports",
    "event_id",
    "reporting_unit",
    "submit_accomplishment_report",
    "review_accomplishment_report",
    "revoke all",
    "grant execute",
  ]);
  assertIncludes("src/lib/accomplishment-reports.ts", [
    "AccomplishmentReportStatus",
    "AccomplishmentReportRow",
    "listAccomplishmentReports",
    "submitAccomplishmentReport",
    "reviewAccomplishmentReport",
  ]);
  assertRouteContract("src/app/api/accomplishment-reports/route.ts", ["GET", "POST"]);
  assertRouteContract("src/app/api/accomplishment-reports/[id]/route.ts", ["GET"]);
  assertRouteContract("src/app/api/accomplishment-reports/[id]/review/route.ts", ["POST"]);
  assertIncludes("src/components/dashboard/EventsWorkspace.tsx", [
    "AccomplishmentPanel",
    "Accomplishment",
  ]);
  assertIncludes("src/components/dashboard/usg-nav.ts", ["?tab=accomplishment"]);
  assertIncludes("src/components/dashboard/lsg-nav.ts", ["?tab=accomplishment"]);
  assertIncludes("src/lib/auth/messages.ts", ["duplicate_report", "attachment_not_allowed"]);
  assertIncludes("scripts/check-authority.mjs", [
    "anonymous accomplishment denial",
    "cross-unit accomplishment denial",
    "duplicate accomplishment prevention",
    "LSG accomplishment submit",
    "USG accomplishment review",
    "LSG accomplishment review denial",
  ]);

  // ---- Task 9: In-app feedback ----
  assertFile("supabase/migrations/20260101003260_feedback.sql");
  assertFile("src/lib/feedback.ts");
  assertFile("src/app/api/feedback/route.ts");
  assertFile("src/app/api/feedback/[id]/route.ts");
  assertFile("src/app/api/feedback/[id]/acknowledge/route.ts");
  assertFile("src/components/dashboard/FeedbackPanel.tsx");
  assertIncludes("supabase/migrations/20260101003260_feedback.sql", [
    "feedback_entries",
    "create_feedback",
    "list_feedback",
    "get_feedback",
    "acknowledge_feedback",
    "is_usg_side",
    "revoke all",
    "grant execute",
  ]);
  assertIncludes("src/lib/feedback.ts", [
    "FeedbackStatus",
    "FeedbackEntry",
    "createFeedback",
    "listFeedback",
    "getFeedback",
    "acknowledgeFeedback",
  ]);
  assertRouteContract("src/app/api/feedback/route.ts", ["GET", "POST"]);
  assertRouteContract("src/app/api/feedback/[id]/route.ts", ["GET"]);
  assertRouteContract("src/app/api/feedback/[id]/acknowledge/route.ts", ["POST"]);
  assertIncludes("src/components/dashboard/FeedbackPanel.tsx", [
    "FeedbackPanel",
    "/api/feedback",
    "Acknowledged",
    "No feedback has been submitted yet.",
  ]);
  assertIncludes("src/app/usg/manage/ManageClient.tsx", [
    "FeedbackWorkspace",
    'feedback: "reviewer"',
    "tab === \"feedback\"",
  ]);
  assertIncludes("src/app/lsg/manage/page.tsx", [
    "FeedbackWorkspace",
    'value === "feedback"',
    "tab === \"feedback\"",
  ]);
  assertIncludes("src/components/dashboard/usg-nav.ts", [
    '{ label: "Feedback", href: "/usg/manage?tab=feedback" }',
  ]);
  assertIncludes("src/components/dashboard/lsg-nav.ts", [
    '{ label: "Feedback", href: "/lsg/manage?tab=feedback" }',
  ]);
  assertIncludes("src/lib/auth/messages.ts", ["invalid_subject", "invalid_message"]);
  assertIncludes("scripts/check-authority.mjs", [
    "anonymous feedback create denial",
    "anonymous feedback list denial",
    "anonymous feedback detail denial",
    "anonymous feedback acknowledge denial",
    "feedback create",
    "feedback invalid payload denial",
    "non-reviewer feedback list denial",
    "non-reviewer feedback acknowledge denial",
    "reviewer feedback list",
    "reviewer feedback detail",
    "reviewer feedback acknowledge",
    "feedback org scoping",
    "no external form dependency",
  ]);
  assertNoExternalFormDependency();

  // ---- Task 10: Officer profile fields and accounts ----
  assertFile("supabase/migrations/20260101003270_officer_profile_fields.sql");
  assertFile("src/app/api/profile/officer/route.ts");
  assertFile("src/components/dashboard/OfficerProfileFields.tsx");
  assertFile("src/components/dashboard/AccountsPanel.tsx");
  assertIncludes("supabase/migrations/20260101003270_officer_profile_fields.sql", [
    "full_name",
    "campus_department",
    "program",
    "position",
    "update_officer_profile",
    "get_officer_profile",
    "list_officer_profiles",
    "revoke all",
    "grant execute",
    "is_usg_side",
  ]);
  assertRouteContract("src/app/api/profile/officer/route.ts", ["GET", "PATCH"]);
  assertIncludes("src/app/api/profile/officer/route.ts", [
    'callRpc<ProfilePayload>("get_officer_profile"',
    'callRpc<ProfilePayload>("list_officer_profiles"',
    'callRpc<ProfilePayload>("update_officer_profile"',
    "immutable_field",
  ]);
  assertIncludes("src/components/dashboard/OfficerProfileFields.tsx", [
    "OfficerProfile",
    "OfficerProfileFields",
    "fullName",
    "campusDepartment",
    "program",
    "position",
    "/api/profile/officer",
  ]);
  assertIncludes("src/components/dashboard/AccountsPanel.tsx", [
    "AccountsPanel",
    "fullName",
    "campusDepartment",
    "program",
    "position",
    "email",
    "role",
    "status",
    "/api/org-accounts",
    "/api/profile/officer?scope=all",
    "/api/officers/",
    "/deactivate",
  ]);
  assertIncludes("src/app/usg/manage/ManageClient.tsx", [
    "AccountsPanel",
    'accounts: "owner"',
    'tab === "accounts"',
  ]);
  assertIncludes("src/components/dashboard/ProfileSection.tsx", ["OfficerProfileFields"]);
  assertIncludes("src/components/dashboard/usg-nav.ts", [
    '{ label: "Accounts", href: "/usg/manage?tab=accounts" }',
  ]);
  assertNoIncludes("src/components/dashboard/lsg-nav.ts", [
    '{ label: "Accounts", href: "/lsg/manage?tab=accounts" }',
    "tab=accounts",
  ]);
  assertIncludes("src/lib/auth/messages.ts", ["immutable_field", "invalid_officer_field"]);
  assertIncludes("scripts/check-authority.mjs", [
    "anonymous officer profile denial",
    "officer self profile read",
    "officer self profile update",
    "cross-officer profile update denial",
    "LSG non-owner officer list denial",
    "USG owner officer list",
    "immutable officer field rejection",
  ]);

  console.log(
    failures === 0
      ? `\nall ${checks} checks passed\n`
      : `\n${failures} of ${checks} checks FAILED\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}
