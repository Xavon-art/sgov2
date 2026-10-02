"use client";

import { useState } from "react";
import { StepShell } from "@/components/create/StepShell";
import { Button } from "@/components/ui/Button";
import { FieldShell, TextArea, TextField, control } from "@/components/ui/Field";
import { IconClose, IconLayers, IconPyramid, IconSparkle } from "@/components/ui/Icons";
import { useOrgDraft } from "@/lib/store";
import { UNIT_TYPE_LABELS, type UnitType } from "@/lib/units";
import { pick, useStepForm } from "@/lib/useStepForm";
import { useStepGuard } from "@/lib/useStepGuard";
import { cn } from "@/lib/utils";

const MAX_DESCRIPTION = 220;

const TYPE_OPTIONS = Object.keys(UNIT_TYPE_LABELS) as UnitType[];

function suggestedYears() {
  const now = new Date().getFullYear();
  return [
    `${now} – ${now + 1}`,
    `${now + 1} – ${now + 2}`,
    `${now - 1} – ${now}`,
  ];
}

export default function UnitsPage() {
  useStepGuard("units");
  const draft = useOrgDraft();
  const { units, setUnits, patchOrganization } = draft;
  const { errors, showErrors, continueStep } = useStepForm(
    "units",
    "/create/review",
  );
  const [name, setName] = useState("");
  const [type, setType] = useState<UnitType>("college");

  const org = draft;

  const empty = pick(errors, showErrors, "at least one");
  const duplicate = pick(errors, showErrors, "same name");

  const addUnit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setUnits([...units, { name: trimmed, type }]);
    setName("");
  };

  return (
    <StepShell
      step="units"
      title="Name your organization and declare its local councils"
      lede="This is the name your officers will see across SmartGov. The colleges, campuses, and departments you add here become the Local Student Governments under your USG."
      errors={showErrors ? errors : []}
      onContinue={continueStep}
      continueLabel="Review everything"
    >
      <div className="flex flex-col gap-6">
        <TextField
          id="orgName"
          label="Student organization name"
          placeholder="University Student Government"
          icon={<IconPyramid />}
          value={org.organizationName}
          onChange={(e) => patchOrganization({ organizationName: e.target.value })}
          error={pick(errors, showErrors, "organization's name")}
        />

        <TextArea
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
          data-invalid={showErrors && pick(errors, showErrors, "academic year") ? "true" : undefined}
          className="flex items-start gap-3 rounded-xl border border-brass/30 bg-brass-soft/20 px-4 py-3.5"
        >
          <IconSparkle className="mt-0.5 h-4 w-4 shrink-0 text-brass-deep" />
          <p className="text-[0.8125rem] leading-relaxed text-ink">
            This organization will be chartered for{" "}
            <span className="font-semibold">
              {org.academicYear.trim() || "the academic year you set"}
            </span>{" "}
            with an LSG tier under the University Student Government.
          </p>
        </div>

        <div className="rule" />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            addUnit();
          }}
          className="grid gap-4 sm:grid-cols-[1fr_10.5rem_auto] sm:items-end sm:gap-3"
        >
          <TextField
            id="unitName"
            label="Local council name"
            placeholder="College of Engineering"
            icon={<IconLayers />}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <FieldShell id="unitType" label="Type">
            <select
              id="unitType"
              value={type}
              onChange={(e) => setType(e.target.value as UnitType)}
              className={cn(control, "h-12 cursor-pointer")}
            >
              {TYPE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {UNIT_TYPE_LABELS[option]}
                </option>
              ))}
            </select>
          </FieldShell>

          <Button
            type="submit"
            variant="outline"
            size="lg"
            disabled={!name.trim()}
            className="w-full sm:w-auto"
          >
            Add council
          </Button>
        </form>

        <div
          data-invalid={empty || duplicate ? "true" : undefined}
          className="flex flex-col gap-3"
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[0.8125rem] font-medium text-ink">
              Local Student Governments
            </span>
            <span className="text-[0.6875rem] font-medium tracking-[0.14em] text-faint uppercase tabular-nums">
              {units.length} {units.length === 1 ? "council" : "councils"}
            </span>
          </div>

          {empty || duplicate ? (
            <p role="alert" className="text-[0.75rem] font-medium text-[#a5442c]">
              {empty ?? duplicate}
            </p>
          ) : null}

          {units.length > 0 ? (
            <ul className="flex flex-col">
              {units.map((unit, i) => (
                <li
                  key={`${unit.type}-${unit.name}-${i}`}
                  className="flex items-center gap-3 border-b border-line/70 py-2.5 last:border-b-0"
                >
                  <span className="grid size-7 shrink-0 place-items-center rounded-full border border-line-strong bg-canvas text-ink-muted">
                    <IconLayers className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.875rem] text-ink-deep">
                      {unit.name}
                    </span>
                    <span className="mt-0.5 block text-[0.625rem] font-semibold tracking-[0.14em] text-faint uppercase">
                      {UNIT_TYPE_LABELS[unit.type]}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setUnits(units.filter((_, index) => index !== i))
                    }
                    aria-label={`Remove ${unit.name}`}
                    className="grid size-7 shrink-0 place-items-center rounded-full border border-transparent text-ink-muted transition-colors duration-300 hover:border-line-strong hover:text-ink"
                  >
                    <IconClose className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[0.75rem] leading-relaxed text-muted">
              Nothing declared yet. Add a council above.
            </p>
          )}
        </div>
      </div>
    </StepShell>
  );
}
