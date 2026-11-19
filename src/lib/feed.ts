/**
 * What a feed post and a calendar day look like on the wire.
 *
 * `publishedAt` is `null` in every payload an LSG officer can receive, and that is
 * not an oversight in the type: `list_feed` nulls it for non-USG callers. The
 * officer's feed is only ever published work, so there is no moment the field would
 * have something to say.
 */
export type FeedPost = {
  id: string;
  title: string;
  description: string;
  activityType: string;
  eventDate: string | null;
  venue: string | null;
  status: string;
  unitId: string | null;
  unitName: string | null;
  publishedAt: string | null;
  isUpcoming: boolean;
};

export type CalendarEvent = {
  id: string;
  itemId: string;
  source: "event" | "proposal" | string;
  title: string;
  date: string;
  time: string | null;
  timezone: string | null;
  venue: string | null;
  activityType: string | null;
  unitName: string | null;
  status: string | null;
  honorStatus: string | null;
};

/** Days with something on them. A date absent from the map is a day with nothing. */
export type CalendarDays = Record<string, CalendarEvent[]>;

const ACTIVITY_LABEL: Record<string, string> = {
  sports: "Sports",
  culture: "Culture",
  academic: "Academic",
  community: "Community",
  wellness: "Wellness",
  special: "Special",
};

export function activityLabel(kind: string): string {
  return ACTIVITY_LABEL[kind] ?? kind;
}

const ACTIVITY_CLASS: Record<string, string> = {
  sports: "border-ink/20 bg-ink/[0.05]",
  culture: "border-brass/40 bg-brass-soft/30",
  academic: "border-line bg-canvas",
  community: "border-line bg-canvas",
  wellness: "border-line bg-canvas",
  special: "border-ink/20 bg-ink/[0.05]",
};

export function activityClass(kind: string): string {
  return ACTIVITY_CLASS[kind] ?? "border-line bg-canvas";
}

/**
 * One event date as a person reads it: "Tomorrow", "Today", "in 6 days", or
 * "3 weeks ago". Both sides use this, so a countdown cannot disagree between the
 * LSG phone and the USG desk.
 */
export function eventLabel(dateIso: string): { text: string; soon: boolean; past: boolean } {
  const [y, m, d] = dateIso.split("-").map(Number);
  if (!y || !m || !d) return { text: dateIso, soon: false, past: false };

  const target = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((target - today) / 86400000);

  if (days === 0) return { text: "Today", soon: true, past: false };
  if (days === 1) return { text: "Tomorrow", soon: true, past: false };
  if (days === -1) return { text: "Yesterday", soon: false, past: true };

  if (days > 0) {
    if (days < 7) return { text: `in ${days} days`, soon: true, past: false };
    if (days < 14) return { text: "next week", soon: false, past: false };
    if (days <= 60) return { text: `in ${Math.round(days / 7)} weeks`, soon: false, past: false };
    return { text: `in ${Math.round(days / 30)} months`, soon: false, past: false };
  }

  const ago = Math.abs(days);
  if (ago < 7) return { text: `${ago} days ago`, soon: false, past: true };
  if (ago < 14) return { text: "last week", soon: false, past: true };
  if (ago <= 60) return { text: `${Math.round(ago / 7)} weeks ago`, soon: false, past: true };
  return { text: `${Math.round(ago / 30)} months ago`, soon: false, past: true };
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** `2026-12-01` as `December 2026`. */
export function monthLabel(monthIso: string): string {
  const [y, m] = monthIso.split("-").map(Number);
  if (!y || !m) return "";
  return `${MONTHS[m - 1]} ${y}`;
}

/** `2026-12-04` as `Fri 4 Dec`. The year is dropped because the header carries it. */
export function dayCellLabel(dateIso: string): { weekday: string; day: string; month: string } {
  const [y, m, d] = dateIso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return {
    weekday: WEEKDAYS[(date.getUTCDay() + 6) % 7],
    day: String(d),
    month: MONTHS[m - 1].slice(0, 3),
  };
}

/**
 * Every date in the shown month, padded to whole Monday-to-Sunday weeks, so the
 * grid always starts on a Monday and always has a stable seven columns.
 *
 * Built here rather than fetched per day: the database answers "which days have
 * something", and the empty ones are arithmetic.
 */
export function monthGrid(monthIso: string): string[] {
  const [y, m] = monthIso.split("-").map(Number);
  if (!y || !m) return [];

  const first = new Date(Date.UTC(y, m - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(y, m - 1, 1 - offset));
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const total = Math.ceil((offset + lastDay) / 7) * 7;

  const out: string[] = [];
  for (let i = 0; i < total; i += 1) {
    const day = new Date(start.getTime() + i * 86400000);
    out.push(day.toISOString().slice(0, 10));
  }
  return out;
}

export function todayIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function shiftMonth(monthIso: string, by: number): string {
  const [y, m] = monthIso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + by, 1));
  return date.toISOString().slice(0, 10);
}

export function currentMonthIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}