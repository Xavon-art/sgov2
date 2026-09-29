export type Tab = { id: string; label: string; count?: number };

export function TabBar<T extends string>({
  tabs,
  active,
  onTab,
}: {
  tabs: Tab[];
  active: T;
  onTab: (id: T) => void;
}) {
  return (
    <div className="thin-scroll flex items-center gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onTab(t.id as T)}
          className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors duration-300 ${
            active === t.id
              ? "border-brass text-ink"
              : "border-transparent text-ink-muted hover:border-line-strong hover:text-ink"
          }`}
        >
          {t.label}
          {typeof t.count === "number" && t.count > 0 && (
            <span
              className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
                active === t.id
                  ? "bg-brass-soft/60 text-brass-deep"
                  : "bg-ink/[0.05] text-muted"
              }`}
            >
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}