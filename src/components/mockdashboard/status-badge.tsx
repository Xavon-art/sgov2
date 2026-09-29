import type { Status } from "@/lib/mockdashboard/types";

const map: Record<Status, { label: string; cls: string; dot: string }> = {
  pending: {
    label: "Pending",
    cls: "bg-amber-50 text-amber-700 ring-amber-200",
    dot: "bg-amber-500",
  },
  in_review: {
    label: "In review",
    cls: "bg-blue-50 text-blue-700 ring-blue-200",
    dot: "bg-blue-500",
  },
  approved: {
    label: "Approved",
    cls: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
  },
  returned: {
    label: "Returned",
    cls: "bg-rose-50 text-rose-700 ring-rose-200",
    dot: "bg-rose-500",
  },
};

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const m = map[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${m.cls} ${className ?? ""}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}