import type { ProposalStatus, StatusTone } from "./types";

export function statusLabel(status: ProposalStatus): string {
  switch (status) {
    case "submitted":
      return "Submitted";
    case "under_review":
      return "Under review";
    case "returned":
      return "Returned — resubmit";
    case "requirements_requested":
      return "Additional requirements";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "published":
      return "Published";
  }
}

export function statusTone(status: ProposalStatus): StatusTone {
  switch (status) {
    case "submitted":
    case "under_review":
      return "info";
    case "returned":
    case "requirements_requested":
      return "warning";
    case "rejected":
      return "danger";
    case "approved":
    case "published":
      return "success";
  }
}

const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  neutral: "border border-line text-ink-soft",
  info: "border border-brass/40 bg-brass-soft/30 text-brass-deep",
  warning: "bg-brass-soft/55 text-brass-deep",
  success: "bg-ink text-canvas",
  danger: "border border-line text-ink-soft",
};

/**
 * The chip class that carries a status's tone, so every list colours the same
 * status the same way instead of each screen guessing.
 */
export function statusChipClass(status: ProposalStatus): string {
  return STATUS_TONE_CLASS[statusTone(status)];
}

export const ACTIVITY_OPTIONS = [
  { value: "sports", label: "Sports" },
  { value: "culture", label: "Culture" },
  { value: "academic", label: "Academic" },
  { value: "community", label: "Community" },
  { value: "wellness", label: "Wellness" },
  { value: "special", label: "Special" },
] as const;

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

export function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatMoney(amount: number | null | undefined): string {
  if (amount == null || Number.isNaN(amount)) return "—";
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(amount);
}