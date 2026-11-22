"use client";

import { StepShell } from "@/components/create/StepShell";
import { TextArea, TextField } from "@/components/ui/Field";
import { IconPyramid, IconSparkle } from "@/components/ui/Icons";
import { useOrgDraft } from "@/lib/store";
import { pick, useStepForm } from "@/lib/useStepForm";
import { useStepGuard } from "@/lib/useStepGuard";
import { cn } from "@/lib/utils";

const MAX_DESCRIPTION = 220;

function suggestedYears() {
  const now = new Date().getFullYear();
  return [
    `${now} – ${now + 1}`,
    `${now + 1} – ${now + 2}`,
    `${now - 1} – ${now}`,
  ];
}

/**
 * Names the organization and fixes its charter year.
 *
 * This step used to declare the local councils as well. A centralized
 * organization needs no local tier at all, and a federated one starts as its
 * USG alone: colleges, campuses, and departments are added from the org chart
 * afterwards, which is also the only place that can attach an officer to one.
 */
export default function UnitsPage() {
  useStepGuard("units");
  const org = useOrgDraft();
  const { patchOrganization } = org;
  const { errors, showErrors, continueStep } = useStepForm(
    "units",
    "/create/review",
  );

  return (
    <StepShell
      step="units"
      title="Name your organization"
      lede="This is the name your officers will see across SmartGov. Centralized organizations run as one council with no LSG tier; federated colleges, campuses, and departments are added later from your org chart."
      errors={showErrors ? errors : []}
      onContinue={continueStep}
      continueLabel="Review everything"
    >
      <div className="flex flex-col gap-6">
        <TextField
          data-tour="org-name"
          id="orgName"
          label="Student organization name"
          placeholder="University Student Government"
          icon={<IconPyramid />}
          value={org.organizationName}
          onChange={(e) => patchOrganization({ organizationName: e.target.value })}
          error={pick(errors, showErrors, "organization's name")}
        />

        <TextArea
          data-tour="org-description"
          id="orgDescription"
          label="Short description"
          placeholder="The University Student Government represents the entire student body, coordinates the local councils beneath it, and oversees the annual student budget."
          maxLength={MAX_DESCRIPTION}
          charCount={{ value: org.organizationDescription.length, max: MAX_DESCRIPTION }}
          value={org.organizationDescription}
          onChange={(e) => patchOrganization({ organizationDescription: e.target.value })}
          error={pick(errors, showErrors, "short description")}
          hint="One or two sentences. Officers and councils see this in their directory."
        />

        <div className="flex flex-col gap-2.5">
          <TextField
            data-tour="academic-year"
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
                  org.academicYear === year
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
          data-invalid={
            showErrors && pick(errors, showErrors, "academic year") ? "true" : undefined
          }
          className="flex items-start gap-3 rounded-xl border border-brass/30 bg-brass-soft/20 px-4 py-3.5"
        >
          <IconSparkle className="mt-0.5 h-4 w-4 shrink-0 text-brass-deep" />
          <p className="text-[0.8125rem] leading-relaxed text-ink">
            This organization will be chartered for{" "}
            <span className="font-semibold">
              {org.academicYear.trim() || "the academic year you set"}
            </span>
            . Centralized councils work as one tier; federated LSG units are added from the org chart once you are inside.
          </p>
        </div>
      </div>
    </StepShell>
  );
}