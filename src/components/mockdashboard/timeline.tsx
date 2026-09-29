import type { TimelineEntry } from "@/lib/mockdashboard/types";
import { stamp } from "@/lib/mockdashboard/format";

const tone: Record<TimelineEntry["to"], string> = {
  pending: "bg-amber-500 ring-amber-100",
  in_review: "bg-blue-500 ring-blue-100",
  approved: "bg-emerald-500 ring-emerald-100",
  returned: "bg-rose-500 ring-rose-100",
};

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  const list = [...entries].reverse();
  return (
    <ol className="space-y-4">
      {list.map((e, i) => (
        <li key={i} className="relative flex gap-3">
          <span
            className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ${tone[e.to]}`}
          />
          <div className="-mt-0.5">
            <p className="text-sm text-slate-800">
              <span className="font-medium capitalize">{e.to.replace("_", " ")}</span>
              <span className="text-xs text-slate-400"> · {e.by}</span>
            </p>
            {e.note && <p className="mt-0.5 text-xs text-slate-500">{e.note}</p>}
            <p className="mt-0.5 text-[11px] text-slate-400">{stamp(e.at)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}