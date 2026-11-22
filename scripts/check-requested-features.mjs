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

function excludes(path, snippets) {
  const text = source(path);
  if (!text) return;
  const found = snippets.filter((snippet) => text.includes(snippet));
  check(
    `${path} excludes ${snippets.length} obsolete snippet(s)`,
    found.length === 0,
    found.length ? `found: ${found.join(" | ")}` : "",
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

console.log("Latest LSG workspace fixes");

includes("src/components/dashboard/lsg-nav.ts", [
  "Your profile and your LSG structure",
  "Tasks from the student government",
]);

includes("src/components/dashboard/FederatedOverview.tsx", [
  "owes the student government",
  "Letter dashboard",
  "Letters submitted",
  "Under review",
]);

includes("src/components/dashboard/ProfileSection.tsx", [
  "setUniversityName(body.universityName",
  "setCampusName(body.campusName",
]);

includes("src/components/structure/StructureWorkspace.tsx", [
  "smartgov:structure-draft:",
  "localStorage.setItem(draftKey",
  "void showStoredPhoto()",
]);

includes("src/components/dashboard/RequestSection.tsx", [
  "Tasks from USG",
  "Requirements from USG",
  "Submit your requirement response",
]);

includes("src/components/dashboard/ResolutionPanel.tsx", [
  "Body (WHEREAS / RESOLVED)",
  "Proposed budget (PHP, optional)",
]);

excludes("src/components/dashboard/ResolutionPanel.tsx", [
  'proposedBudget.trim() === "" ||',
]);
excludes("src/app/api/resolutions/route.ts", [
  "if (proposedBudget === null || !Number.isFinite(proposedBudget) || proposedBudget < 0) {",
]);

includes("supabase/migrations/20260101003440_lsg_workspace_fixes.sql", [
  "v_roster_id",
  "actual_spent",
  "public_feedback_response_status",
  "Semester",
  "lsg_budget_dashboard",
]);

includes("src/components/dashboard/EventsWorkspace.tsx", [
  ">EDIT<",
  ">DELETE<",
  "Overall budget request",
  "Record spending",
  "Remaining budget",
]);

includes("src/lib/budgets.ts", ["actualSpent"]);
includes("src/app/api/budgets/[id]/route.ts", ["PATCH", "actualSpent"]);

includes("src/components/dashboard/PublicFeedbackForm.tsx", [
  "Fill in your verification details first",
  "Submission status",
  "feedback-submissions",
]);

includes("src/components/landing/PublishedFeedbackForms.tsx", [
  "feedback-submissions",
  "Submitted",
]);

includes("src/app/api/feedback/public/status/route.ts", [
  "public_feedback_response_status",
]);

console.log("LSG/USG workflow completion");

includes("supabase/migrations/20260101003490_structure_photo_persistence.sql", [
  "persist_structure_holder_photo",
  "show_structure_holder_photo",
]);

includes("src/app/api/structures/photos/route.ts", [
  "persist_structure_holder_photo",
  "POST",
]);

includes("src/components/structure/StructureWorkspace.tsx", [
  "persistPhoto",
  "loadStoredPhotos",
  "invalidateStructurePhotoCache",
]);

includes("src/components/structure/StructureChart.tsx", [
  "invalidateStructurePhotoCache",
  "null",
]);

includes("supabase/migrations/20260101003450_personal_request_decision_states.sql", [
  "personal_requests_status_check",
  "needs_revision",
  "submission_required",
  "decide_personal_request",
  "resubmit_personal_request",
]);

includes("src/components/dashboard/RequestSection.tsx", [
  "DecisionSection",
  "Need revision",
  "Require submission",
  "Resubmit",
]);

includes("supabase/migrations/20260101003460_event_report_requirements.sql", [
  "event_report_requirements",
  "sync_event_report_requirements",
  "can_file_accomplishment",
  "list_events",
]);

includes("supabase/migrations/20260101003500_fix_accomplishment_report_requirements.sql", [
  "event_report_requirements_event_sync",
  "event_report_requirements_scope_sync",
  "smartgov.is_event_assignee(p_account.id, e.id)",
  "smartgov.submit_accomplishment_report_v2_base",
]);
excludes("supabase/migrations/20260101003500_fix_accomplishment_report_requirements.sql", [
  "return jsonb_build_object('ok', false, 'reason', 'forbidden');",
]);

includes("src/components/dashboard/EventsWorkspace.tsx", [
  "Report required from:",
  "!isUsg && !e.cancelledAt",
  "event-approved-budget",
  "event-actual-spent",
  "event-remaining-budget",
]);

excludes("src/components/dashboard/EventsWorkspace.tsx", [">Assign<"]);

includes("src/components/dashboard/AccomplishmentPanel.tsx", [
  "Needs Submission",
  "Accomplished Reports",
  'status === "acknowledged"',
]);

includes("supabase/migrations/20260101003470_lsg_budget_propagation.sql", [
  "budget_requests_org_status_created_idx",
  "budget_requests_org_unit_status_created_idx",
  "actual_spent = 0",
  "b.status = 'approved'",
  "list_budgets",
]);

includes("src/components/dashboard/budget-store.tsx", [
  "refreshBudgetStore",
  "visibilitychange",
  "setInterval",
]);

includes("src/components/dashboard/BudgetPanel.tsx", [
  "BudgetReviewActions",
  "refreshBudgetStore",
  "actualSpent",
]);

includes("src/components/dashboard/LsgRequestBudgetPanel.tsx", [
  "Approved budgets",
  "Remaining budget",
  "refreshBudgetStore",
]);

includes("src/app/lsg/request/page.tsx", ["LsgRequestBudgetPanel"]);
includes("src/components/dashboard/FederatedOverview.tsx", ["useBudgetStore"]);

includes("supabase/migrations/20260101003480_unified_submission_catalog.sql", [
  "filed_document_catalog",
  "personal_requests",
  "accomplishment_report_files",
  "get_personal_request_file",
  "get_catalog_document",
  "delete from smartgov.filed_document_catalog where true",
]);

includes("src/lib/document-search.ts", ["downloadUrl", "sourceKind"]);
includes("src/app/api/documents/route.ts", ["groupKind", "originUnitId"]);
includes("src/components/dashboard/DocumentLibraryPanel.tsx", [
  "row.downloadUrl",
  "Event",
]);
includes("src/components/dashboard/DocumentSearchPanel.tsx", [
  "groupKind",
  "originUnitId",
  "row.downloadUrl",
]);
includes("src/app/api/catalog-files/[documentKey]/route.ts", [
  "get_catalog_document",
]);

console.log(`\n${checks - failures}/${checks} requested-feature checks passed`);
if (failures > 0) process.exit(1);
