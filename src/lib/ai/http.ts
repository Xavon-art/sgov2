import type { AiErrorCode } from "./errors";

const STATUS: Record<AiErrorCode, number> = {
  ai_not_configured: 503,
  ai_unavailable: 502,
  ai_timeout: 504,
  ai_invalid_output: 502,
};

export function statusForAiError(code: AiErrorCode): number {
  return STATUS[code] ?? 502;
}

export function reasonForAiError(code: AiErrorCode): string {
  return code;
}
