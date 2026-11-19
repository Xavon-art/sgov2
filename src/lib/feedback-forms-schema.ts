import { z } from "zod";

export const feedbackScopeSchema = z.enum([
  "university",
  "unit_type",
  "units",
  "unit",
]);

export const feedbackAccessSchema = z.enum(["signed_in", "public_link"]);

export const feedbackIdentitySchema = z.enum(["identified", "anonymous"]);

export const feedbackStatusSchema = z.enum(["draft", "open", "closed"]);

export const feedbackQtypeSchema = z.enum([
  "short_text",
  "long_text",
  "multiple_choice",
  "checkbox",
  "dropdown",
  "rating",
  "linear_scale",
  "date",
  "time",
]);

export const feedbackFieldKeySchema = z.enum([
  "full_name",
  "email",
  "student_number",
  "year_level",
  "program",
  "section",
  "campus",
]);

export const feedbackQuestionInputSchema = z.object({
  qtype: feedbackQtypeSchema,
  fieldKey: feedbackFieldKeySchema.nullable().default(null),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullable().default(null),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  scaleMin: z.number().int().min(1).max(10).nullable().default(null),
  scaleMax: z.number().int().min(1).max(10).nullable().default(null),
  scaleLabelLow: z.string().trim().max(80).nullable().default(null),
  scaleLabelHigh: z.string().trim().max(80).nullable().default(null),
});

export const feedbackFormInputSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(4000).nullable().default(null),
  scope: feedbackScopeSchema,
  unitIds: z.array(z.string().uuid()).default([]),
  unitTypes: z.array(z.string().trim().min(1).max(40)).default([]),
  accessMode: feedbackAccessSchema,
  identityMode: feedbackIdentitySchema,
});

export const feedbackQuestionsSchema = z.object({
  questions: z.array(feedbackQuestionInputSchema).max(50),
});

export const feedbackStatusInputSchema = z.object({
  status: z.enum(["open", "closed"]),
});

export const feedbackAnswersSchema = z.record(z.string(), z.unknown());

export const feedbackSubmissionSchema = z.object({
  answers: feedbackAnswersSchema,
  respondentName: z.string().trim().max(120).nullable().default(null),
  respondentEmail: z.string().trim().max(200).nullable().default(null),
});

export type FeedbackFormInput = z.infer<typeof feedbackFormInputSchema>;
export type FeedbackQuestionInput = z.infer<typeof feedbackQuestionInputSchema>;
export type FeedbackSubmissionInput = z.infer<typeof feedbackSubmissionSchema>;
