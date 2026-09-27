"use client";

import { Reveal } from "@/components/fx/Reveal";
import { Section } from "@/components/landing/Section";
import { initials } from "@/lib/utils";

type Model = "federated" | "unitary";

const MODEL_LABEL: Record<Model, string> = {
  federated: "Federated",
  unitary: "Unitary",
};

const INSTITUTIONS: {
  name: string;
  shape: string;
  model: Model;
}[] = [
  {
    name: "Halcyon University",
    shape: "Research university",
    model: "federated",
  },
  {
    name: "Northgate Institute of Technology",
    shape: "Institute of technology",
    model: "federated",
  },
  {
    name: "Verdant State University",
    shape: "State university",
    model: "unitary",
  },
  {
    name: "Ashcombe University",
    shape: "Liberal arts university",
    model: "unitary",
  },
  {
    name: "Lakeshore Polytechnic",
    shape: "Polytechnic institute",
    model: "unitary",
  },
  {
    name: "Meridian College",
    shape: "Community college",
    model: "unitary",
  },
];

/**
 * Fixed-size monogram so the grid never reflows when a name wraps to a
 * different number of lines. `shrink-0` keeps it from being compressed on the
 * narrowest phones.
 */
function Monogram({ name, model }: { name: string; model: Model }) {
  return (
    <span
      aria-hidden
      className="relative grid size-11 shrink-0 place-items-center rounded-full border border-brass/45 bg-brass-soft/45 font-display text-[0.75rem] leading-none font-semibold tracking-[0.04em] text-ink-deep transition-transform duration-300 ease-out group-hover:-rotate-3 group-hover:scale-105 sm:size-12 sm:text-[0.8125rem]"
    >
      {initials(name)}
      <span className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-white/70 ring-inset" />
      {model === "federated" ? (
        <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-paper bg-ink/70" />
      ) : null}
    </span>
  );
}

function ModelTag({ model }: { model: Model }) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
        "text-[0.6875rem] font-semibold tracking-[0.08em] uppercase whitespace-nowrap",
        model === "federated"
          ? "border-brass/45 bg-brass-soft/35 text-ink-soft"
          : "border-line-strong bg-canvas text-ink-soft",
      ].join(" ")}
    >
      <span
        aria-hidden
        className={`size-1.5 shrink-0 rounded-full ${
          model === "federated" ? "bg-brass-deep" : "bg-ink-muted"
        }`}
      />
      {MODEL_LABEL[model]}
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
            Every institution arrives with a different governance shape. The org
            chart, the roles, and the routing adapt to fit — no template to
            fight.
          </p>
        </div>

        <ul className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:mt-10 lg:grid-cols-3">
          {INSTITUTIONS.map((institution, i) => (
            <Reveal key={institution.name} delay={0.06 * i} as="li">
              <div className="group flex h-full min-w-0 items-center gap-4 rounded-2xl border border-line bg-paper p-4 transition-[transform,border-color,box-shadow] duration-300 ease-out hover:-translate-y-0.5 hover:border-brass/40 hover:shadow-[var(--shadow-lift)] sm:p-5 lg:flex-col lg:items-start lg:gap-5 lg:p-6">
                <Monogram
                  name={institution.name}
                  model={institution.model}
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <h3 className="font-display text-[clamp(0.9375rem,0.9rem+0.2vw,1.0625rem)] leading-snug font-medium break-words text-balance text-ink-deep">
                    {institution.name}
                  </h3>
                  <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-soft text-pretty">
                    {institution.shape}
                  </p>
                  <div className="mt-3 lg:mt-auto lg:pt-5">
                    <ModelTag model={institution.model} />
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </ul>

        <p className="mt-8 text-center text-[0.6875rem] leading-relaxed text-ink-soft text-pretty">
          Placeholder institutions shown for prototype purposes.
        </p>
      </Reveal>
    </Section>
  );
}
