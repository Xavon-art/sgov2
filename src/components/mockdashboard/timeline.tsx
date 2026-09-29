import type { TimelineEntry } from "@/lib/mockdashboard/types";
import { stamp } from "@/lib/mockdashboard/format";

const tone: Record<TimelineEntry["to"], string> = {
  pending: "bg-line-strong ring-line",
  in_review: "bg-brass ring-brass-soft/50",
  approved: "bg-ink ring-ink/[0.08]",
  returned: "bg-[#c16549] ring-[#a5442c]/[0.12]",
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
            <p className="text-[0.875rem] text-ink">
              <span className="font-medium capitalize">{e.to.replace("_", " ")}</span>
              <span className="text-[0.8125rem] text-ink-muted"> · {e.by}</span>
            </p>
            {e.note && <p className="mt-0.5 text-[0.8125rem] text-muted">{e.note}</p>}
            <p className="mt-0.5 text-[0.75rem] text-faint">{stamp(e.at)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}