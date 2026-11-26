/**
 * Feedback status uses the unified status model
 * (see {@link src/lib/status}); older rows that still carry a legacy value are
 * mapped on read through {@link normalizeStatus}. The labels and classes below
 * are re-exported from the unified module so the whole product renders the same
 * status the same way.
 */

import { STATUS_LABEL as FEEDBACK_STATUS_LABEL, STATUS_CLASS as FEEDBACK_STATUS_CLASS } from "@/lib/status";
import type { Status } from "@/lib/status";

export type FeedbackStatus = Status;

export type FeedbackEntry = {
  id: string;
  subject: string;
  message: string;
  status: FeedbackStatus;
  createdAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
};

export { FEEDBACK_STATUS_LABEL, FEEDBACK_STATUS_CLASS };
export type { Status };

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
