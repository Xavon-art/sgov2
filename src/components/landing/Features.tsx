"use client";

import type { ReactNode } from "react";
import { Reveal } from "@/components/fx/Reveal";
import { Section } from "@/components/landing/Section";
import { useInView } from "@/lib/useInView";
import {
  IconArchive,
  IconBudget,
  IconCheck,
  IconDashboard,
  IconEvents,
  IconMonitoring,
  IconSubmission,
  IconTracking,
  IconVerification,
} from "@/components/ui/Icons";

type Feature = {
  id: string;
  icon: ReactNode;
  title: string;
  body: string;
  span: string;
  micro?: ReactNode;
};

const FEATURES: Feature[] = [
  {
    id: "dashboard",
    icon: <IconDashboard />,
    title: "Unified Dashboard",
    body: "One live view of every council, open submission, and budget line beneath your student government.",
    span: "lg:col-span-3",
    micro: <MicroDashboard />,
  },
  {
    id: "submission",
    icon: <IconSubmission />,
    title: "Requirements & Resolution Submission",
    body: "Local councils file resolutions, requirements, and endorsements online — no trip to the central office.",
    span: "lg:col-span-3",
    micro: <MicroSubmission />,
  },
  {
    id: "verification",
    icon: <IconVerification />,
    title: "Document Verification & Feedback",
    body: "Reviewers annotate and return feedback directly to the council that filed it.",
    span: "lg:col-span-2",
    micro: <MicroVerify />,
  },
  {
    id: "tracking",
    icon: <IconTracking />,
    title: "Submission Status Tracking",
    body: "Every request carries a visible status from receipt to approval.",
    span: "lg:col-span-2",
    micro: <MicroTrack />,
  },
  {
    id: "storage",
    icon: <IconArchive />,
    title: "Document Storage & Retrieval",
    body: "Searchable, versioned records that outlive a single term.",
    span: "lg:col-span-2",
    micro: <MicroArchive />,
  },
  {
    id: "monitoring",
    icon: <IconMonitoring />,
    title: "Monitoring & Reports",
    body: "Turnaround times, compliance, and programme health at a glance.",
    span: "lg:col-span-2",
    micro: <MicroReport />,
  },
  {
    id: "budget",
    icon: <IconBudget />,
    title: "Budget Tracking",
    body: "Allocations, releases, and receipts reconciled per council.",
    span: "lg:col-span-2",
    micro: <MicroBudget />,
  },
  {
    id: "events",
    icon: <IconEvents />,
    title: "Events",
    body: "A shared calendar for assemblies, consultations, and deadlines.",
    span: "lg:col-span-2",
    micro: <MicroEvents />,
  },
];

