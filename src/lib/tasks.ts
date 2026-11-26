/**
 * One task and its per-unit assignments, shared by the task board on both
 * sides of the federation.
 *
 * The unified status model lives in {@link src/lib/status}. Every assignment
 * status is stored as one of the unified values; older rows that still carry a
 * legacy value are mapped on read through {@link normalizeStatus}.
 */

import type { Status, STATUS_LABEL as ASSIGNMENT_LABEL, STATUS_CLASS as ASSIGNMENT_CLASS } from "@/lib/status";
import { countdownText } from "@/lib/deadlines";

export type Assignment = {
  unitId: string;
  unitName: string;
  status: Status;
  note: string;
};

export type Task = {
  id: string;
  title: string;
  details: string;
  dueDate: string | null;
  dueAt?: string | null;
  gracePeriodMinutes?: number | null;
  autoClose?: boolean;
  closed?: boolean;
  priority: "low" | "normal" | "high";
  overdue: boolean;
  daysLeft: number | null;
  assignments: Assignment[];
  doneUnits: number;
  totalUnits: number;
};

export type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; tasks: Task[] };

export const PRIORITY_CLASS: Record<Task["priority"], string> = {
  low: "text-muted",
  normal: "text-muted",
  high: "text-[#a5442c]",
};

/**
 * How a deadline reads to a person, which is the whole reason `daysLeft` is
 * computed on the server: "in 3 days" and "6 days late" cannot drift apart
 * between the two workspaces if they come from one place.
 */
export function dueLabel(task: Task): { text: string; late: boolean } {
  if (task.dueAt) {
    const text = countdownText(task.dueAt, task.gracePeriodMinutes ?? 0, task.closed);
    return {
      text,
      late: text.startsWith("Overdue") || task.overdue === true,
    };
  }
  if (!task.dueDate || task.daysLeft === null) {
    return { text: "No deadline", late: false };
  }
  if (task.daysLeft < 0) {
    const n = Math.abs(task.daysLeft);
    return { text: `${n} day${n === 1 ? "" : "s"} late`, late: true };
  }
  if (task.daysLeft === 0) return { text: "Due today", late: false };
  return { text: `Due in ${task.daysLeft} day${task.daysLeft === 1 ? "" : "s"}`, late: false };
}

/** `2026-12-20` as `20 Dec 2026`, or empty when there is no date at all. */
export function formatTaskDate(date: string | null | undefined): string {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-PH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Today in `YYYY-MM-DD`, for the min attribute on a date input. */
export function todayIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export { ASSIGNMENT_LABEL, ASSIGNMENT_CLASS };
