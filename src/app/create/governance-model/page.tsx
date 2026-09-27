"use client";

import { useState } from "react";
import { StepShell } from "@/components/create/StepShell";
import { OrgDiagram } from "@/components/ui/OrgDiagram";
import { IconLayers, IconPyramid } from "@/components/ui/Icons";
import { useOrgDraft, type GovernanceModel } from "@/lib/store";
import { useStepForm } from "@/lib/useStepForm";
import { cn } from "@/lib/utils";

const MODELS: Array<{
  id: GovernanceModel;
  name: string;
  alias: string;
  headline: string;
  body: string;
  traits: string[];
}> = [
  {
    id: "federated",
    name: "Federated",
    alias: "Decentralized",
    headline: "USG + Local Student Governments",
    body: "A University Student Government at the top, with a Local Student Government under every college, department, or satellite campus. Each LSG keeps its own officers, budget, and projects, and reports upward under one shared constitution.",
    traits: [
      "Adds an LSG tier to your org chart",
      "Separate officers and budgets per council",
      "Submissions route LSG → USG",
      "Roles: USG Officer, LSG Officer",
    ],
  },
  {
    id: "unitary",
    name: "Unitary",
    alias: "Centralized",
    headline: "One council for the whole school",
    body: "A single governing body serves the entire institution. College and campus representatives sit inside that one council rather than operating as separate local governments — one constitution, one budget, one set of officers.",
    traits: [
      "No local tier in your org chart",
      "One officer set and one shared budget",
      "Submissions route to the administration",
      "Role: Council Officer",
    ],
  },
];

export default function GovernanceModelPage() {
  const draft = useOrgDraft();
  const { setModel } = draft;
  const { errors, showErrors, continueStep } = useStepForm(
    "governance-model",
    "/create/account",
  );
  const [hovered, setHovered] = useState<GovernanceModel | null>(null);

  return (
    <StepShell
      step="governance-model"
      title="How is your student government structured?"
      lede="This is the one decision that shapes everything after it — your org chart, your roles, and how approvals flow. You can add or restructure units later without changing this."
      errors={showErrors ? errors : []}
      onContinue={continueStep}
      continueLabel="Continue with this model"
    >
      <fieldset>
        <legend className="sr-only">Choose a governance model</legend>
        <div className="flex flex-col gap-4">
          {MODELS.map((model) => {
            const selected = draft.model === model.id;
            const active = selected || hovered === model.id;
            const Icon = model.id === "federated" ? IconLayers : IconPyramid;

            return (
              <label
                key={model.id}
                data-invalid={showErrors && !draft.model ? "true" : undefined}
                className={cn(
                  "group relative block cursor-pointer overflow-hidden rounded-2xl border bg-paper/55 p-5 transition-[border-color,box-shadow,transform,background-color] duration-500 ease-out hover:-translate-y-0.5 sm:p-6",
                  selected
                    ? "border-ink/30 bg-paper shadow-lift"
                    : "border-line hover:border-line-strong hover:shadow-lift",
                )}
                onMouseEnter={() => setHovered(model.id)}
                onMouseLeave={() => setHovered(null)}
              >
                <input
                  type="radio"
                  name="governance-model"
                  value={model.id}
                  checked={selected}
                  onChange={() => setModel(model.id)}
                  className="sr-only"
                />

                <span
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute inset-0 bg-gradient-to-br from-ink/[0.05] via-transparent to-brass/[0.07] opacity-0 transition-opacity duration-500",
                    active && "opacity-100",
                  )}
                />

                <span className="relative flex items-start gap-4">
                  <span
                    className={cn(
                      "mt-0.5 grid size-9 shrink-0 place-items-center rounded-full border transition-colors duration-500",
                      selected
                        ? "border-ink bg-ink text-white"
                        : "border-line-strong bg-canvas text-ink-soft",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                      <span className="font-display text-[1.25rem] leading-tight font-medium text-ink-deep sm:text-[1.375rem]">
                        {model.name}
                      </span>
                      <span className="text-[0.6875rem] font-semibold tracking-[0.16em] text-ink-muted uppercase">
                        / {model.alias}
                      </span>
                    </span>
                    <span className="mt-1 block text-[0.875rem] font-medium text-brass-deep">
                      {model.headline}
                    </span>
                  </span>

                  <span
                    className={cn(
                      "mt-1 grid size-5 shrink-0 place-items-center rounded-full border transition-all duration-400",
                      selected
                        ? "border-ink bg-ink text-white"
                        : "border-line-strong bg-canvas text-transparent",
                    )}
                  >
                    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none">
                      <path
                        d="m6 12.5 4 4 8-9"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </span>

                <span className="relative mt-4 block overflow-hidden rounded-xl border border-line/70 bg-canvas/45 px-3 py-2">
                  <OrgDiagram
                    model={model.id}
                    active={active}
                    accent={model.id === "federated" ? "#16324f" : "#1e4d6b"}
                  />
                </span>

                <span className="relative mt-4 block text-[0.875rem] leading-relaxed text-body">
                  {model.body}
                </span>

                <span className="relative mt-4 flex flex-wrap gap-2">
                  {model.traits.map((trait) => (
                    <span
                      key={trait}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[0.6875rem] font-medium transition-colors duration-500",
                        selected
                          ? "border-ink/20 bg-ink/[0.06] text-ink"
                          : "border-line-strong bg-canvas text-muted",
                      )}
                    >
                      {trait}
                    </span>
                  ))}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </StepShell>
  );
}
