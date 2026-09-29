import type { Status } from "@/lib/mockdashboard/types";

const map: Record<Status, { label: string; cls: string; dot: string }> = {
  pending: {
    label: "Pending",
    cls: "border border-line text-muted",
    dot: "bg-line-strong",
  },
  in_review: {
    label: "In review",
    cls: "bg-brass-soft/45 text-brass-deep",
    dot: "bg-brass",
  },
  approved: {
    label: "Approved",
    cls: "bg-ink text-canvas",
    dot: "bg-canvas/70",
  },
  returned: {
    label: "Returned",
    cls: "bg-[#a5442c]/[0.06] text-[#a5442c]",
    dot: "bg-[#c16549]",
  },
};

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const m = map[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] ${m.cls} ${className ?? ""}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}