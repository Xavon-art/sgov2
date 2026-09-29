import type { Action, Role, Status } from "./types";

export function nextStatus(from: Status, action: Action): Status {
  const table: Record<string, Status> = {
    "pending:start_review": "in_review",
    "in_review:approve": "approved",
    "in_review:return": "returned",
    "returned:resubmit": "in_review",
  };
  const to = table[`${from}:${action}`];
  if (!to) throw new Error(`Illegal transition ${from} + ${action}`);
  return to;
}

export function canSubmit(role: Role): boolean {
  return role === "lsg";
}

export function canReview(role: Role): boolean {
  return role === "usg";
}