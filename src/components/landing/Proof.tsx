"use client";

import { Reveal } from "@/components/fx/Reveal";
import { Section } from "@/components/landing/Section";

type Variant = "primary" | "neutral";

/**
 * The governance units the product actually models, straight from the
 * `unit_type` / `member_role` enums. Deliberately not a customer list — the
 * system has no users yet, and implying otherwise would be a false claim.
 */
const UNITS: {
  code: string;
  name: string;
  desc: string;
  tag: string;
  variant: Variant;
}[] = [
  {
    code: "USG",
    name: "University Student Government",
    desc: "The central body — where officers, chairs, and the executive team sit.",
    tag: "Root",
    variant: "primary",
  },
  {
    code: "LSG",
    name: "Local Student Government",
    desc: "One per college or campus, nested under the USG instead of floating loose.",
    tag: "Nested",
    variant: "neutral",
  },
  {
    code: "CTL",
    name: "Councils & cabinets",
    desc: "The deliberative bodies where resolutions actually get voted on.",
    tag: "Deliberative",
    variant: "neutral",
  },
  {
    code: "COL",
    name: "Colleges & schools",
    desc: "Academic units that anchor each local government.",
    tag: "Anchor",
    variant: "neutral",
  },
  {
    code: "CAM",
    name: "Campuses & branches",
    desc: "Multi-site institutions keep every site distinct under one record.",
    tag: "Multi-site",
    variant: "neutral",
  },
  {
    code: "ROL",
    name: "Officers & advisors",
    desc: "Four seat types, each carrying its own permissions.",
    tag: "Per-seat",
    variant: "neutral",
  },
];

/**
 * Fixed-size monogram so the grid never reflows when a name wraps to a
 * different number of lines. `shrink-0` keeps it from being compressed on the
 * narrowest phones.
 */
function Monogram({ code, variant }: { code: string; variant: Variant }) {
  return (
    <span
      aria-hidden
      className="relative grid size-11 shrink-0 place-items-center rounded-full border border-brass/45 bg-brass-soft/45 font-display text-[0.6875rem] leading-none font-semibold tracking-[0.04em] text-ink-deep transition-transform duration-300 ease-out group-hover:-rotate-3 group-hover:scale-105 sm:size-12 sm:text-[0.75rem]"
    >
      {code}
      <span className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-white/70 ring-inset" />
      {variant === "primary" ? (
        <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-paper bg-ink/70" />
      ) : null}
    </span>
  );
}

function UnitTag({ tag, variant }: { tag: string; variant: Variant }) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
        "text-[0.6875rem] font-semibold tracking-[0.08em] uppercase whitespace-nowrap",
        variant === "primary"
          ? "border-brass/45 bg-brass-soft/35 text-ink-soft"
          : "border-line-strong bg-canvas text-ink-soft",
      ].join(" ")}
    >
      <span
        aria-hidden
        className={`size-1.5 shrink-0 rounded-full ${
          variant === "primary" ? "bg-brass-deep" : "bg-ink-muted"
        }`}
      />
      {tag}
    </span>
  );
}

export function Proof() {
  return (
    <Section
      id="universities"
      tone="paper"
      eyebrow="Built for universities"
      title="An administrative system your student government will actually keep using."
    >
      <Reveal className="mt-12">
        <dl className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              value: "1",
              unit: "workspace",
              label: "Every council and campus, in one record",
            },
            {
              value: "100",
              unit: "%",
              label: "Of decisions carry a recorded, searchable trail",
            },
            {
              value: "2",
              unit: "structures",
              label: "Federated and unitary governance, both native",
            },
            {
              value: "0",
              unit: "handovers",
              label: "Paper moved between offices and people",
            },
          ].map((stat) => (
            <div key={stat.label} className="bg-paper px-6 py-8 sm:px-7">
              <dt className="sr-only">{stat.label}</dt>
              <dd>
                <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
                  <span className="font-display text-[2.25rem] leading-none font-medium text-ink-deep sm:text-[2.5rem]">
                    {stat.value}
                  </span>
                  <span className="text-[0.75rem] font-semibold tracking-[0.1em] text-brass-deep uppercase">
                    {stat.unit}
                  </span>
                </span>
                <span className="mt-3 block text-[0.8125rem] leading-relaxed text-body">
                  {stat.label}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </Reveal>

      <Reveal delay={0.1} className="mt-16 sm:mt-20">
        <div className="mx-auto max-w-xl text-center">
          <p className="eyebrow">Designed around these shapes</p>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-body text-pretty">
            SmartGov is not a template you bend to fit your constitution. You
            declare your governance model, name the units you actually have, and
            the org chart, the seats, and the routing build themselves around
            it.
          </p>
        </div>

        <ul
          aria-label="Governance units SmartGov models"
          className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:mt-10 lg:grid-cols-3"
        >
          {UNITS.map((unit, i) => (
            <Reveal key={unit.code} delay={0.06 * i} as="li">
              <div className="group flex h-full min-w-0 items-center gap-4 rounded-2xl border border-line bg-paper p-4 transition-[transform,border-color,box-shadow] duration-300 ease-out hover:-translate-y-0.5 hover:border-brass/40 hover:shadow-[var(--shadow-lift)] sm:p-5 lg:flex-col lg:items-start lg:gap-5 lg:p-6">
                <Monogram code={unit.code} variant={unit.variant} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <h3 className="font-display text-[clamp(0.9375rem,0.9rem+0.2vw,1.0625rem)] leading-snug font-medium break-words text-balance text-ink-deep">
                    {unit.name}
                  </h3>
                  <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-soft text-pretty">
                    {unit.desc}
                  </p>
                  <div className="mt-3 lg:mt-auto lg:pt-5">
                    <UnitTag tag={unit.tag} variant={unit.variant} />
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </ul>

        <p className="mt-8 text-center text-[0.6875rem] leading-relaxed text-ink-soft text-pretty">
          A preview of the structures SmartGov models — not a list of
          institutions using it.
        </p>
      </Reveal>
    </Section>
  );
}
