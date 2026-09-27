"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useOrgDraft, validateStep } from "@/lib/store";
import type { StepId } from "@/lib/steps";

export function pick(
  errors: string[],
  show: boolean,
  needle: string,
): string | undefined {
  if (!show) return undefined;
  return errors.find((e) => e.toLowerCase().includes(needle));
}

export function useStepForm(step: StepId, nextPath: string) {
  const router = useRouter();
  const draft = useOrgDraft();
  const [showErrors, setShowErrors] = useState(false);

  const errors = validateStep(step, draft);

  const continueStep = useCallback(() => {
    if (errors.length > 0) {
      setShowErrors(true);
      window.requestAnimationFrame(() => {
        document
          .querySelector('[data-invalid="true"]')
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    router.push(nextPath);
  }, [errors.length, nextPath, router]);

  return { draft, errors, showErrors, continueStep };
}
