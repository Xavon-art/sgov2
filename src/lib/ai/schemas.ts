import { z } from "zod";
import type { DraftFields, DraftKind } from "./types";

const shortText = z.string().min(3).max(240);

export const surveySummarySchema = z
  .object({
    overview: z.string().min(20).max(1200),
    sentiment: z
      .object({
        positive: z.number().int().min(0).max(100),
        neutral: z.number().int().min(0).max(100),
        negative: z.number().int().min(0).max(100),
        mixed: z.number().int().min(0).max(100),
      })
      .strict(),
    highlights: z.array(shortText).max(8),
    complaints: z.array(shortText).max(8),
    suggestions: z.array(shortText).max(8),
    themes: z
      .array(
        z
          .object({
            label: z.string().min(3).max(80),
            mentions: z.number().int().min(0),
            evidence: z.string().max(240),
          })
          .strict(),
      )
      .max(10),
    caveats: z.string().max(400),
  })
  .strict();

export const adviceSchema = z
  .object({
    paragraph: z.string().min(20).max(1200),
    fixes: z.array(shortText).max(5),
  })
  .strict();

export const draftResponseSchema = z
  .object({
    draft: z.string().min(20).max(20_000),
    highlights: z.array(shortText).max(8).default([]),
  })
  .strict();

const optionalField = z.preprocess(
  (value) => (typeof value === "string" ? value : undefined),
  z.string().optional(),
);

const draftFieldsSchema = z.object({
  title: optionalField,
  activityType: optionalField,
  eventDate: optionalField,
  venue: optionalField,
  programName: optionalField,
  purpose: optionalField,
  budgetText: optionalField,
  subject: optionalField,
  neededOn: optionalField,
  neededTime: optionalField,
  narrativeNotes: optionalField,
  highlights: optionalField,
  resolutionTitle: optionalField,
  scope: optionalField,
});

export const draftRequestSchema = z.object({
  kind: z.enum(["proposal", "request_letter", "activity_report", "resolution"]),
  fields: draftFieldsSchema,
});

export type SurveySummary = z.infer<typeof surveySummarySchema>;
export type AiAdvice = z.infer<typeof adviceSchema>;
export type DraftResponse = z.infer<typeof draftResponseSchema>;
export type DraftRequest = {
  kind: DraftKind;
  fields: DraftFields;
};
