import { afinn165 } from "afinn-165";
import type { PreflightReport } from "@/lib/compliance/types";
import type { AiAdvice, DraftResponse, SurveySummary } from "./schemas";
import type { DraftFields, DraftKind } from "./types";

export const ASSISTANT_MODEL = "SmartGov Assistant 1.0";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function asArray(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function known(value: string): string {
  return value === "" ? "[TBD]" : value;
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function shortQuote(value: string): string {
  const words = text(value).split(" ").filter(Boolean);
  return clip(
    words.slice(0, 18).join(" ") + (words.length > 18 ? "…" : ""),
    240,
  );
}

function pause(value: string): Promise<void> {
  const ms = Math.min(900, 180 + Math.floor(value.length / 12));
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitList(value: string): string[] {
  return value
    .split(/[\n;,]+/)
    .map((part) => part.replace(/^[\s\-•]+/, "").trim())
    .filter((part) => part.length >= 3);
}

function draftHighlights(fields: DraftFields): string[] {
  const raw = [
    ...splitList(text(fields.highlights)),
    ...splitList(text(fields.purpose)),
    text(fields.title),
    text(fields.resolutionTitle),
    text(fields.budgetText),
  ];
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const value = clip(item, 240);
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
    if (unique.length >= 8) break;
  }
  if (unique.length === 0) {
    unique.push("Draft prepared for review", "Missing details are marked [TBD]");
  }
  return unique;
}

export async function localDraft(args: {
  kind: DraftKind;
  fields: DraftFields;
  account: { displayName?: string | null; universityName?: string | null; campusName?: string | null };
}): Promise<DraftResponse> {
  const f = args.fields;
  const university = known(text(args.account.universityName));
  const campus = known(text(args.account.campusName));
  const preparer = known(text(args.account.displayName));
  const title = known(text(f.title) || text(f.resolutionTitle));
  const purpose = known(text(f.purpose));
  const venue = known(text(f.venue));
  const eventDate = known(text(f.eventDate));
  const program = known(text(f.programName));
  const budget = known(text(f.budgetText));

  let draft = "";

  if (args.kind === "proposal") {
    draft = [
      `PROPOSAL: ${title}`,
      "",
      "Background",
      `${university}, through ${campus}, respectfully submits this proposal for ${title}. ${purpose}`,
      "",
      "Objectives",
      `- Confirm the scope and deliverables for ${title}.`,
      `- Secure the necessary approvals and support from the responsible university units.`,
      `- Report completion and outcomes through the student government records.`,
      "",
      "Activity Details",
      `Program: ${program}`,
      `Date: ${eventDate}`,
      `Venue: ${venue}`,
      "",
      "Budget Narrative",
      budget,
      "",
      "Expected Outcomes",
      `The activity is expected to produce documented participation, a clear activity report, and an auditable record of funds use for ${title}.`,
      "",
      `Prepared by: ${preparer}`,
    ].join("\n");
  } else if (args.kind === "request_letter") {
    const subject = known(text(f.subject) || text(f.title));
    const neededOn = known(text(f.neededOn));
    const neededTime = known(text(f.neededTime));
    draft = [
      new Date().toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" }),
      "",
      "Office of the Student Government",
      university,
      campus,
      "",
      `Subject: ${subject}`,
      "",
      "Dear Sir/Madam,",
      "",
      `On behalf of ${campus}, I am writing to request support for ${subject}. ${purpose} The request is needed on ${neededOn}${neededTime === "[TBD]" ? "" : ` at ${neededTime}`}.`,
      "",
      `We respectfully ask for the appropriate endorsement and for guidance on the requirements that apply to ${subject}. Supporting details are available in the attached documents, and we remain ready to provide any further information needed for review.`,
      "",
      "Thank you for your consideration.",
      "",
      "Sincerely,",
      preparer,
    ].join("\n");
  } else if (args.kind === "activity_report") {
    const activity = known(text(f.activityType) || text(f.title));
    const notes = known(text(f.narrativeNotes) || text(f.purpose));
    const highlights = draftHighlights(f);
    draft = [
      "ACTIVITY REPORT",
      "",
      `Activity: ${activity}`,
      `Date: ${eventDate}`,
      `Venue: ${venue}`,
      `Program: ${program}`,
      "",
      "Narrative",
      `${notes} The activity was carried out under ${campus} and documented through the student government workspace for reporting and review.`,
      "",
      "Highlights",
      ...highlights.slice(0, 5).map((item) => `- ${item}`),
      "",
      "Outcomes",
      `The activity produced a complete report record for ${activity}, including attendance documentation and the supporting files needed for verification.`,
      "",
      "Recommendations",
      `- Retain the documented outcomes with the activity record.`,
      `- Use the reported highlights in the next planning cycle for ${program}.`,
      "",
      `Prepared by: ${preparer}`,
    ].join("\n");
  } else {
    const resolutionTitle = known(text(f.resolutionTitle) || text(f.title));
    const scope = known(text(f.scope));
    draft = [
      `RESOLUTION: ${resolutionTitle}`,
      "",
      `WHEREAS, ${university}, through ${campus}, recognizes the need to act on ${resolutionTitle};`,
      `WHEREAS, the proposed scope covers ${scope};`,
      `WHEREAS, the matter was reviewed in light of the submitted supporting documents and the stated purpose, ${purpose};`,
      "",
      "NOW, THEREFORE, BE IT RESOLVED that the student government supports the approval and implementation of the activity described in this resolution;",
      "",
      "BE IT FURTHER RESOLVED that the responsible unit shall submit the required documentation, observe the applicable university rules, and report the results through the established student government process;",
      "",
      "BE IT FINALLY RESOLVED that copies of this resolution be furnished to the offices and units concerned for their information and appropriate action.",
      "",
      `Adopted on ${eventDate}.`,
      "",
      `Prepared by: ${preparer}`,
    ].join("\n");
  }

  await pause(draft);
  return {
    draft: clip(draft, 20_000),
    highlights: args.kind === "activity_report" ? draftHighlights(f) : [],
  };
}

const THEME_RULES: Array<{ label: string; words: string[] }> = [
  { label: "Schedule and timing", words: ["late", "delay", "schedule", "timing", "on time", "fast", "slow"] },
  { label: "Venue and facilities", words: ["venue", "room", "facility", "facilities", "space", "seat", "clean"] },
  { label: "Communication", words: ["communicate", "communication", "update", "inform", "clear", "confusing", "announcement"] },
  { label: "Support and assistance", words: ["support", "help", "helpful", "assist", "staff", "officer"] },
  { label: "Food and refreshments", words: ["food", "meal", "snack", "refreshment"] },
  { label: "Cost and value", words: ["cost", "price", "expensive", "affordable", "fee", "budget"] },
  { label: "Content and clarity", words: ["content", "topic", "speaker", "interesting", "useful", "boring"] },
];

const POSITIVE_PHRASES = ["on time", "well organized", "highly recommend"];
const NEGATIVE_PHRASES = ["not clear", "too crowded", "never again"];

function scoreSentiment(value: string): { score: number; positive: number; negative: number } {
  const words = text(value).toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
  let score = 0;
  let positive = 0;
  let negative = 0;
  for (const word of words) {
    const valence = afinn165[word] ?? 0;
    score += valence;
    if (valence > 0) positive += 1;
    if (valence < 0) negative += 1;
  }
  const lower = text(value).toLowerCase();
  if (POSITIVE_PHRASES.some((phrase) => lower.includes(phrase))) {
    score += 2;
    positive += 1;
  }
  if (NEGATIVE_PHRASES.some((phrase) => lower.includes(phrase))) {
    score -= 2;
    negative += 1;
  }
  return { score, positive, negative };
}

function sentimentCounts(values: string[]): { positive: number; negative: number; mixed: number; neutral: number } {
  const counts = { positive: 0, negative: 0, mixed: 0, neutral: 0 };
  for (const value of values) {
    const scored = scoreSentiment(value);
    if (scored.positive > 0 && scored.negative > 0) counts.mixed += 1;
    else if (scored.score > 0) counts.positive += 1;
    else if (scored.score < 0) counts.negative += 1;
    else counts.neutral += 1;
  }
  return counts;
}

function answerStrings(value: unknown): string[] {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const valueText = text(String(value));
    return valueText === "" ? [] : [valueText];
  }
  if (Array.isArray(value)) return value.flatMap(answerStrings);
  return [];
}

function collectAnswerTexts(context: UnknownRecord, results: UnknownRecord): string[] {
  const questions = asArray(context.questions).map(asRecord);
  const responses = asArray(context.responses).map(asRecord).slice(0, 300);
  const resultCounts = new Map<string, UnknownRecord>();
  for (const question of asArray(results.questions)) {
    resultCounts.set(text(question.id), asRecord(question.counts));
  }

  const texts: string[] = [];
  for (const question of questions) {
    const id = text(question.id);
    const type = text(question.type);
    if (["multiple_choice", "checkbox", "dropdown"].includes(type)) {
      const counts = resultCounts.get(id) ?? {};
      for (const [label, count] of Object.entries(counts)) {
        if (typeof count === "number" && count > 0 && text(label) !== "") {
          texts.push(`${label} (${count})`);
        }
      }
      for (const response of responses) {
        const answers = asRecord(response.answers);
        for (const sample of answerStrings(answers[id]).slice(0, 2)) texts.push(sample);
      }
      continue;
    }

    for (const response of responses) {
      const answers = asRecord(response.answers);
      for (const answer of answerStrings(answers[id])) texts.push(answer);
    }
  }
  return texts;
}

function percentage(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((count / total) * 100)));
}

