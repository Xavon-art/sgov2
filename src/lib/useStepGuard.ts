"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useOrgDraft, validateStep } from "@/lib/store";
import { STEPS, type StepId } from "@/lib/steps";

/**
 * Sends the user back to the first step they have not completed yet.
 * Runs after hydration so it never redirects during SSR.
 */
export function useStepGuard(step: StepId) {
  const router = useRouter();
  const draft = useOrgDraft();

  useEffect(() => {
    if (!useOrgDraft.persist.hasHydrated()) return;

    const state = {
      model: draft.model,
      account: draft.account,
      institution: draft.institution,
      organization: draft.organization,
      units: draft.units,
    };

    for (const s of STEPS) {
      if (s.id === step) break;
      if (s.id === "success") break;
      if (validateStep(s.id, state).length > 0) {
        router.replace(s.path);
        return;
      }
    }
  }, [step, router, draft]);
}
