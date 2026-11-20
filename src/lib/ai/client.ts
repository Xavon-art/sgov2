import "server-only";
import type { z } from "zod";
import { getAiConfig } from "./config";
import { AiError } from "./errors";
import { extractJsonObject } from "./parse";
import { buildTranscriptionPrompt } from "./prompts";
import type { AiMeta } from "./types";

type ChatKind = "summary" | "advice" | "draft" | "vision";

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "user";
      content: Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
    };

type ChatArgs = {
  kind: ChatKind;
  messages: ChatMessage[];
  temperature: number;
  json: boolean;
  model?: string;
};

type ChatResult = {
  content: string;
  meta: AiMeta;
};

type ProviderResponse = {
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
  };
};

export async function generateJson<T>(args: {
  system: string;
  user: string;
  temperature: number;
  schema: z.ZodType<T>;
  kind?: "summary" | "advice" | "draft";
}): Promise<{ value: T; meta: AiMeta }> {
  const result = await chat({
    kind: args.kind ?? "draft",
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
    temperature: args.temperature,
    json: true,
  });

  let parsed: unknown;
  try {
    parsed = extractJsonObject(result.content);
  } catch {
    throw new AiError("ai_invalid_output");
  }

  const checked = args.schema.safeParse(parsed);
  if (!checked.success) throw new AiError("ai_invalid_output");

  return { value: checked.data, meta: result.meta };
}

export async function generateText(args: {
  system: string;
  user: string;
  temperature: number;
}): Promise<{ value: string; meta: AiMeta }> {
  const result = await chat({
    kind: "draft",
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
    temperature: args.temperature,
    json: false,
  });

  return { value: result.content, meta: result.meta };
}

export async function transcribeImage(args: {
  dataUrl: string;
}): Promise<{ value: string; meta: AiMeta }> {
  const config = getAiConfig();
  if (!config?.visionModel) throw new AiError("ai_not_configured");

  const result = await chat({
    kind: "vision",
    messages: [
      { role: "system", content: buildTranscriptionPrompt().system },
      {
        role: "user",
        content: [
          { type: "text", text: "Transcribe this image." },
          { type: "image_url", image_url: { url: args.dataUrl } },
        ],
      },
    ],
    temperature: 0,
    json: false,
    model: config.visionModel,
  });

  return { value: result.content, meta: result.meta };
}

async function chat(args: ChatArgs): Promise<ChatResult> {
  const config = getAiConfig();
  if (!config) throw new AiError("ai_not_configured");

  const startedAt = Date.now();
  let status = 0;
  let logged = false;

  const logCall = (promptTokens: number | null, completionTokens: number | null) => {
    if (logged) return;
    logged = true;
    console.info("[ai]", {
      kind: args.kind,
      status,
      durationMs: Date.now() - startedAt,
      promptTokens,
      completionTokens,
    });
  };

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: args.model ?? config.model,
        messages: args.messages,
        temperature: args.temperature,
        max_tokens: config.maxOutputTokens,
        ...(args.json && config.jsonMode
          ? { response_format: { type: "json_object" } }
          : {}),
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });

    status = response.status;
    const durationMs = Date.now() - startedAt;

    if (!response.ok) {
      logCall(null, null);
      throw new AiError("ai_unavailable");
    }

    const data = (await response.json()) as ProviderResponse;
    const content = data.choices?.[0]?.message?.content;
    const promptTokens =
      typeof data.usage?.prompt_tokens === "number" ? data.usage.prompt_tokens : null;
    const completionTokens =
      typeof data.usage?.completion_tokens === "number"
        ? data.usage.completion_tokens
        : null;

    logCall(promptTokens, completionTokens);

    if (typeof content !== "string" || content.trim() === "") {
      throw new AiError("ai_invalid_output");
    }

    return {
      content,
      meta: {
        model: args.model ?? config.model,
        durationMs,
        promptTokens,
        completionTokens,
      },
    };
  } catch (error) {
    if (error instanceof AiError) throw error;

    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      logCall(null, null);
      throw new AiError("ai_timeout");
    }

    logCall(null, null);
    throw new AiError("ai_unavailable");
  }
}
