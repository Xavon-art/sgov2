"use client";

import { Reveal } from "@/components/fx/Reveal";
import { Section } from "@/components/landing/Section";
import { IconPyramid } from "@/components/ui/Icons";

const PAINS = [
  {
    n: "01",
    title: "Paper, and long drives",
    body: "Local councils physically carry resolutions, budgets, and endorsements to the central office — a half-day lost per submission, every term.",
  },
  {
    n: "02",
    title: "No shared visibility",
    body: "Once a document is handed over, nobody can say whether it was received, who is reviewing it, or what is still missing.",
  },
  {
    n: "03",
    title: "Records scattered everywhere",
    body: "Approved resolutions live in binders, chat threads, and personal drives. Next year's officers inherit none of it.",
  },
];

export function Problem() {
  return (
    <Section
      id="problem"
      tone="paper"
      eyebrow="The problem"
      title={
        <>
          Distance between a council and the
          <br className="hidden sm:block" /> administration is measured in{" "}
          <span className="text-brass-deep">paperwork</span>.
        </>
      }
      lede="A federated student government runs on dozens of small offices that rarely share a system, a status, or a file cabinet."
    >
      <div className="mt-16 grid gap-12 lg:mt-20 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
        <Reveal variant="scale" className="lg:sticky lg:top-28 lg:self-start">
          <DistanceDiagram />
        </Reveal>

        <ul className="flex flex-col">
          {PAINS.map((pain, i) => (
            <Reveal
              as="li"
              key={pain.n}
              delay={i * 0.08}
              className="group border-t border-line py-8 first:border-t-0 first:pt-0 sm:py-9"
            >
              <div className="flex gap-6 sm:gap-8">
                <span className="mt-1 shrink-0 font-mono text-[0.6875rem] font-medium tracking-[0.18em] text-brass">
                  {pain.n}
                </span>
                <div>
                  <h3 className="text-[1.25rem] sm:text-[1.375rem]">
                    {pain.title}
                  </h3>
                  <p className="mt-3 max-w-md text-[0.9375rem] leading-relaxed text-body">
                    {pain.body}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </ul>
      </div>
    </Section>
  );
}

function DistanceDiagram() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-canvas/70 p-6 sm:p-8">
      <div aria-hidden className="hairline-grid absolute inset-0 opacity-60" />
      <div className="relative">
        <p className="eyebrow">A typical submission</p>

        <div className="mt-7 flex items-center gap-3">
          <Node label="LSG" sub="College of Engineering" />
          <svg
            viewBox="0 0 90 12"
            className="h-3 w-16 shrink-0 text-ink-muted sm:w-24"
            aria-hidden
          >
            <path
              d="M2 6h86"
              stroke="currentColor"
              strokeWidth="1"
              strokeDasharray="2 4"
              strokeLinecap="round"
              className="animate-dash"
              opacity="0.7"
            />
          </svg>
          <Node label="USG" sub="Central Office" align="right" />
        </div>

        <div className="mt-7 flex items-baseline gap-3 border-t border-line pt-5">
          <span className="font-display text-[2.5rem] leading-none font-medium text-ink-deep">
            3
          </span>
          <p className="text-[0.8125rem] leading-snug text-muted">
            handovers before a single resolution is
            <br className="hidden sm:block" /> officially received
          </p>
        </div>

        <p className="mt-5 flex items-center gap-2 text-[0.75rem] text-muted">
          <IconPyramid className="h-4 w-4 text-brass" />
          SmartGov replaces the whole chain with one shared queue.
        </p>
      </div>
    </div>
  );
}

function Node({
  label,
  sub,
  align = "left",
}: {
  label: string;
  sub: string;
  align?: "left" | "right";
}) {
  return (
    <div
      className={
        align === "right" ? "min-w-0 text-right" : "min-w-0 text-left"
      }
    >
      <span className="inline-grid size-9 place-items-center rounded-full border border-ink/20 bg-paper font-mono text-[0.625rem] font-semibold tracking-wider text-ink">
        {label}
      </span>
      <p className="mt-2 text-[0.6875rem] leading-snug font-medium text-ink-soft">
        {sub}
      </p>
    </div>
  );
}
