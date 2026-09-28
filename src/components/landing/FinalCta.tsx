import ShaderField from "@/components/fx/ShaderField";
import { FloatingField, type FloatingChip } from "@/components/fx/FloatingField";
import { Reveal } from "@/components/fx/Reveal";
import { ButtonLink } from "@/components/ui/Button";
import { Seal } from "@/components/ui/Seal";
import {
  IconArrowRight,
  IconCheck,
  IconPyramid,
  IconVerification,
} from "@/components/ui/Icons";

const CHIPS: FloatingChip[] = [
  {
    id: "cta-lsg",
    label: "LSG North Campus",
    sub: "connected",
    icon: <IconPyramid />,
    left: 6,
    top: 24,
    depth: 1,
    drift: "wide",
    scale: 0.95,
  },
  {
    id: "cta-usg",
    label: "USG",
    sub: "oversight",
    icon: <IconPyramid />,
    left: 11,
    top: 62,
    depth: 0.7,
    drift: "soft",
    scale: 0.9,
  },
  {
    id: "cta-ok",
    label: "Charter granted",
    sub: "SGV-2026",
    icon: <IconCheck strokeWidth={2.4} />,
    left: 84,
    top: 26,
    depth: 1.15,
    drift: "wide",
    scale: 1,
  },
  {
    id: "cta-verify",
    label: "Documents verified",
    sub: "4 of 4",
    icon: <IconVerification />,
    left: 79,
    top: 64,
    depth: 0.75,
    drift: "soft",
    scale: 0.92,
  },
];

export function FinalCta() {
  return (
    <section className="bg-canvas py-24 sm:py-28 lg:py-32">
      <div className="mx-auto max-w-[82rem] px-5 sm:px-8">
        <Reveal variant="scale">
          <div className="grain relative isolate overflow-hidden rounded-[1.75rem] border border-line-strong/70 px-6 py-20 text-center sm:px-12 sm:py-24">
            <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
              <ShaderField strength={0.95} scale={1.9} speed={0.026} />
              <div className="absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_50%,transparent_20%,rgba(250,250,247,0.55)_85%)]" />
            </div>
            <FloatingField chips={CHIPS} range={18} hideBelow="md" />

            <div className="relative">
              <Seal
                size={62}
                inscribed
                className="mx-auto drop-shadow-[0_6px_20px_rgba(13,33,53,0.18)]"
              />
              <p className="eyebrow mt-8">Ready when your council is</p>
              <h2 className="mx-auto mt-5 max-w-2xl text-[2rem] leading-[1.08] sm:text-[2.75rem] lg:text-[3.25rem]">
                Stand up your student government
                <br className="hidden sm:block" /> on one system.
              </h2>
              <p className="mx-auto mt-6 max-w-lg text-[1.0625rem] leading-relaxed text-body">
                Pick your governance model, name your institution, and invite
                every officer. SmartGov handles the rest.
              </p>

              <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <ButtonLink href="/create" size="lg" className="w-full sm:w-auto">
                  Create Your Student Org
                  <IconArrowRight className="h-4.5 w-4.5 transition-transform duration-500 group-hover:translate-x-1" />
                </ButtonLink>
                <ButtonLink
                  href="/create/governance-model"
                  size="lg"
                  variant="outline"
                  className="w-full sm:w-auto"
                >
                  Compare governance models
                </ButtonLink>
              </div>

              <p className="mt-8 text-[0.75rem] text-muted">
                Four steps · no credit card · your data stays in your workspace
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
