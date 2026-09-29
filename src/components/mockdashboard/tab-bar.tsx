export type Tab = { id: string; label: string; count?: number };

export function TabBar<T extends string>({
  tabs,
  active,
  onTab,
  tone = "indigo",
}: {
  tabs: Tab[];
  active: T;
  onTab: (id: T) => void;
  tone?: "indigo" | "emerald";
}) {
  const activeCls =
    tone === "indigo"
      ? "border-indigo-600 text-indigo-600"
      : "border-emerald-600 text-emerald-600";
  return (
    <div className="thin-scroll flex items-center gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onTab(t.id as T)}
          className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${
            active === t.id
              ? activeCls
              : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
          }`}
        >
          {t.label}
          {typeof t.count === "number" && t.count > 0 && (
            <span
              className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                active === t.id
                  ? tone === "indigo"
                    ? "bg-indigo-100 text-indigo-700"
                    : "bg-emerald-100 text-emerald-700"
                  : "bg-slate-100 text-slate-500"
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