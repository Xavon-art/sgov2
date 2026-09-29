import type { ItemKind } from "@/lib/mockdashboard/types";

const map: Record<ItemKind, { label: string; chip: string }> = {
  proposal: { label: "Proposal", chip: "bg-brass-soft/50 text-brass-deep" },
  event: { label: "Event", chip: "bg-ink/[0.07] text-ink" },
  budget: { label: "Budget", chip: "border border-line bg-paper text-ink-soft" },
};

export function KindChip({ kind }: { kind: ItemKind }) {
  const m = map[kind];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${m.chip}`}>
      {m.label}
    </span>
  );
}