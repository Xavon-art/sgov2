import { z } from "zod";

export const MAX_PRECHECK_ITEMS = 20;
export const MAX_ITEM_TEXT = 120_000;
export const MAX_TOTAL_TEXT = 400_000;
export const MAX_IMAGE_DATA_URL = 2 * 1024 * 1024;
export const MAX_BODY_BYTES = 3 * 1024 * 1024;

const issueSchema = z.enum(["unsupported_format", "ocr_pending", "unreadable"]);
const formatSchema = z.enum(["pdf", "docx", "xlsx", "txt", "image", "zip", "other"]);

const precheckItemSchema = z
  .object({
    itemId: z.string().uuid(),
    itemKind: z.enum(["file", "link"]),
    fileName: z.string().max(255).optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
    text: z.string().optional(),
    imageDataUrl: z.string().optional(),
    format: formatSchema.optional(),
    issue: issueSchema.optional(),
    linkUrl: z.string().max(2048).optional(),
  })
  .superRefine((item, ctx) => {
    if (item.itemKind === "link" && !item.linkUrl) {
      ctx.addIssue({
        code: "custom",
        path: ["linkUrl"],
        message: "A link is required for a link requirement.",
      });
    }
  });

export const precheckRequestSchema = z.object({
  proposalId: z.string().uuid().optional(),
  programId: z.string().uuid().optional(),
  context: z.object({
    title: z.string().trim().min(1).max(300),
    eventDate: z.string().max(40).optional(),
    venue: z.string().max(300).optional(),
    unitName: z.string().max(300).optional(),
    programName: z.string().max(300).optional(),
  }),
  items: z.array(precheckItemSchema).min(1).max(MAX_PRECHECK_ITEMS),
});

export type PrecheckRequest = z.infer<typeof precheckRequestSchema>;
export type PrecheckItem = z.infer<typeof precheckItemSchema>;

export type AuthoritativeItem = {
  itemId: string;
  label: string;
  itemKind: "file" | "link" | "any";
};

export type MatchedPrecheckItem = PrecheckItem & { label: string };

export type MatchResult =
  | { ok: true; items: MatchedPrecheckItem[] }
  | { ok: false; message: string };

export function matchAuthoritativeItems(
  requested: PrecheckItem[],
  authoritative: AuthoritativeItem[],
): MatchResult {
  if (requested.length > MAX_PRECHECK_ITEMS) {
    return { ok: false, message: "Too many items." };
  }

  const seen = new Set<string>();
  for (const item of requested) {
    if (seen.has(item.itemId)) {
      return { ok: false, message: "Duplicate item." };
    }
    seen.add(item.itemId);
  }

  const byId = new Map(authoritative.map((item) => [item.itemId, item]));
  const matched: MatchedPrecheckItem[] = [];

  for (const item of requested) {
    const source = byId.get(item.itemId);
    if (!source) {
      return { ok: false, message: "Unknown requirement item." };
    }
    if (source.itemKind !== "any" && source.itemKind !== item.itemKind) {
      return { ok: false, message: "Requirement kind mismatch." };
    }
    matched.push({
      ...item,
      label: source.label,
      itemKind: item.itemKind,
    });
  }

  return { ok: true, items: matched };
}

const IMAGE_PREFIX = /^data:image\/(?:jpeg|png|webp);base64,/i;

export function validatePrecheckLimits(
  body: PrecheckRequest,
  bodyBytes: number,
): { ok: true } | { ok: false; message: string } {
  if (bodyBytes > MAX_BODY_BYTES) {
    return { ok: false, message: "The pre-check request exceeds the 3 MB body limit." };
  }

  let totalText = 0;
  for (const item of body.items) {
    if (item.text !== undefined) {
      if (item.text.length > MAX_ITEM_TEXT) {
        return {
          ok: false,
          message: "One item exceeds the 120,000 character text limit.",
        };
      }
      totalText += item.text.length;
      if (totalText > MAX_TOTAL_TEXT) {
        return {
          ok: false,
          message: "The request exceeds the 400,000 character total text limit.",
        };
      }
    }

    if (item.imageDataUrl !== undefined) {
      if (!IMAGE_PREFIX.test(item.imageDataUrl)) {
        return { ok: false, message: "Images must be JPEG, PNG, or WebP." };
      }
      if (item.imageDataUrl.length > MAX_IMAGE_DATA_URL) {
        return { ok: false, message: "One image exceeds the 2 MB image limit." };
      }
    }
  }

  return { ok: true };
}
