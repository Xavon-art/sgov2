export type AiConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  visionModel: string | null;
  jsonMode: boolean;
  timeoutMs: number;
  maxOutputTokens: number;
};

function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function getAiConfig(): AiConfig | null {
  const apiKey = (process.env.AI_API_KEY ?? "").trim();
  const model = (process.env.AI_MODEL ?? "").trim();
  if (!apiKey || !model) return null;

  const rawBaseUrl = (process.env.AI_BASE_URL ?? "").trim();
  const baseUrl = (rawBaseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const visionModel = (process.env.AI_VISION_MODEL ?? "").trim();

  return {
    apiKey,
    baseUrl,
    model,
    visionModel: visionModel || null,
    jsonMode: (process.env.AI_JSON_MODE ?? "").trim().toLowerCase() !== "false",
    timeoutMs: positiveInteger(process.env.AI_TIMEOUT_MS, 45_000),
    maxOutputTokens: positiveInteger(process.env.AI_MAX_OUTPUT_TOKENS, 1_400),
  };
}

export function isAiConfigured(): boolean {
  return getAiConfig() !== null;
}

export function isVisionConfigured(): boolean {
  const config = getAiConfig();
  return config !== null && config.visionModel !== null;
}
