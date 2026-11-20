/**
 * Deterministic probe for the compliance engine. Not a test framework -- it is a
 * typed, self-checking harness that fails the process when a claim about the
 * engine's behaviour stops being true.
 *
 * Run: `npx tsx scripts/check-compliance.ts`
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runComplianceCheck, runPreflightCheck } from "../src/lib/compliance/engine";
import type { EngineInput } from "../src/lib/compliance/engine";
import type { PreflightInput } from "../src/lib/compliance/types";
import { emptyStatusCounts, monitoringCsv } from "../src/lib/monitoring";
import type { MonitoringPayload } from "../src/lib/monitoring";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name: string) => readFileSync(join(here, "fixtures", name));

const input: EngineInput = {
  proposalId: "proposal-demo",
  versionId: "version-demo",
  context: {
    title: "Computer Studies Council Color Run",
    eventDate: "2026-10-08",
    venue: "Main Campus Oval",
    unitName: "Computer Studies Council",
    programName: "Color Run 2026",
    submittedBy: "unit.admin",
  },
  items: [
    {
      itemId: "item-letter",
      label: "Letter of Intent",
      itemKind: "file",
      submission: {
        submissionId: "sub-letter",
        submissionKind: "file",
        originalName: "letter.pdf",
        sizeBytes: fx("letter.pdf").length,
      },
      buffer: fx("letter.pdf"),
    },
    {
      itemId: "item-flow",
      label: "Program Flow",
      itemKind: "file",
      submission: {
        submissionId: "sub-flow",
        submissionKind: "file",
        originalName: "letter.docx",
        sizeBytes: fx("letter.docx").length,
      },
      buffer: fx("letter.docx"),
    },
    {
      itemId: "item-budget",
      label: "Financial Statement / Budget Breakdown",
      itemKind: "file",
      submission: {
        submissionId: "sub-budget",
        submissionKind: "file",
        originalName: "budget.xlsx",
        sizeBytes: fx("budget.xlsx").length,
      },
      buffer: fx("budget.xlsx"),
    },
    {
      itemId: "item-attendance",
      label: "Attendance Sheet",
      itemKind: "file",
      submission: {
        submissionId: "sub-attendance",
        submissionKind: "file",
        originalName: "placeholder.txt",
        sizeBytes: fx("placeholder.txt").length,
      },
      buffer: fx("placeholder.txt"),
    },
    {
      itemId: "item-endorsement",
      label: "Proposal Endorsement",
      itemKind: "file",
      submission: {
        submissionId: "sub-endorsement",
        submissionKind: "file",
        originalName: "blank.txt",
        sizeBytes: fx("blank.txt").length,
      },
      buffer: fx("blank.txt"),
    },
    {
      itemId: "item-photo",
      label: "Venue Photo",
      itemKind: "link",
      submission: {
        submissionId: "sub-photo",
        submissionKind: "link",
        linkUrl: "https://photos.example.com/oval.jpg",
      },
    },
    {
      itemId: "item-waiver",
      label: "Parent Waiver",
      itemKind: "file",
    },
  ],
};

const preflight: PreflightInput = {
  context: input.context,
  items: [
    {
      itemId: "pf-letter",
      label: "Letter of Intent",
      itemKind: "file",
      fileName: "letter.txt",
      sizeBytes: 420,
      format: "txt",
      text:
        "LETTER OF INTENT\nOctober 8, 2026\n\nThe Computer Studies Council respectfully submits this letter of intent for the Color Run 2026 program at the Main Campus Oval. The activity will bring students and faculty together for a community wellness event with registration, opening remarks, a monitored route, and a closing program. We request the approval of the Office of Student Affairs so the council can proceed with logistics and participant coordination.",
    },
    {
      itemId: "pf-placeholder",
      label: "Program Flow",
      itemKind: "file",
      fileName: "flow.txt",
      sizeBytes: 240,
      format: "txt",
      text:
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. TODO: replace this sample schedule with the final program flow, including registration, opening remarks, the run itself, and the closing ceremony. This placeholder text is only for checking.",
    },
    {
      itemId: "pf-missing",
      label: "Parent Waiver",
      itemKind: "file",
    },
    {
      itemId: "pf-image",
      label: "Venue Photo",
      itemKind: "file",
      fileName: "oval.jpg",
      sizeBytes: 900,
      format: "image",
      text: "",
      issue: "ocr_pending",
    },
    {
      itemId: "pf-link",
      label: "Photo Album",
      itemKind: "link",
      linkUrl: "https://example.com/album",
    },
  ],
};

const failures: string[] = [];
function check(name: string, ok: boolean, detail?: unknown) {
  const line = `${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` -- ${detail ?? ""}`}`;
  console.log(line);
  if (!ok) failures.push(name);
}

async function main() {
  const started = performance.now();
  const report = await runComplianceCheck(input);
  const elapsed = performance.now() - started;
console.log(`\nengine finished in ${elapsed.toFixed(0)}ms (report.durationMs=${report.durationMs})`);

check("report.ok is true", report.ok === true);
check("report.scope is \"app\"", report.scope === "app");
check("report.schemaVersion === 1", report.schemaVersion === 1);
check("report.note explains the determinism", typeof report.note === "string" && report.note.length > 40);

const byLabel = new Map(report.items.map((it) => [it.label, it]));

// -- Subsumption: the one item without a submission is missing, all others present.
const letter = byLabel.get("Letter of Intent")!;
const flow = byLabel.get("Program Flow")!;
const budget = byLabel.get("Financial Statement / Budget Breakdown")!;
const attendance = byLabel.get("Attendance Sheet")!;
const endorsement = byLabel.get("Proposal Endorsement")!;
const photo = byLabel.get("Venue Photo")!;
const waiver = byLabel.get("Parent Waiver")!;

check("one missing item in summary", report.summary.missing === 1 && report.summary.items === 7);
check("missing item is the waived one", waiver.status === "missing" && waiver.recommendation.length > 10);

// -- Extracted content by format.
check("letter.pdf extracted as pdf", letter.extracted?.format === "pdf");
check("letter.pdf mentions LETTER OF INTENT", (letter.extracted?.preview ?? "").toUpperCase().includes("LETTER OF INTENT"));
check("flow.docx extracted as docx", flow.extracted?.format === "docx");
check("flow.docx kept the schedule words", (flow.extracted?.preview ?? "").includes("schedule"));
check("budget.xlsx extracted as xlsx", budget.extracted?.format === "xlsx");
check("budget.xlsx kept amount figures", (budget.extracted?.preview ?? "").includes("7500"));

// -- Facts.
check("letter has a date fact", letter.facts.some((f) => f.kind === "date"));
check("letter has a reference fact", letter.facts.some((f) => f.kind === "reference"));
check("budget has an amount fact", budget.facts.some((f) => f.kind === "amount"));

// -- Matching: a letter intent matches its own item best; budget beats letter for its own too.
check("letter matches itself best", letter.match.bestItemId === "item-letter" && letter.match.ownScore > 0.25);
check("budget matches itself best", budget.match.bestItemId === "item-budget" && budget.match.ownScore > 0.3);

// -- Statuses.
check("letter is ok", letter.status === "ok");
check("flow is ok", flow.status === "ok");
check("budget is ok or suspect (never unreadable)", budget.status !== "unreadable");
check("placeholder attendance is suspect", attendance.status === "suspect");
check("placeholder flags placeholder_language", attendance.signals.some((s) => s.code === "placeholder_language"));
check("blank endorsement is unreadable", endorsement.status === "unreadable");
check("blank flags empty/very_short", endorsement.signals.some((s) => s.code === "empty_document" || s.code === "very_short"));
check("link item is ok with a recommendation", photo.status === "ok" && photo.recommendation.length > 5);

// -- Recommendations always present and actionable (no empty string).
for (const item of report.items) {
  if (item.recommendation.length < 5) {
    check(`recommendation for "${item.label}"`, false, item.recommendation);
  }
}
check("every item carries an actionable recommendation",
  report.items.every((it) => it.recommendation.length >= 5));

const csvEmpty = emptyStatusCounts();
const csvPayload: MonitoringPayload = {
  ok: true,
  totals: { ...csvEmpty },
  campuses: [
    {
      unitId: "unit-1",
      unitName: "=SUM(1+1)",
      totals: { ...csvEmpty },
      modules: [{ key: "documents", label: "+CMD", total: 1, statuses: { ...csvEmpty, pending: 1 } }],
    },
    {
      unitId: "unit-2",
      unitName: "@SUM(A1)",
      totals: { ...csvEmpty },
      modules: [{ key: "tasks", label: "-CMD", total: 1, statuses: { ...csvEmpty, pending: 1 } }],
    },
  ],
};
const csv = monitoringCsv(csvPayload);
check(
  "CSV export neutralizes leading spreadsheet formulas",
  csv.includes("'=SUM(1+1)") &&
    csv.includes("'+CMD") &&
    csv.includes("'@SUM(A1)") &&
    csv.includes("'-CMD") &&
    !csv.split("\r\n").some((row) => /^[=+@-]/.test(row)),
  csv,
);

// -- Timing: the heavy path (three parsed office documents) stays under 5s cold.
check("runs fast (cold, < 5000ms)", report.durationMs < 5000);

const preflightReport = await runPreflightCheck(preflight);
const pf = new Map(preflightReport.items.map((it) => [it.itemId, it]));

check("preflight uses the preflight scope", preflightReport.scope === "preflight");
check("preflight has no proposal or version id", !("proposalId" in preflightReport) && !("versionId" in preflightReport));
check("preflight summary counts every item", preflightReport.summary.items === 5 && preflightReport.summary.missing === 1);
check("preflight real letter is ok", pf.get("pf-letter")?.status === "ok");
check("preflight placeholder text is suspect", pf.get("pf-placeholder")?.status === "suspect");
check("preflight placeholder flags placeholder_language", pf.get("pf-placeholder")?.signals.some((s) => s.code === "placeholder_language") === true);
check("preflight absent file is missing", pf.get("pf-missing")?.status === "missing");
check("preflight image with OCR pending is unreadable", pf.get("pf-image")?.status === "unreadable");
check("preflight link is ok", pf.get("pf-link")?.status === "ok");
check("preflight avoids full file extraction when supplied text exists", preflightReport.durationMs < 1000);

console.log("\n" + "=".repeat(46));
  if (failures.length === 0) {
    console.log(`ALL PASS  (${report.items.length} items in ${elapsed.toFixed(0)}ms)`);
    process.exit(0);
  }
  console.log(`FAILED: ${failures.join(", ")}`);
  process.exit(1);
}

main().catch((error) => {
  console.error("check-compliance crashed:", error);
  process.exit(1);
});