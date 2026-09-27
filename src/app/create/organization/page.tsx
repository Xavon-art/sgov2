"use client";

import { StepShell } from "@/components/create/StepShell";
import { TextArea, TextField } from "@/components/ui/Field";
import { IconCheck, IconPyramid, IconSparkle } from "@/components/ui/Icons";
import { ACCENTS, useOrgDraft } from "@/lib/store";
import { pick, useStepForm } from "@/lib/useStepForm";
import { useStepGuard } from "@/lib/useStepGuard";
import { cn } from "@/lib/utils";

const MAX_DESCRIPTION = 220;

function suggestedYears() {
  const now = new Date().getFullYear();
  const start = now <= new Date().getMonth() + 1 ? now : now;
  return [
    `${start} – ${start + 1}`,
    `${start + 1} – ${start + 2}`,
    `${start - 1} – ${start}`,
  ];
}

export default function OrganizationPage() {
  useStepGuard("organization");
  const draft = useOrgDraft();
  const { patchOrganization } = draft;
  const { errors, showErrors, continueStep } = useStepForm(
    "organization",
    "/create/review",
  );
  const org = draft.organization;

  return (
    <StepShell
      step="organization"
      title="Name your student organization"
      lede="This is the name your officers will see across SmartGov, and the name that appears on your charter."
      errors={showErrors ? errors : []}
      onContinue={continueStep}
      continueLabel="Review everything"
    >
      <div className="flex flex-col gap-6">
        <TextField
          id="orgName"
          label="Student organization or council name"
          placeholder="University Student Government"
          icon={<IconPyramid />}
          value={org.name}
          onChange={(e) => patchOrganization({ name: e.target.value })}
          error={pick(errors, showErrors, "organization's name")}
        />

        <TextArea
          id="orgDescription"
          label="Short description"
          placeholder="The University Student Government represents the entire student body, coordinates the local councils beneath it, and oversees the annual student budget."
          maxLength={MAX_DESCRIPTION}
          charCount={{ value: org.description.length, max: MAX_DESCRIPTION }}
          value={org.description}
          onChange={(e) => patchOrganization({ description: e.target.value })}
          error={pick(errors, showErrors, "short description")}
          hint="One or two sentences. Officers and councils see this in their directory."
        />

        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[0.8125rem] font-medium text-ink">
              Official color
            </span>
            <span className="text-[0.6875rem] font-medium tracking-[0.14em] text-faint uppercase">
              Cosmetic
            </span>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {ACCENTS.map((accent) => {
              const selected = org.accent === accent.value;
              return (
                <button
                  key={accent.value}
                  type="button"
                  onClick={() => patchOrganization({ accent: accent.value })}
                  aria-pressed={selected}
                  aria-label={accent.label}
                  className={cn(
                    "group relative grid size-9 place-items-center rounded-full border-2 transition-transform duration-400 hover:scale-110",
                    selected
                      ? "border-ink/45"
                      : "border-transparent",
                  )}
                  style={{ backgroundColor: accent.value }}
                >
                  {selected ? (
                    <IconCheck
                      className="h-4 w-4 text-white"
                      strokeWidth={2.4}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
          <p className="text-[0.75rem] text-muted">
            Used for your seal, badges, and document headers.
          </p>
        </div>

        <div className="rule" />

        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[0.8125rem] font-medium text-ink">
              Academic year
            </span>
            <span className="text-[0.6875rem] font-medium tracking-[0.14em] text-faint uppercase">
              Governing term
            </span>
          </div>

          <TextField
            id="academicYear"
            label="Academic year"
            srLabel
            placeholder="2026 – 2027"
            value={org.academicYear}
            onChange={(e) => patchOrganization({ academicYear: e.target.value })}
            error={pick(errors, showErrors, "academic year")}
          />

          <div className="flex flex-wrap gap-2">
            {suggestedYears().map((year) => (
              <button
                key={year}
                type="button"
                onClick={() => patchOrganization({ academicYear: year })}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[0.75rem] font-medium transition-colors duration-300",
                  org.accent && org.academicYear === year
                    ? "border-ink/25 bg-ink/[0.07] text-ink"
                    : "border-line-strong bg-paper text-muted hover:border-ink/25 hover:text-ink",
                )}
              >
                {year}
              </button>
            ))}
          </div>
        </div>

        <div
          data-invalid={showErrors && pick(errors, showErrors, "academic year") ? "true" : undefined}
          className="flex items-start gap-3 rounded-xl border border-brass/30 bg-brass-soft/20 px-4 py-3.5"
        >
          <IconSparkle className="mt-0.5 h-4 w-4 shrink-0 text-brass-deep" />
          <p className="text-[0.8125rem] leading-relaxed text-ink">
            This organization will be chartered for{" "}
            <span className="font-semibold">
              {org.academicYear.trim() || "the academic year you set"}
            </span>
            {draft.model === "federated" ? (
              <>
                {" "}
                with an LSG tier under the University Student Government.
              </>
            ) : (
              " under a unitary structure."
            )}
          </p>
        </div>
      </div>
    </StepShell>
  );
}