export async function localSurveySummary(args: {
  context: unknown;
  results: unknown;
  totalResponses: number;
  truncated: boolean;
}): Promise<SurveySummary> {
  const context = asRecord(args.context);
  const results = asRecord(args.results);
  const title = text(asRecord(context.survey).title) || "this survey";
  const answerTexts = collectAnswerTexts(context, results);
  const haystack = answerTexts.map((value) => value.toLowerCase());
  const total = Math.max(1, haystack.length);

  const themeRows = THEME_RULES.map((rule) => {
    const evidence = answerTexts.find((value) =>
      rule.words.some((word) => value.toLowerCase().includes(word)),
    );
    const mentions = haystack.filter((value) =>
      rule.words.some((word) => value.includes(word)),
    ).length;
    return { label: rule.label, mentions, evidence: evidence ? shortQuote(evidence) : "" };
  })
    .filter((row) => row.mentions > 0)
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 6);

  const sentiment = sentimentCounts(answerTexts);
  const positivePercent = percentage(sentiment.positive, total);
  const negativePercent = percentage(sentiment.negative, total);
  const mixedPercent = percentage(sentiment.mixed, total);
  const neutralPercent = Math.max(0, 100 - positivePercent - negativePercent - mixedPercent);

  const topThemes = themeRows.slice(0, 3).map((row) => row.label.toLowerCase());
  const themeText = topThemes.length > 0 ? topThemes.join(", ") : "the overall experience";
  const overview = [
    `Across ${args.totalResponses} response${args.totalResponses === 1 ? "" : "s"} to "${clip(title, 120)}", the recurring discussion centers on ${themeText}.`,
    `Positive wording appears in about ${positivePercent}% of the analysed answers and negative wording in about ${negativePercent}%.`,
    args.truncated
      ? "Only the newest written answers were analysed; the totals still cover every response."
      : "All available written answers were considered.",
  ].join(" ");

  const highlights = themeRows.slice(0, 4).map((row) =>
    clip(
      row.evidence === ""
        ? `${row.label} was mentioned in ${row.mentions} response(s).`
        : `${row.label}: ${row.evidence}`,
      240,
    ),
  );
  if (highlights.length === 0) {
    highlights.push(`Respondents commented on ${themeText}.`);
  }

  const complaints = themeRows
    .filter((row) => ["Schedule and timing", "Cost and value", "Venue and facilities"].includes(row.label))
    .slice(0, 3)
    .map((row) => clip(`Some responses raised ${row.label.toLowerCase()} concerns.`, 240));
  if (complaints.length === 0) {
    complaints.push("A few responses identified areas that could be improved.");
  }

  const suggestions = themeRows.slice(0, 3).map((row) =>
    clip(`Clarify ${row.label.toLowerCase()} in future announcements and implementation.`, 240),
  );
  if (suggestions.length === 0) {
    suggestions.push("Keep the process clear and publish updates before the next activity.");
  }

  const caveats = args.truncated
    ? "Only the newest 300 written responses were analysed; totals still include every response."
    : "Themes group recurring wording, so short answers may not show each respondent's full context.";

  await pause(overview + highlights.join(""));
  return {
    overview: clip(overview, 1200),
    sentiment: {
      positive: positivePercent,
      neutral: neutralPercent,
      negative: negativePercent,
      mixed: mixedPercent,
    },
    highlights: highlights.slice(0, 8),
    complaints: complaints.slice(0, 8),
    suggestions: suggestions.slice(0, 8),
    themes: themeRows.map((row) => ({
      label: clip(row.label, 80),
      mentions: row.mentions,
      evidence: clip(row.evidence, 240),
    })),
    caveats: clip(caveats, 400),
  };
}

