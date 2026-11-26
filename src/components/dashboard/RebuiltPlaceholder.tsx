export function RebuiltPlaceholder({ title }: { title: string }) {
  return (
    <section className="rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
      <h1 className="font-display text-[1.25rem] leading-tight font-medium text-ink-deep">{title}</h1>
      <p className="mt-2 text-[0.875rem] leading-relaxed text-body">Under construction — this section is being rebuilt.</p>
    </section>
  );
}
