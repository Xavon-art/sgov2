export type DeadlineTone = "none" | "normal" | "soon" | "overdue";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function parsed(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function sameLocalDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

export function countdownText(
  dueAt: string | null | undefined,
  gracePeriodMinutes = 0,
  closed = false,
  nowMs = Date.now(),
): string {
  const due = parsed(dueAt);
  if (due === null) return "No deadline";

  const diff = due + gracePeriodMinutes * 60_000 - nowMs;
  if (closed) return "Closed";

  if (diff <= 0) {
    const elapsed = Math.abs(diff);
    const days = Math.floor(elapsed / DAY_MS);
    if (days >= 1) return `Overdue by ${days}d`;
    const hours = Math.floor(elapsed / HOUR_MS);
    if (hours >= 1) return `Overdue by ${hours}h`;
    return "Overdue today";
  }

  if (sameLocalDay(nowMs, due + gracePeriodMinutes * 60_000)) return "Due today";

  const days = Math.floor(diff / DAY_MS);
  const hours = Math.floor((diff % DAY_MS) / HOUR_MS);
  if (days >= 1 && hours >= 1) return `Due in ${days}d ${hours}h`;
  if (days >= 1) return `Due in ${days}d`;
  return `Due in ${hours}h`;
}

export function countdownTone(
  dueAt: string | null | undefined,
  gracePeriodMinutes = 0,
  closed = false,
  nowMs = Date.now(),
): DeadlineTone {
  const due = parsed(dueAt);
  if (due === null) return "none";
  if (closed) return "none";

  const diff = due + gracePeriodMinutes * 60_000 - nowMs;
  if (diff <= 0) return "overdue";
  if (diff <= DAY_MS) return "soon";
  return "normal";
}

export function isDeadlineOverdue(
  dueAt: string | null | undefined,
  status?: string | null,
  nowMs = Date.now(),
): boolean {
  const due = parsed(dueAt);
  if (due === null || due >= nowMs) return false;
  if (!status) return true;
  return ["pending", "draft", "returned", "overdue"].includes(status);
}

export function toDateTimeLocalValue(value: string | null | undefined): string {
  const date = parsed(value);
  if (date === null) return "";
  const local = new Date(date - new Date(date).getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function dateTimeLocalToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
