"use client";

import { useState } from "react";
import { StepShell } from "@/components/create/StepShell";
import { Button } from "@/components/ui/Button";
import { FieldShell, TextArea, TextField, control } from "@/components/ui/Field";
import { IconClose, IconLayers } from "@/components/ui/Icons";
import { useOrgDraft } from "@/lib/store";
import {
  UNIT_TYPE_LABELS,
  parseBulkUnits,
  type UnitType,
} from "@/lib/units";
import { pick, useStepForm } from "@/lib/useStepForm";
import { useStepGuard } from "@/lib/useStepGuard";
import { cn } from "@/lib/utils";

const TYPE_OPTIONS = Object.keys(UNIT_TYPE_LABELS) as UnitType[];

export default function UnitsPage() {
  useStepGuard("units");
  const draft = useOrgDraft();
  const { units, setUnits } = draft;
  const { errors, showErrors, continueStep } = useStepForm(
    "units",
    "/create/review",
  );
  const [name, setName] = useState("");
  const [type, setType] = useState<UnitType>("college");
  const [pasted, setPasted] = useState("");

  const empty = pick(errors, showErrors, "at least one");
  const duplicate = pick(errors, showErrors, "same name");

  const addUnit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setUnits([...units, { name: trimmed, type }]);
    setName("");
  };

  const applyPastedRoster = () => {
    const parsed = parseBulkUnits(pasted);
    if (!parsed.length) return;
    setUnits(parsed);
    setPasted("");
  };

  return (
    <StepShell
      step="units"
      title="What does your USG cover?"
      lede="Your colleges, campuses, and departments become the Local Student Governments under your organization."
      errors={showErrors ? errors : []}
      onContinue={continueStep}
      continueLabel="Review everything"
    >
      <div className="flex flex-col gap-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addUnit();
          }}
          className="grid gap-4 sm:grid-cols-[1fr_10.5rem_auto] sm:items-end sm:gap-3"
        >
          <TextField
            id="unitName"
            label="Unit name"
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
            Add unit
          </Button>
        </form>

        <div className="rule" />

        <div
          data-invalid={empty || duplicate ? "true" : undefined}
          className="flex flex-col gap-3"
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[0.8125rem] font-medium text-ink">
              Declared units
            </span>
            <span className="text-[0.6875rem] font-medium tracking-[0.14em] text-faint uppercase tabular-nums">
              {units.length} {units.length === 1 ? "unit" : "units"}
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
              Nothing declared yet. Add a unit above, or paste the roster you
              already have.
            </p>
          )}
        </div>

        <div className="rule" />

        <div className="flex flex-col gap-2.5">
          <TextArea
            id="pastedUnits"
            label="Paste a roster"
            placeholder={"College of Engineering\nBaguio Campus\nNursing Department"}
            className="font-mono"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            hint="One unit per line. A line may name its type after a dash — “College of Engineering — college” — and a bare name is read as a campus or a department when it says so."
          />

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={applyPastedRoster}
              disabled={!pasted.trim()}
            >
              Use this roster
            </Button>
            <p className="text-[0.75rem] text-muted">
              A pasted roster replaces everything above it.
            </p>
          </div>
        </div>
      </div>
    </StepShell>
  );
}
