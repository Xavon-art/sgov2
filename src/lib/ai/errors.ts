export type AiErrorCode =
  | "ai_not_configured"
  | "ai_unavailable"
  | "ai_timeout"
  | "ai_invalid_output";

export class AiError extends Error {
  code: AiErrorCode;

  constructor(code: AiErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = "AiError";
  }
}
