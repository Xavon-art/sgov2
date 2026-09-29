import type { ItemKind } from "@/lib/mockdashboard/types";

const map: Record<ItemKind, { label: string; chip: string }> = {
  proposal: { label: "Proposal", chip: "bg-violet-50 text-violet-700" },
  event: { label: "Event", chip: "bg-sky-50 text-sky-700" },
  budget: { label: "Budget", chip: "bg-teal-50 text-teal-700" },
};

export function KindChip({ kind }: { kind: ItemKind }) {
  const m = map[kind];
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${m.chip}`}>
      {m.label}
    </span>
  );
}