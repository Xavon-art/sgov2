export type DraftKind = "proposal" | "request_letter" | "activity_report" | "resolution";

export type DraftFields = {
  title?: string;
  activityType?: string;
  eventDate?: string;
  venue?: string;
  programName?: string;
  purpose?: string;
  budgetText?: string;
  subject?: string;
  neededOn?: string;
  neededTime?: string;
  narrativeNotes?: string;
  highlights?: string;
  resolutionTitle?: string;
  scope?: string;
};

export type AiMeta = {
  model: string;
  durationMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
};
