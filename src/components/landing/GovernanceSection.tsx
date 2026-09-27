"use client";

import { useState } from "react";
import Link from "next/link";
import { Reveal } from "@/components/fx/Reveal";
import { Section } from "@/components/landing/Section";
import { OrgDiagram } from "@/components/ui/OrgDiagram";
import { buttonClasses } from "@/components/ui/Button";
import { IconArrowRight, IconLayers, IconPyramid } from "@/components/ui/Icons";
import { cn } from "@/lib/utils";

type Model = "federated" | "unitary";

const DETAIL: Record<
  Model,
  {
    name: string;
    alias: string;
    icon: React.ReactNode;
    summary: string;
    points: string[];
    fit: string;
  }
> = {
  federated: {
    name: "Federated",
    alias: "Decentralized",
    icon: <IconLayers className="h-4 w-4" />,
    summary:
      "A University Student Government sits at the top, with a Local Student Government under every college, department, or satellite campus. Each LSG keeps its own officers, budget, and projects, and reports upward under one shared constitution.",
    points: [
      "One LSG per college, department, or satellite campus",
      "Separate officer sets and separate budgets per council",
      "Submissions route upward: LSG → USG for decision",
      "Adds the LSG tier to your SmartGov org chart and roles",
    ],
    fit: "Large multi-campus or multi-college universities",
  },
  unitary: {
    name: "Unitary",
    alias: "Centralized",
    icon: <IconPyramid className="h-4 w-4" />,
    summary:
      "A single governing body serves the whole institution. College and campus representatives sit inside that one council instead of operating as separate local governments — one constitution, one budget, one set of officers.",
    points: [
      "No local tier — every representative sits on one council",
      "A single officer set and a single shared budget",
      "Submissions route straight to the administration",
      "No LSG roles are created in your SmartGov workspace",
    ],
    fit: "Smaller schools and single-campus institutions",
  },
};

const ROWS: Array<{ label: string; federated: string; unitary: string }> = [
  {
    label: "Top body",
    federated: "University Student Government (USG)",
    unitary: "Student Council",
  },
  {
    label: "Lower tier",
    federated: "One LSG per college / campus",
    unitary: "None",
  },
  {
    label: "Officers",
    federated: "USG set + LSG sets",
    unitary: "One council set",
  },
  {
    label: "Budgets",
    federated: "Allocated per council",
    unitary: "One shared budget",
  },
  {
    label: "Submission route",
    federated: "LSG → USG",
    unitary: "Council → Administration",
  },
  {
    label: "SmartGov roles",
    federated: "USG Officer · LSG Officer",
    unitary: "Council Officer",
  },
  {
    label: "Best for",
    federated: "Multi-campus universities",
    unitary: "Single-campus institutions",
  },
];