export async function localAdvice(args: {
  report: PreflightReport;
  context: unknown;
}): Promise<AiAdvice> {
  const { summary, items } = args.report;
  const title = text(asRecord(args.context).title) || "this submission";
  const attention = items.filter((item) =>
    ["missing", "unreadable", "suspect"].includes(item.status),
  );
  const labels = attention.slice(0, 3).map((item) => text(item.label) || "an item");
  const focus = labels.length > 0 ? labels.join(", ") : "the submitted items";

  const paragraph = [
    `The pre-check reviewed ${summary.items} requirement item${summary.items === 1 ? "" : "s"} for "${clip(title, 120)}".`,
    `${summary.ok} are ready, ${summary.missing} are missing, ${summary.unreadable} are unreadable, and ${summary.suspect} need a closer look.`,
    `Attention is concentrated on ${focus}. Resolve those points before the reviewer pass; the attached files remain the authority.`,
  ].join(" ");

  const fixes = attention.slice(0, 5).map((item) =>
    clip(
      text(item.recommendation) || `Review ${text(item.label) || "the item"} and attach a readable copy.`,
      240,
    ),
  );
  if (fixes.length === 0) {
    fixes.push("Keep the submitted files readable and aligned with each requirement item.");
  }

  await pause(paragraph + fixes.join(""));
  return { paragraph: clip(paragraph, 1200), fixes: fixes.slice(0, 5) };
}
