import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

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

function source(path) {
  const absolute = join(ROOT, path);
  if (!existsSync(absolute)) {
    check(`file exists: ${path}`, false, `missing file: ${path}`);
    return "";
  }
  return readFileSync(absolute, "utf8");
}

function includes(path, snippets) {
  const text = source(path);
  if (!text) return;
  const missing = snippets.filter((snippet) => !text.includes(snippet));
  check(
    `${path} includes ${snippets.length} expected snippet(s)`,
    missing.length === 0,
    missing.length ? `missing: ${missing.join(" | ")}` : "",
  );
}

console.log("Resolution filing");

includes("supabase/migrations/20260101003400_resolution_submission_fields.sql", [
  "create_resolution_v2",
  "resolution_no",
  "date_passed",
  "short_summary",
  "proposed_budget",
  "claim_resolution_upload",
  "get_resolution_file",
  "review_resolution_notice",
]);

includes("src/app/api/resolutions/route.ts", [
  "create_resolution_v2",
  "resolutionNo",
  "datePassed",
  "shortSummary",
  "proposedBudget",
  "storagePath",
]);

includes("src/components/dashboard/ResolutionPanel.tsx", [
  "SUBMIT FOR USG REVIEW",
  "Resolution no.",
  "Date passed",
  "Short summary",
  "Proposed budget",
  "Attachment",
  'target: "resolution"',
]);

includes("src/components/dashboard/RequestSection.tsx", ["File resolution"]);

console.log("LSG budget dashboard");

includes("supabase/migrations/20260101003410_lsg_budget_dashboard.sql", [
  "lsg_budget_dashboard",
  "requestCount",
  "approvedCount",
  "remaining",
  "periods",
]);

includes("supabase/migrations/20260101003430_fix_lsg_budget_dashboard_unit_scope.sql", [
  "array_agg(u)",
  "lsg_unit_ids",
  "lsg_budget_dashboard",
]);

includes("src/lib/budgets.ts", ["BudgetDashboard"]);
includes("src/app/api/budgets/route.ts", ["dashboard"]);
includes("src/components/dashboard/FederatedOverview.tsx", [
  "Budget overview",
  "Total spent",
  "Requests",
  "Approved",
  "Remaining",
]);

console.log("Public feedback");

includes("supabase/migrations/20260101003420_public_feedback_home_and_verification.sql", [
  "list_public_feedback_forms",
  "respondent_year",
  "respondent_section",
  "respondent_course",
  "respondent_department_or_campus",
  "submit_public_feedback_response",
]);

includes("src/lib/feedback-forms-schema.ts", [
  "publicFeedbackSubmissionSchema",
  "respondentYear",
  "respondentSection",
  "respondentCourse",
  "respondentDepartmentOrCampus",
]);

includes("src/app/api/feedback/public/route.ts", ["listPublicFeedbackForms"]);
includes("src/components/landing/PublishedFeedbackForms.tsx", [
  "PublishedFeedbackForms",
  "/feedback/f/",
]);
includes("src/app/page.tsx", ["PublishedFeedbackForms"]);
includes("src/components/dashboard/PublicFeedbackForm.tsx", [
  "Year and section",
  "Course",
  "Department or campus",
  "respondentYear",
  "respondentDepartmentOrCampus",
]);

console.log(`\n${checks - failures}/${checks} requested-feature checks passed`);
if (failures > 0) process.exit(1);
