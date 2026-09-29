import type { ReactNode } from "react";

export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-line bg-paper/70 ${className ?? ""}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line/70 px-5 py-4">
          <div>
            {title && <h3 className="text-[0.9375rem] font-medium tracking-tight text-ink-deep">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-muted">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}