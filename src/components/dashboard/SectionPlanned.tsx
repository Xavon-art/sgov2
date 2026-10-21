import { Reveal } from "@/components/fx/Reveal";

/**
 * A section that exists in the navigation but whose module lands in a later
 * phase of the remodel.
 *
 * This is intentionally not a fake screen. The federated rebuild is delivered in
 * phases, and the nav is the IA -- it names where the work will live the moment
 * it exists. Rendering a placeholder that says so is more honest than either
 * hiding the section (which makes the IA look half-built) or shipping a stub
 * form that writes nothing.
 *
 * Each section is replaced in place when its phase lands, so nothing links here
 * once the module is real.
 */
export function SectionPlanned({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <section className="flex flex-col gap-6">
      <Reveal className="flex flex-col gap-2">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="text-[1.5rem] leading-tight sm:text-[1.75rem]">{title}</h1>
        <p className="max-w-2xl text-[0.9375rem] leading-relaxed text-body">{body}</p>
      </Reveal>

      <Reveal delay={0.06}>
        <div className="rounded-2xl border border-dashed border-line-strong bg-paper/50 px-6 py-8">
          <p className="text-[0.9375rem] leading-relaxed text-muted">
            This section is being rebuilt as part of the federated dashboard remodel and arrives in a
            later phase. Nothing here is lost in the meantime — your existing records stay on file.
          </p>
        </div>
      </Reveal>
    </section>
  );
}
