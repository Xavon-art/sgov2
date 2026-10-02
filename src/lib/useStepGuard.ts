"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useOrgDraft, validateStep } from "@/lib/store";
import { STEPS, previousStep, stepAppliesTo, type StepId } from "@/lib/steps";

/**
 * Sends the user back to the first step they have not completed yet.
 * Runs after hydration so it never redirects during SSR.
 *
 * The draft is in memory only, so a reload lands here with nothing filled in
 * and every completed step reads as incomplete -- which is the point: a refresh
 * drops the person back at the top of the wizard.
 */
export function useStepGuard(step: StepId) {
  const router = useRouter();
  const draft = useOrgDraft();

  useEffect(() => {    const state = {
      model: draft.model,
      account: draft.account,
      institution: draft.institution,
      organizationName: draft.organizationName,
      organizationDescription: draft.organizationDescription,
      academicYear: draft.academicYear,
      units: draft.units,
    };

    for (const s of STEPS) {
      if (s.id === step) break;
      // Verification and activation are driven by the database rather than by
      // the draft, so the draft's shape says nothing about whether they are
      // reachable. Stop before them.
      if (s.id === "verification") break;
      // A step this model does not have cannot be incomplete, so it must not
      // send a unitary draft back to a page about a structure it lacks.
      if (!stepAppliesTo(s.id, draft.model)) continue;
      if (validateStep(s.id, state).length > 0) {
        router.replace(s.path);
        return;
      }
    }

    // Nothing links to a step the model does not have and Continue skips over
    // it, so arriving on one means a stale URL or a hand-edited draft rather
    // than a place the flow can be.
    if (!stepAppliesTo(step, draft.model)) {
      router.replace(previousStep(step, draft.model)?.path ?? STEPS[0].path);
    }
  }, [step, router, draft]);
}
