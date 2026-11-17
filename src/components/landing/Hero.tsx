"use client";

import ShaderField from "@/components/fx/ShaderField";
import { FloatingField, type FloatingChip } from "@/components/fx/FloatingField";
import { ButtonLink, buttonClasses } from "@/components/ui/Button";
import { HeroConsole } from "@/components/landing/HeroConsole";
import {
  IconArrowRight,
  IconBudget,
  IconCheck,
  IconClock,
  IconPyramid,
  IconSubmission,
  IconTracking,
  IconVerification,
} from "@/components/ui/Icons";

const CHIPS: FloatingChip[] = [
  {
    id: "approved",
    label: "Resolution Approved",
    sub: "2026-014 · USG",
    icon: <IconCheck strokeWidth={2.25} />,
    left: 3,
    top: 20,
    depth: 1.15,
    drift: "wide",
    duration: 13,
    scale: 1.02,
    delayIn: 0.75,
  },
  {
    id: "usg",
    label: "USG",
    sub: "University Student Govt",
    icon: <IconPyramid />,
    left: 6,
    top: 44,
    depth: 0.75,
    drift: "soft",
    duration: 15,
    scale: 0.94,
    delayIn: 0.95,
  },
  {
    id: "lsg",
    label: "LSG · Engineering",
    sub: "reports to USG",
    icon: <IconSubmission />,
    left: 10,
    top: 68,
    depth: 1,
    drift: "wide",
    duration: 17,
    scale: 0.97,
    delayIn: 1.15,
  },
  {
    id: "tracking",
    label: "Status Tracking",
    sub: "3 of 4 verifications done",
    icon: <IconTracking />,
    left: 86,
    top: 24,
    depth: 0.9,
    drift: "soft",
    duration: 14,
    scale: 0.98,
    delayIn: 0.85,
  },
  {
    id: "budget",
    label: "₱248,000 released",
    sub: "Budget tracked",
    icon: <IconBudget />,
    left: 82,
    top: 52,
    depth: 1.2,
    drift: "wide",
    duration: 16,
    scale: 1,
    delayIn: 1.05,
  },
  {
    id: "verified",
    label: "Document Verified",
    sub: "Feedback returned to LSG",
    icon: <IconVerification />,
    left: 88,
    top: 74,
    depth: 0.7,
    drift: "soft",
    duration: 12,
    scale: 0.95,
    delayIn: 1.25,
  },
];

export function Hero() {
  return (
    <section
      id="top"
      data-tour="landing-hero"
      className="grain relative isolate overflow-hidden pt-[4.25rem]"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <ShaderField strength={1} scale={1.45} speed={0.03} />
        <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_0%,transparent_35%,rgba(250,250,247,0.72)_78%,var(--color-canvas)_100%)]" />
        <div className="absolute inset-x-0 top-[4.25rem] h-28 bg-gradient-to-b from-canvas/85 to-transparent" />
      </div>

      <FloatingField chips={CHIPS} range={30} hideBelow="lg" />

      <div className="relative z-10 mx-auto max-w-[82rem] px-5 pt-16 pb-24 sm:px-8 lg:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="animate-float-in eyebrow inline-flex items-center gap-2.5 rounded-full border border-line-strong/80 bg-paper/70 px-3.5 py-1.5 backdrop-blur-md">
            <span className="relative flex size-1.5">
              <span
                className="absolute inline-flex size-full rounded-full bg-brass"
                style={{ animation: "sg-pulse-ring 2.8s ease-out infinite" }}
              />
              <span className="relative inline-flex size-1.5 rounded-full bg-brass" />
            </span>
            Governance, centralized
          </p>

          <h1
            className="animate-float-in mt-7 font-display text-[2.75rem] leading-[1.03] font-medium tracking-[-0.032em] text-ink-deep sm:text-[3.75rem] lg:text-[4.5rem]"
            style={{ animationDelay: "0.1s" }}
          >
            One system.
            <br />
            <span className="relative inline-block">
              <em
                className="not-italic"
                style={{ fontVariationSettings: '"SOFT" 60, "WONK" 1' }}
              >
                Every
              </em>{" "}
              student council.
            </span>
          </h1>

          <p
            className="animate-float-in mx-auto mt-7 max-w-xl text-[1.0625rem] leading-relaxed text-body sm:text-[1.125rem]"
            style={{ animationDelay: "0.2s" }}
          >
            SmartGov unifies your University Student Government and every local
            council beneath it — one place to submit, verify, approve, and track
            resolutions, budgets, and records.
          </p>

          <div
            data-tour="landing-hero-cta"
            className="animate-float-in mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
            style={{ animationDelay: "0.3s" }}
          >
            <ButtonLink href="/create" size="lg" className="w-full sm:w-auto">
              Get Started
              <IconArrowRight className="h-4.5 w-4.5 transition-transform duration-500 group-hover:translate-x-1" />
            </ButtonLink>
            <a href="#governance" className={buttonClasses("outline", "lg", "w-full sm:w-auto")}>
              See how it works
            </a>
          </div>

          <p
            className="animate-float-in mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[0.8125rem] text-muted"
            style={{ animationDelay: "0.4s" }}
          >
            <span className="inline-flex items-center gap-1.5">
              <IconPyramid className="h-4 w-4 text-brass" />
              Federated &amp; unitary ready
            </span>
            <span className="inline-flex items-center gap-1.5">
              <IconClock className="h-4 w-4 text-brass" />
              Set up in about four minutes
            </span>
          </p>
        </div>

        <div
          className="animate-float-in mx-auto mt-16 max-w-5xl lg:mt-20"
          style={{ animationDelay: "0.5s" }}
        >
          <HeroConsole />
        </div>
      </div>
    </section>
  );
}
