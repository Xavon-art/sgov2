import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { ASSISTANT_MODEL, localSurveySummary } from "@/lib/ai/local-assistant";
import { surveySummarySchema } from "@/lib/ai/schemas";

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

    const generated = await localSurveySummary({
      context,
      results,
      totalResponses,
      truncated: context.truncated === true,
    });
    const checked = surveySummarySchema.safeParse(generated);
    if (!checked.success) {
      return NextResponse.json(
        { ok: false, message: messageFor("retry") },
        { status: 503 },
      );
    }

    const saved = await callRpc<RpcResult>("set_survey_ai_summary", {
      p_session_token: token,
      p_survey_id: id,
      p_summary: checked.data,
      p_response_count: totalResponses,
      p_model: ASSISTANT_MODEL,
    });
    if (!saved.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(saved.reason), reason: saved.reason },
        { status: statusForReason(saved.reason) },
      );
    }

    return NextResponse.json({
      ok: true,
      summary: checked.data,
      responseCount: totalResponses,
      generatedAt: new Date().toISOString(),
      model: ASSISTANT_MODEL,
    });
  } catch (error) {
    console.error("[surveys:ai-summary:post]", error);
    return NextResponse.json(
      { ok: false, message: messageFor("retry") },
      { status: 503 },
    );
  }
}
