export type FeedbackStatus = "new" | "acknowledged";

export type FeedbackEntry = {
  id: string;
  subject: string;
  message: string;
  status: FeedbackStatus;
  createdAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
};

export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: "New",
  acknowledged: "Acknowledged",
};

export const FEEDBACK_STATUS_CLASS: Record<FeedbackStatus, string> = {
  new: "border-brass/40 bg-brass-soft/30 text-brass-deep",
  acknowledged: "border-ink/20 bg-ink/[0.06] text-ink",
};

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function formatFeedbackDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-PH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
