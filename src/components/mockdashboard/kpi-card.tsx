const tones: Record<string, { text: string; icon: string }> = {
  indigo: { text: "text-brass-deep", icon: "bg-brass-soft/45 text-brass-deep" },
  emerald: { text: "text-ink", icon: "bg-ink/[0.06] text-ink" },
  rose: { text: "text-[#a5442c]", icon: "bg-[#a5442c]/[0.07] text-[#a5442c]" },
  amber: { text: "text-brass-deep", icon: "bg-brass/15 text-brass-deep" },
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
    <div className="rounded-2xl border border-line bg-paper/70 p-4">
      <div className="flex items-center gap-2">
        {icon && (
          <span className={`flex h-6 w-6 items-center justify-center rounded-md text-sm ${t.icon}`}>
            {icon}
          </span>
        )}
        <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-muted">{label}</p>
      </div>
      <p className={`mt-2 text-2xl font-semibold tracking-tight ${t.text}`}>{value}</p>
      {hint && <p className="mt-1 text-[11px] text-ink-muted">{hint}</p>}
    </div>
  );
}