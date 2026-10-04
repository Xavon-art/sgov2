import type { ProposalsListRow } from "./types";

export function statusLabel(status: ProposalsListRow["status"]): string {
  switch (status) {
    case "submitted":
      return "Submitted";
    case "returned":
      return "Returned — resubmit";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "published":
      return "Published";
  }
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