import type { ReactNode } from "react";

export const inputCls =
  "peer w-full rounded-xl border border-line bg-paper/70 px-3.5 text-[0.9375rem] text-ink-deep outline-none transition-[border-color,box-shadow,background-color] duration-300 placeholder:text-faint hover:border-line-strong focus:border-ink/25 focus:bg-paper";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-left">
      <span className="mb-1.5 block text-[0.8125rem] font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[0.75rem] leading-relaxed text-muted">{hint}</span>}
    </label>
  );
}