export function GovernanceSection() {
  const [model, setModel] = useState<Model>("federated");
  const detail = DETAIL[model];

  return (
    <Section
      id="governance"
      tone="sunk"
      eyebrow="Governance models"
      title="Two structures. One system that fits either."
      lede="Every university governs itself differently. You choose how yours works during setup, and SmartGov shapes your org chart, roles, and approval flow around it."
    >
      <Reveal className="mt-12 flex justify-center">
        <div
          role="tablist"
          aria-label="Governance model"
          className="relative inline-flex rounded-full border border-line-strong/80 bg-paper/70 p-1 backdrop-blur-md"
        >
          <span
            aria-hidden
            className="absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-ink transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{
              transform:
                model === "federated" ? "translateX(0)" : "translateX(100%)",
            }}
          />
          {(["federated", "unitary"] as Model[]).map((m) => (
            <button
              key={m}
              role="tab"
              type="button"
              aria-selected={model === m}
              onClick={() => setModel(m)}
              className={cn(
                "relative z-10 rounded-full px-5 py-2.5 text-[0.8125rem] font-medium transition-colors duration-400 sm:px-7 sm:text-[0.875rem]",
                model === m ? "text-white" : "text-ink-soft hover:text-ink",
              )}
            >
              {DETAIL[m].name}
              <span
                className={cn(
                  "ml-2 hidden text-[0.6875rem] tracking-wide sm:inline",
                  model === m ? "text-white/60" : "text-faint",
                )}
              >
                / {DETAIL[m].alias}
              </span>
            </button>
          ))}
        </div>
      </Reveal>

      <div className="mt-12 grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8">
        <Reveal
          key={`diagram-${model}`}
          variant="scale"
          className="relative overflow-hidden rounded-2xl border border-line bg-paper/80 p-6 sm:p-8"
        >
          <div
            aria-hidden
            className="hairline-grid absolute inset-0 opacity-50"
          />
          <div className="relative flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-full border border-brass/45 bg-brass-soft/45 text-brass-deep">
              {detail.icon}
            </span>
            <div>
              <p className="text-[0.9375rem] font-semibold text-ink-deep">
                {detail.name} structure
              </p>
              <p className="text-[0.6875rem] text-muted">{detail.fit}</p>
            </div>
          </div>

          <div key={`d-${model}`} className="animate-float-in relative mt-6">
            <OrgDiagram
              model={model}
              active
              accent={model === "federated" ? "#16324f" : "#1e4d6b"}
            />
          </div>
        </Reveal>

        <Reveal delay={0.08} className="flex flex-col justify-center">
          <div key={`t-${model}`} className="animate-float-in">
            <p className="text-[1.0625rem] leading-relaxed text-body">
              {detail.summary}
            </p>
            <ul className="mt-7 flex flex-col gap-3.5">
              {detail.points.map((point, i) => (
                <li
                  key={point}
                  className="flex gap-3 text-[0.9375rem] leading-snug text-ink"
                  style={{ animationDelay: `${i * 70}ms` }}
                >
                  <span
                    aria-hidden
                    className="mt-[0.55rem] size-1 shrink-0 rounded-full bg-brass"
                  />
                  {point}
                </li>
              ))}
            </ul>

            <Link
              href="/create/governance-model"
              className={buttonClasses("outline", "md", "mt-8")}
            >
              Choose this model
              <IconArrowRight className="h-4 w-4 transition-transform duration-400 group-hover:translate-x-0.5" />
            </Link>
          </div>
        </Reveal>
      </div>

      <Reveal className="mt-14">
        <div className="overflow-hidden rounded-2xl border border-line bg-paper/70">
          <div className="grid grid-cols-[1.1fr_1fr_1fr] gap-px bg-line">
            <div className="bg-canvas/60 px-4 py-3.5 sm:px-6">
              <p className="eyebrow">Comparison</p>
            </div>
            <div className="bg-canvas/60 px-4 py-3.5 sm:px-6">
              <p className="text-[0.75rem] font-semibold text-ink-deep">
                Federated
              </p>
            </div>
            <div className="bg-canvas/60 px-4 py-3.5 sm:px-6">
              <p className="text-[0.75rem] font-semibold text-ink-deep">
                Unitary
              </p>
            </div>

            {ROWS.map((row) => (
              <div key={row.label} className="contents">
                <div className="bg-paper px-4 py-3.5 sm:px-6">
                  <p className="text-[0.75rem] leading-snug font-medium text-muted">
                    {row.label}
                  </p>
                </div>
                <div
                  className={cn(
                    "bg-paper px-4 py-3.5 transition-colors duration-500 sm:px-6",
                    model === "federated" && "bg-brass-soft/12",
                  )}
                >
                  <p className="text-[0.75rem] leading-snug font-medium text-ink">
                    {row.federated}
                  </p>
                </div>
                <div
                  className={cn(
                    "bg-paper px-4 py-3.5 transition-colors duration-500 sm:px-6",
                    model === "unitary" && "bg-brass-soft/12",
                  )}
                >
                  <p className="text-[0.75rem] leading-snug font-medium text-ink">
                    {row.unitary}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
