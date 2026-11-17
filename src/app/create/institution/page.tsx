"use client";

import { StepShell } from "@/components/create/StepShell";
import { TextField } from "@/components/ui/Field";
import { IconBuilding, IconCompass, IconLayers } from "@/components/ui/Icons";
import { useOrgDraft } from "@/lib/store";
import { pick, useStepForm } from "@/lib/useStepForm";
import { useStepGuard } from "@/lib/useStepGuard";

export default function InstitutionPage() {
  useStepGuard("institution");
  const draft = useOrgDraft();
  const { patchInstitution } = draft;
  const { errors, showErrors, continueStep } = useStepForm(
    "institution",
    "/create/units",
  );
  const inst = draft.institution;

  return (
    <StepShell
      step="institution"
      title="Tell us about your institution"
      lede="Your university sits at the top of the federated structure. You are registering as the USG, which sits above every local council."
      errors={showErrors ? errors : []}
      onContinue={continueStep}
    >
      <div className="flex flex-col gap-6">
        <TextField
          id="universityName"
          label="University name"
          autoComplete="organization"
          placeholder="Halcyon University"
          icon={<IconBuilding />}
          value={inst.universityName}
          onChange={(e) => patchInstitution({ universityName: e.target.value })}
          error={pick(errors, showErrors, "university's name")}
        />

        <div className="grid gap-6 sm:grid-cols-2">
          <TextField
            id="campusName"
            label="Main campus"
            autoComplete="address-level2"
            placeholder="Main Campus"
            icon={<IconCompass />}
            value={inst.campusName}
            onChange={(e) => patchInstitution({ campusName: e.target.value })}
            hint="Optional. Leave blank if your USG covers the whole university."
          />

          <TextField
            id="college"
            label="College or office"
            autoComplete="organization"
            placeholder="Office of Student Affairs"
            icon={<IconLayers />}
            value={inst.college}
            onChange={(e) => patchInstitution({ college: e.target.value })}
            hint="Optional. The unit your USG is attached to, if any."
          />
        </div>

        <div className="flex items-start gap-3 rounded-xl border border-line-strong/80 bg-canvas/60 px-4 py-3.5">
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brass" />
          <p className="text-[0.8125rem] leading-relaxed text-muted">
            You are registering the University Student Government, which sits above
            every local council. Add the colleges and satellite campuses from your
            org chart once setup is done, then invite a council officer into each
            one.
          </p>
        </div>
      </div>
    </StepShell>
  );
}
