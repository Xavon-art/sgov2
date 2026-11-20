import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { generateJson } from "@/lib/ai/client";
import { isAiConfigured } from "@/lib/ai/config";
import { AiError } from "@/lib/ai/errors";
import { reasonForAiError, statusForAiError } from "@/lib/ai/http";
import { buildSummaryPrompt } from "@/lib/ai/prompts";
import { surveySummarySchema } from "@/lib/ai/schemas";
import { buildSurveyTranscript } from "@/lib/ai/survey-summary";

export const runtime = "nodejs";

type SummaryRow = RpcResult & {
  summary?: unknown;
  responseCount?: number;
  generatedAt?: string;
  model?: string;
};

type ContextRow = RpcResult & {
  survey?: unknown;
  questions?: unknown;
  responses?: unknown;
  totalResponses?: number;
  truncated?: boolean;
};

type ResultsRow = RpcResult & {
  totalResponses?: number;
  questions?: unknown;
};

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
  if (code === "ai_invalid_output") return "The AI returned an unusable summary.";
  return "The AI service is unavailable.";
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json(
      { ok: false, message: "Sign in to continue." },
      { status: 401 },
    );
  }

  const { id } = await ctx.params;
  try {
    const cached = await callRpc<SummaryRow>("get_survey_ai_summary", {
      p_session_token: token,
      p_survey_id: id,
    });
    if (!cached.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(cached.reason), reason: cached.reason },
        { status: statusForReason(cached.reason) },
      );
    }

    if (cached.summary == null) {
      return NextResponse.json({ ok: true, summary: null });
    }

    return NextResponse.json({
      ok: true,
      summary: cached.summary,
      responseCount: cached.responseCount ?? 0,
      generatedAt: cached.generatedAt ?? null,
      model: cached.model ?? null,
    });
  } catch (error) {
    console.error("[surveys:ai-summary:get]", error);
    return NextResponse.json(
      { ok: false, message: messageFor("retry") },
      { status: 503 },
    );
  }
}

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const token = await readSessionToken();
  if (!token) {
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

  const { id } = await ctx.params;

  try {
    const quota = await callRpc<RpcResult>("consume_ai_quota", {
      p_session_token: token,
      p_kind: "summary",
    });
    if (!quota.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(quota.reason), reason: quota.reason },
        { status: statusForReason(quota.reason) },
      );
    }

    const context = await callRpc<ContextRow>("survey_ai_context", {
      p_session_token: token,
      p_survey_id: id,
    });
    if (!context.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(context.reason), reason: context.reason },
        { status: statusForReason(context.reason) },
      );
    }

    const results = await callRpc<ResultsRow>("survey_results", {
      p_session_token: token,
      p_survey_id: id,
    });
    if (!results.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(results.reason), reason: results.reason },
        { status: statusForReason(results.reason) },
      );
    }

    const totalResponses = results.totalResponses ?? 0;
    if (totalResponses === 0) {
      return NextResponse.json(
        { ok: false, message: "No responses to summarize yet." },
        { status: 400 },
      );
    }

    const transcript = buildSurveyTranscript({ context, results });
    const prompt = buildSummaryPrompt({
      transcript,
      truncated: context.truncated === true,
    });
    const generated = await generateJson({
      system: prompt.system,
      user: prompt.user,
      temperature: 0.2,
      schema: surveySummarySchema,
      kind: "summary",
    });

    const saved = await callRpc<RpcResult>("set_survey_ai_summary", {
      p_session_token: token,
      p_survey_id: id,
      p_summary: generated.value,
      p_response_count: totalResponses,
      p_model: generated.meta.model,
    });
    if (!saved.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(saved.reason), reason: saved.reason },
        { status: statusForReason(saved.reason) },
      );
    }

    return NextResponse.json({
      ok: true,
      summary: generated.value,
      responseCount: totalResponses,
      generatedAt: new Date().toISOString(),
      model: generated.meta.model,
    });
  } catch (error) {
    if (error instanceof AiError) {
      const code = reasonForAiError(error.code);
      console.error("[surveys:ai-summary:post]", code);
      return NextResponse.json(
        { ok: false, message: aiMessage(code), reason: code },
        { status: statusForAiError(error.code) },
      );
    }

    console.error("[surveys:ai-summary:post]", error);
    return NextResponse.json(
      { ok: false, message: messageFor("retry") },
      { status: 503 },
    );
  }
}
