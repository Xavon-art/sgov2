type Assignment = {
  unitId: string;
  unitName: string;
  status: "assigned" | "in_progress" | "done";
  note: string;
};

type Task = {
  id: string;
  title: string;
  details: string;
  dueDate: string | null;
  priority: "low" | "normal" | "high";
  overdue: boolean;
  daysLeft: number | null;
  assignments: Assignment[];
  doneUnits: number;
  totalUnits: number;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; tasks: Task[] };

const ASSIGNMENT_LABEL: Record<Assignment["status"], string> = {
  assigned: "Not started",
  in_progress: "In progress",
  done: "Done",
};

const ASSIGNMENT_CLASS: Record<Assignment["status"], string> = {
  assigned: "border-line bg-canvas text-muted",
  in_progress: "border-brass/40 bg-brass-soft/30 text-brass-deep",
  done: "border-ink/20 bg-ink/[0.06] text-ink",
};

const PRIORITY_CLASS: Record<Task["priority"], string> = {
  low: "text-muted",
  normal: "text-muted",
  high: "text-[#a5442c]",
};

/**
 * How a deadline reads to a person, which is the whole reason `daysLeft` is
 * computed on the server: "in 3 days" and "6 days late" cannot drift apart between
 * the two workspaces if they come from one place.
 */
function dueLabel(task: Task): { text: string; late: boolean } {
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

export { dueLabel, ASSIGNMENT_LABEL, ASSIGNMENT_CLASS, PRIORITY_CLASS };
export type { Task, Assignment, LoadState };