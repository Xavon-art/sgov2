"use client";

import { Reveal } from "@/components/fx/Reveal";
import { Section } from "@/components/landing/Section";

const STATS = [
  { value: "1", unit: "workspace", label: "Every council and campus, in one record" },
  { value: "100", unit: "%", label: "Of decisions carry a recorded, searchable trail" },
  { value: "2", unit: "structures", label: "Federated and unitary governance, both native" },
  { value: "0", unit: "handovers", label: "Paper moved between offices and people" },
];

const INSTITUTIONS = [
  "Halcyon University",
  "Northgate Institute of Technology",
  "Verdant State University",
  "Ashcombe University",
  "Lakeshore Polytechnic",
  "Meridian College",
];

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
          {STATS.map((stat) => (
            <div key={stat.label} className="bg-paper px-6 py-8 sm:px-7">
              <dt className="sr-only">{stat.label}</dt>
              <dd>
                <span className="flex items-baseline gap-1.5">
                  <span className="font-display text-[2.5rem] leading-none font-medium text-ink-deep">
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

      <Reveal delay={0.1} className="mt-16">
        <p className="eyebrow text-center">Designed around these shapes</p>
        <ul className="mask-fade-x mt-7 flex flex-wrap items-center justify-center gap-x-10 gap-y-5 sm:gap-x-14">
          {INSTITUTIONS.map((name) => (
            <li
              key={name}
              className="font-display text-[0.9375rem] font-medium tracking-[-0.01em] whitespace-nowrap text-ink-muted/75 transition-colors duration-500 hover:text-ink sm:text-[1.0625rem]"
            >
              {name}
            </li>
          ))}
        </ul>
        <p className="mt-8 text-center text-[0.6875rem] text-faint">
          Placeholder institutions shown for prototype purposes.
        </p>
      </Reveal>
    </Section>
  );
}
