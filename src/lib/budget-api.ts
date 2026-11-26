import { NextResponse } from "next/server";
import { messageFor } from "@/lib/auth/messages";
import type { RpcResult } from "@/lib/auth/rpc";
import { parseAmount } from "@/lib/budgets";

export const BUDGET_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function budgetJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { "Cache-Control": "no-store" },
  });
}

export function budgetStatusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "rate_limited") return 429;
  if (reason === "forbidden") return 403;
  if (reason === "not_found") return 404;
  return 400;
}

export function budgetFailure(res: RpcResult) {
  return budgetJson(
    { ok: false, message: messageFor(res.reason), reason: res.reason },
    { status: budgetStatusForReason(res.reason) },
  );
}

export function optionalBudgetUuid(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !BUDGET_UUID_RE.test(value.trim())) return undefined;
  return value.trim();
}

export function budgetAmount(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    return parseAmount(value);
  }
  return null;
}
