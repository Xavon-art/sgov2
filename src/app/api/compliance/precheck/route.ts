import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { runPreflightCheck } from "@/lib/compliance/engine";
import { loadAuthoritativeItems } from "@/lib/compliance/precheck-authority";
import {
  MAX_BODY_BYTES,
  matchAuthoritativeItems,
  precheckRequestSchema,
  validatePrecheckLimits,
} from "@/lib/compliance/precheck-request";
import type { MatchedPrecheckItem } from "@/lib/compliance/precheck-request";
import type { PreflightItemInput } from "@/lib/compliance/types";
import { transcribeImage } from "@/lib/ai/client";
import { isVisionConfigured } from "@/lib/ai/config";
import { ASSISTANT_MODEL, localAdvice } from "@/lib/ai/local-assistant";
import { adviceSchema } from "@/lib/ai/schemas";

export const runtime = "nodejs";

const IP_LIMIT = 30;
const IP_WINDOW_MS = 5 * 60_000;

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "rate_limited") return 429;
  if (reason === "forbidden") return 403;
  if (reason === "not_found") return 404;
  return 400;
}

export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const limit = rateLimit(`precheck:ip:${clientIp(req)}`, IP_LIMIT, IP_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, message: messageFor("rate_limited") },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, message: "The pre-check request exceeds the 3 MB body limit." },
      { status: 413 },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { ok: false, message: messageFor("invalid_request") },
      { status: 400 },
    );
  }

  const validation = precheckRequestSchema.safeParse(parsed);
  if (!validation.success) {
    return NextResponse.json(
      { ok: false, message: messageFor("invalid_request") },
      { status: 400 },
    );
  }

  const body = validation.data;
  const limits = validatePrecheckLimits(body, Buffer.byteLength(raw, "utf8"));
  if (!limits.ok) {
    return NextResponse.json({ ok: false, message: limits.message }, { status: 413 });
  }

  try {
    const authority = await loadAuthoritativeItems({
      token,
      proposalId: body.proposalId,
      programId: body.programId,
    });
    if (!authority.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(authority.reason) },
        { status: statusForReason(authority.reason) },
      );
    }

    const matched = matchAuthoritativeItems(body.items, authority.items);
    if (!matched.ok) {
      return NextResponse.json(
        { ok: false, message: matched.message },
        { status: 400 },
      );
    }

    const visionReady = isVisionConfigured();
    const items: PreflightItemInput[] = [];

    for (const item of matched.items) {
      items.push(await toPreflightItem(item, token, visionReady));
    }

    const report = await runPreflightCheck({
      items,
      context: {
        title: body.context.title,
        eventDate: body.context.eventDate ?? null,
        venue: body.context.venue ?? null,
        unitName: body.context.unitName ?? null,
        programName: body.context.programName ?? null,
      },
    });

    const aiConfigured = true;
    let advice: string | null = null;
    let fixes: string[] = [];
    let model: string | null = null;

    const needsAdvice = report.items.some(
      (item) =>
        item.status === "missing" ||
        item.status === "unreadable" ||
        item.status === "suspect",
    );

    if (needsAdvice) {
      try {
        const generated = await localAdvice({ report, context: body.context });
        const checked = adviceSchema.safeParse(generated);
        if (checked.success) {
          advice = checked.data.paragraph;
          fixes = checked.data.fixes;
          model = ASSISTANT_MODEL;
        }
      } catch {
        advice = null;
        fixes = [];
        model = null;
      }
    }

    return NextResponse.json({
      ok: true,
      aiConfigured,
      report,
      advice,
      fixes,
      model,
    });
  } catch (error) {
    console.error("[precheck]", error);
    return NextResponse.json(
      { ok: false, message: "We could not check those files." },
      { status: 500 },
    );
  }
}

async function toPreflightItem(
  item: MatchedPrecheckItem,
  token: string,
  visionReady: boolean,
): Promise<PreflightItemInput> {
  const base: PreflightItemInput = {
    itemId: item.itemId,
    label: item.label,
    itemKind: item.itemKind,
  };

  if (item.itemKind === "link") {
    return { ...base, linkUrl: item.linkUrl };
  }

  if (item.imageDataUrl) {
    const transcript = visionReady
      ? await transcribeWithQuota(item.imageDataUrl, token)
      : null;
    if (transcript) {
      return {
        ...base,
        fileName: item.fileName,
        sizeBytes: item.sizeBytes,
        text: transcript,
        format: "image",
      };
    }
    return {
      ...base,
      fileName: item.fileName,
      sizeBytes: item.sizeBytes,
      text: "",
      format: "image",
      issue: "ocr_pending",
    };
  }

  return {
    ...base,
    fileName: item.fileName,
    sizeBytes: item.sizeBytes,
    ...(item.text !== undefined ? { text: item.text } : {}),
    ...(item.format !== undefined ? { format: item.format } : {}),
    ...(item.issue !== undefined ? { issue: item.issue } : {}),
  };
}

async function transcribeWithQuota(
  dataUrl: string,
  token: string,
): Promise<string | null> {
  try {
    const quota = await callRpc<RpcResult>("consume_ai_quota", {
      p_session_token: token,
      p_kind: "vision",
    });
    if (!quota.ok) return null;

    const result = await transcribeImage({ dataUrl });
    const text = result.value.trim();
    return text === "" ? null : text;
  } catch {
    return null;
  }
}
