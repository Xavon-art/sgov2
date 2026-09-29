const tones: Record<string, { text: string; icon: string }> = {
  indigo: { text: "text-indigo-600", icon: "bg-indigo-50 text-indigo-600" },
  emerald: { text: "text-emerald-600", icon: "bg-emerald-50 text-emerald-600" },
  rose: { text: "text-rose-600", icon: "bg-rose-50 text-rose-600" },
  amber: { text: "text-amber-600", icon: "bg-amber-50 text-amber-600" },
};

export function KpiCard({
  label,
  value,
  hint,
  tone = "indigo",
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "indigo" | "emerald" | "rose" | "amber";
  icon?: string;
}) {
  const t = tones[tone];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        {icon && (
          <span className={`flex h-6 w-6 items-center justify-center rounded-md text-sm ${t.icon}`}>
            {icon}
          </span>
        )}
        <p className="text-xs font-medium text-slate-500">{label}</p>
      </div>
      <p className={`mt-2 text-2xl font-bold tracking-tight ${t.text}`}>{value}</p>
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}