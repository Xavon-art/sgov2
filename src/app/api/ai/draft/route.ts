import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { currentAccount, readSessionToken } from "@/lib/auth/session";
import { generateJson } from "@/lib/ai/client";
import { isAiConfigured } from "@/lib/ai/config";
import { AiError } from "@/lib/ai/errors";
import { reasonForAiError, statusForAiError } from "@/lib/ai/http";
import { buildDraftPrompt } from "@/lib/ai/prompts";
import { draftRequestSchema, draftResponseSchema } from "@/lib/ai/schemas";
import type { DraftFields } from "@/lib/ai/types";

export const runtime = "nodejs";

const MAX_FIELD_CHARS = 2_000;

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "rate_limited") return 429;
  if (reason === "forbidden") return 403;
  if (reason === "not_found") return 404;
  return 400;
}

function aiMessage(code: string): string {
  if (code === "ai_not_configured") return "AI is not configured.";
  if (code === "ai_timeout") return "The AI request timed out.";
  if (code === "ai_invalid_output") return "The AI returned an unusable draft.";
  return "The AI service is unavailable.";
}

function clipFields(fields: DraftFields): DraftFields {
  const clipped: DraftFields = {};
  for (const key of Object.keys(fields) as Array<keyof DraftFields>) {
    const value = fields[key];
    if (typeof value === "string") clipped[key] = value.slice(0, MAX_FIELD_CHARS);
  }
  return clipped;
}

export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json(
      { ok: false, message: "Sign in to continue." },
      { status: 401 },
    );
  }

  const account = await currentAccount();
  if (!account) {
    return NextResponse.json(
      { ok: false, message: "Sign in to continue." },
      { status: 401 },
    );
  }

  if (!isAiConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        message: aiMessage("ai_not_configured"),
        reason: "ai_not_configured",
      },
      { status: 503 },
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: messageFor("invalid_request") },
      { status: 400 },
    );
  }

  const validation = draftRequestSchema.safeParse(parsedBody);
  if (!validation.success) {
    return NextResponse.json(
      { ok: false, message: messageFor("invalid_request") },
      { status: 400 },
    );
  }

  const kind = validation.data.kind;
  const fields = clipFields(validation.data.fields as DraftFields);

  try {
    const quota = await callRpc<RpcResult>("consume_ai_quota", {
      p_session_token: token,
      p_kind: "draft",
    });
    if (!quota.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(quota.reason), reason: quota.reason },
        { status: statusForReason(quota.reason) },
      );
    }

    const prompt = buildDraftPrompt({
      kind,
      fields,
      account: {
        displayName: account.displayName,
        universityName: account.universityName,
        campusName: account.campusName,
      },
    });

    const generated = await generateJson({
      system: prompt.system,
      user: prompt.user,
      temperature: 0.4,
      schema: draftResponseSchema,
      kind: "draft",
    });

    return NextResponse.json({
      ok: true,
      draft: generated.value.draft,
      highlights: generated.value.highlights,
      model: generated.meta.model,
    });
  } catch (error) {
    if (error instanceof AiError) {
      const code = reasonForAiError(error.code);
      console.error("[ai:draft]", code);
      return NextResponse.json(
        { ok: false, message: aiMessage(code), reason: code },
        { status: statusForAiError(error.code) },
      );
    }

    console.error("[ai:draft]", error);
    return NextResponse.json(
      { ok: false, message: messageFor("retry") },
      { status: 503 },
    );
  }
}
