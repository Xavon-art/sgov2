const MAX_RESPONSES = 300;
const MAX_ANSWER_CHARS = 500;
const MAX_CHOICE_SAMPLES = 10;
const OPEN_DELIMITER = "<UNTRUSTED_RESPONDENT_DATA>";
const CLOSE_DELIMITER = "</UNTRUSTED_RESPONDENT_DATA>";
const CHOICE_TYPES = new Set(["multiple_choice", "checkbox", "dropdown"]);

type UnknownRecord = Record<string, unknown>;

type SurveyQuestion = {
  id: string;
  title: string;
  type: string;
  counts: Record<string, number> | null;
};

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asQuestions(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function asResponses(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function answerValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) return value.flatMap(answerValues);
  return [];
}

function cleanLine(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

function plainAnswer(value: string): string {
  return cleanLine(
    value
      .replaceAll(OPEN_DELIMITER, "[delimiter removed]")
      .replaceAll(CLOSE_DELIMITER, "[delimiter removed]"),
  ).slice(0, MAX_ANSWER_CHARS);
}

function readCounts(value: unknown): Record<string, number> | null {
  const record = asRecord(value);
  const entries = Object.entries(record).filter(
    (entry): entry is [string, number] =>
      typeof entry[1] === "number" && Number.isFinite(entry[1]),
  );
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function collectQuestions(
  contextQuestions: UnknownRecord[],
  resultQuestions: UnknownRecord[],
): SurveyQuestion[] {
  const countsById = new Map<string, Record<string, number> | null>();
  for (const question of resultQuestions) {
    countsById.set(asString(question.id), readCounts(question.counts));
  }

  return contextQuestions
    .map((question) => {
      const id = asString(question.id);
      return {
        id,
        title: asString(question.title),
        type: asString(question.type),
        counts: countsById.get(id) ?? null,
      };
    })
    .filter((question) => question.id !== "");
}

function choiceSamples(
  questionId: string,
  responses: UnknownRecord[],
): string[] {
  const seen = new Set<string>();
  const samples: string[] = [];

  for (const response of responses) {
    const answers = asRecord(response.answers);
    for (const value of answerValues(answers[questionId])) {
      const text = cleanLine(value);
      if (text === "" || seen.has(text)) continue;
      seen.add(text);
      samples.push(text);
      if (samples.length >= MAX_CHOICE_SAMPLES) return samples;
    }
  }

  return samples;
}

export function buildSurveyTranscript(args: {
  context: unknown;
  results: unknown;
}): string {
  const context = asRecord(args.context);
  const survey = asRecord(context.survey);
  const contextQuestions = asQuestions(context.questions);
  const results = asRecord(args.results);
  const questions = collectQuestions(
    contextQuestions,
    asQuestions(results.questions),
  );
  const responses = asResponses(context.responses);
  const newest = responses.slice(0, MAX_RESPONSES);
  const total =
    typeof context.totalResponses === "number"
      ? context.totalResponses
      : newest.length;
  const truncated = context.truncated === true || responses.length > MAX_RESPONSES;

  const lines: string[] = [
    `Survey: ${cleanLine(asString(survey.title))}`,
    `Description: ${cleanLine(asString(survey.description)) || "(none)"}`,
    `Responses: ${total}`,
  ];

  if (truncated) {
    lines.push(
      `Truncated to the newest ${MAX_RESPONSES} responses; totals still count every response.`,
    );
  }

  lines.push(OPEN_DELIMITER);

  questions.forEach((question, index) => {
    const heading = `Q${index + 1}. ${cleanLine(question.title) || "(untitled)"} (${question.type || "unknown"})`;
    lines.push(heading);

    if (CHOICE_TYPES.has(question.type)) {
      const counts = question.counts ?? {};
      const countText = Object.entries(counts)
        .map(([label, count]) => `${label}: ${count}`)
        .join("; ");
      lines.push(`Counts: ${countText || "(none)"}`);

      const samples = choiceSamples(question.id, newest).map(
        (sample) => `"${plainAnswer(sample)}"`,
      );
      if (samples.length > 0) {
        lines.push(`Sample answers: ${samples.join("; ")}`);
      }
      return;
    }

    for (const response of newest) {
      const answers = asRecord(response.answers);
      for (const value of answerValues(answers[question.id])) {
        const text = plainAnswer(value);
        if (text !== "") lines.push(`- ${text}`);
      }
    }
  });

  lines.push(CLOSE_DELIMITER);
  return lines.join("\n");
}