export function Features() {
  return (
    <Section
      id="features"
      eyebrow="The platform"
      title="Everything a student government actually has to run."
      lede="Eight capabilities, one record of truth — from the first draft of a resolution to the release of its budget."
    >
      <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:mt-20 lg:grid-cols-6">
        {FEATURES.map((f, i) => (
          <Reveal
            key={f.id}
            as="article"
            delay={(i % 3) * 0.07}
            className={`group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-paper/70 p-6 transition-[transform,border-color,box-shadow] duration-500 ease-out hover:-translate-y-1 hover:border-line-strong hover:shadow-lift sm:p-7 ${f.span}`}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-gradient-to-br from-ink/[0.035] via-transparent to-brass/[0.05] opacity-0 transition-opacity duration-500 group-hover:opacity-100"
            />
            <div className="relative flex items-start justify-between gap-4">
              <span className="grid size-10 place-items-center rounded-xl border border-line-strong/80 bg-canvas text-ink transition-colors duration-500 group-hover:border-brass/45 group-hover:text-ink-deep [&>svg]:h-[1.15rem] [&>svg]:w-[1.15rem]">
                {f.icon}
              </span>
              <span
                aria-hidden
                className="font-mono text-[0.625rem] tracking-[0.2em] text-line-strong transition-colors duration-500 group-hover:text-brass"
              >
                {String(i + 1).padStart(2, "0")}
              </span>
            </div>

            <h3 className="relative mt-5 text-[1.0625rem] leading-snug sm:text-[1.125rem]">
              {f.title}
            </h3>
            <p className="relative mt-2.5 text-[0.875rem] leading-relaxed text-body">
              {f.body}
            </p>

            {f.micro ? (
              <div className="relative mt-6 flex-1">{f.micro}</div>
            ) : null}
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

function MicroDashboard() {
  const { ref, inView } = useInView<HTMLDivElement>();
  const bars = [38, 62, 45, 78, 56, 92, 70];
  return (
    <div
      ref={ref}
      data-active={inView}
      aria-hidden
      className="flex h-20 items-end gap-1.5 rounded-xl border border-line/70 bg-canvas/50 px-3 pt-3 pb-2.5"
    >
      {bars.map((h, i) => (
        <span
          key={i}
          className="flex-1 rounded-t-[3px] bg-gradient-to-t from-ink/25 to-ink/70 transition-[height] duration-1000 ease-out"
          style={{
            height: inView ? `${h}%` : "6%",
            transitionDelay: `${i * 70}ms`,
          }}
        />
      ))}
    </div>
  );
}

function MicroSubmission() {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      data-active={inView}
      aria-hidden
      className="relative h-20 overflow-hidden rounded-xl border border-line/70 bg-canvas/50"
    >
      <div
        className="absolute top-3 left-3 w-[7.5rem] rounded-lg border border-line-strong bg-paper px-2.5 py-2 shadow-lift transition-transform duration-1000 ease-out"
        style={{ transform: inView ? "translate(0.75rem, 0)" : "translate(-3rem, 0)" }}
      >
        <span className="block h-1 w-10 rounded-full bg-ink/70" />
        <span className="mt-1.5 block h-1 w-16 rounded-full bg-ink/25" />
        <span className="mt-1.5 block h-1 w-12 rounded-full bg-ink/15" />
      </div>
      <div
        className="absolute right-3 bottom-3 flex items-center gap-1.5 rounded-full border border-brass/45 bg-brass-soft/60 px-2 py-0.5 transition-opacity duration-700"
        style={{ opacity: inView ? 1 : 0, transitionDelay: "700ms" }}
      >
        <IconCheck className="h-3 w-3 text-brass-deep" strokeWidth={2.4} />
        <span className="text-[0.5625rem] font-semibold text-ink-deep">
          Filed
        </span>
      </div>
    </div>
  );
}

function MicroVerify() {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      data-active={inView}
      aria-hidden
      className="mt-auto flex items-center gap-2.5 rounded-xl border border-line/70 bg-canvas/50 px-3 py-2.5"
    >
      <span className="grid size-6 shrink-0 place-items-center rounded-full border border-brass/50 bg-brass-soft/50 text-brass-deep">
        <IconCheck className="h-3.5 w-3.5" strokeWidth={2.2} />
      </span>
      <span className="text-[0.625rem] font-medium text-ink-soft">
        Feedback returned to LSG Arts
      </span>
    </div>
  );
}

function MicroTrack() {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      data-active={inView}
      aria-hidden
      className="relative mt-auto h-10"
    >
      <div className="absolute top-1/2 right-1 left-1 h-px -translate-y-1/2 bg-line-strong" />
      <span
        className="absolute top-1/2 left-1 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-ink-muted"
        style={{ left: inView ? "12%" : "0%" }}
      />
      <span
        className="absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-ink-muted"
        style={{ left: inView ? "46%" : "0%" }}
      />
      <span
        className="absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-ink-muted"
        style={{ left: inView ? "74%" : "0%" }}
      />
      <span
        className="absolute top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-full border border-brass/60 bg-brass-soft"
        style={{ left: inView ? "calc(100% - 1.25rem)" : "0%" }}
      >
        <IconCheck className="h-3 w-3 text-brass-deep" strokeWidth={2.4} />
      </span>
    </div>
  );
}

function MicroArchive() {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      data-active={inView}
      aria-hidden
      className="mt-auto flex gap-1.5"
    >
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="h-1.5 flex-1 rounded-full bg-line-strong transition-colors duration-700"
          style={{
            backgroundColor: inView && i < 3 ? "var(--color-brass)" : undefined,
            transitionDelay: `${i * 110}ms`,
          }}
        />
      ))}
    </div>
  );
}

function MicroReport() {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      data-active={inView}
      aria-hidden
      className="mt-auto flex items-end gap-4"
    >
      <span className="font-display text-[1.75rem] leading-none font-medium text-ink-deep">
        2.4<span className="text-[0.875rem] text-muted"> days</span>
      </span>
      <span className="pb-1 text-[0.625rem] leading-snug text-muted">
        median turnaround,
        <br />
        receipt to decision
      </span>
    </div>
  );
}

function MicroBudget() {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      data-active={inView}
      aria-hidden
      className="mt-auto h-1.5 overflow-hidden rounded-full bg-line"
    >
      <span
        className="block h-full rounded-full bg-gradient-to-r from-ink/70 to-brass transition-[width] duration-1000 ease-out"
        style={{ width: inView ? "68%" : "4%" }}
      />
    </div>
  );
}

function MicroEvents() {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      data-active={inView}
      aria-hidden
      className="mt-auto flex gap-1.5"
    >
      {["M", "T", "W", "T", "F"].map((d, i) => (
        <span
          key={`${d}-${i}`}
          className="grid h-6 flex-1 place-items-center rounded-md border text-[0.5625rem] font-semibold transition-colors duration-500"
          style={{
            borderColor: inView && i === 2 ? "var(--color-brass)" : "var(--color-line)",
            backgroundColor: inView && i === 2 ? "var(--color-brass-soft)" : "transparent",
            color: inView && i === 2 ? "var(--color-ink-deep)" : "var(--color-faint)",
            transitionDelay: `${i * 90}ms`,
          }}
        >
          {d}
        </span>
      ))}
    </div>
  );
}
