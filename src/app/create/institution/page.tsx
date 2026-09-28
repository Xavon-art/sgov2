"use client";

import { useRef } from "react";
import { StepShell } from "@/components/create/StepShell";
import { TextField } from "@/components/ui/Field";
import { IconBuilding, IconUpload } from "@/components/ui/Icons";
import { useOrgDraft } from "@/lib/store";
import { pick, useStepForm } from "@/lib/useStepForm";
import { useStepGuard } from "@/lib/useStepGuard";

export default function InstitutionPage() {
  useStepGuard("institution");
  const draft = useOrgDraft();
  const { patchInstitution } = draft;
  const { errors, showErrors, continueStep } = useStepForm(
    "institution",
    "/create/organization",
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const federated = draft.model === "federated";
  const inst = draft.institution;

  return (
    <StepShell
      step="institution"
      title="Tell us about your institution"
      lede={
        federated
          ? "Your university sits at the top of the federated structure. You are registering as the USG, which sits above every local council."
          : "Your institution is served by a single student council, so campus and college fields are not needed."
      }
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

        {federated ? (
          <div className="flex items-start gap-3 rounded-xl border border-line-strong/80 bg-canvas/60 px-4 py-3.5">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brass" />
            <p className="text-[0.8125rem] leading-relaxed text-muted">
              You are registering as the University Student Government, so there
              is no campus to choose here — the USG sits above all of them. Once
              setup is done you can add your colleges and campuses, then invite
              a local council into each one.
            </p>
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-xl border border-line-strong/80 bg-canvas/60 px-4 py-3.5">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brass" />
            <p className="text-[0.8125rem] leading-relaxed text-muted">
              Because you chose a unitary model, SmartGov will not ask for
              campus or college units. There is no local tier to configure.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[0.8125rem] font-medium text-ink">
              University seal
            </span>
            <span className="text-[0.6875rem] font-medium tracking-[0.14em] text-faint uppercase">
              Optional
            </span>
          </div>

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="group flex w-full items-center gap-4 rounded-xl border border-dashed border-line-strong bg-canvas/40 px-4 py-5 text-left transition-colors duration-400 hover:border-brass/50 hover:bg-canvas/70"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-line-strong bg-paper text-ink-muted transition-colors duration-400 group-hover:border-brass/50 group-hover:text-brass-deep">
              <IconUpload className="h-4.5 w-4.5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[0.875rem] font-medium text-ink-deep">
                {inst.sealName || "Choose a seal or logo"}
              </span>
              <span className="mt-0.5 block text-[0.75rem] text-muted">
                {inst.sealName
                  ? "Click to choose a different file"
                  : "PNG or SVG · shown on your charter and dashboard"}
              </span>
            </span>
          </button>

          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/svg+xml,image/jpeg,image/webp"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) patchInstitution({ sealName: file.name });
            }}
          />

          <p className="text-[0.6875rem] leading-relaxed text-faint">
            File uploads are a placeholder in this build — your selection is
            recorded, not uploaded.
          </p>
        </div>
      </div>
    </StepShell>
  );
}
