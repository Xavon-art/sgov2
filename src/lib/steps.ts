import type { GovernanceModel } from "@/lib/store";

export const STEPS = [
  {
    id: "welcome",
    label: "Welcome",
    title: "Welcome",
    path: "/create",
    short: "Intro",
  },
  {
    id: "governance-model",
    label: "Governance Model",
    title: "Choose your governance model",
    path: "/create/governance-model",
    short: "Model",
  },
  {
    id: "account",
    label: "Your Account",
    title: "Create your administrator account",
    path: "/create/account",
    short: "Account",
  },
  {
    id: "institution",
    label: "Institution",
    title: "Tell us about your institution",
    path: "/create/institution",
    // Was "Campus", which stopped being true once the campus and college
    // fields were retired: a USG has no campus to name. The stepper is
    // lg-only, where there is room for the full word.
    short: "Institution",
  },
  {
    id: "units",
    label: "Organization & Units",
    title: "Name your organization and declare local councils",
    path: "/create/units",
    short: "Org & Units",
  },
  {
    id: "review",
    label: "Review",
    title: "Review your charter",
    path: "/create/review",
    short: "Review",
  },
  {
    id: "verification",
    label: "Verification",
    title: "Verify your email",
    path: "/create/verification",
    short: "Verify",
  },
  {
    id: "activated",
    label: "Activated",
    title: "Your USG is activated",
    path: "/create/activated",
    short: "Activated",
  },
] as const;

export type StepId = (typeof STEPS)[number]["id"];

export const FORM_STEP_COUNT = STEPS.length;

export function stepIndex(id: string) {
  return STEPS.findIndex((step) => step.id === id);
}

/**
 * The steps that exist under one governance model only.
 *
 * A unitary organization has no local tier, so it is never asked to declare
 * one. The record stays in STEPS so the federated flow keeps the ordinals the
 * rest of the wizard is written against, and everything that counts, links, or
 * steps through the list filters on this instead of special-casing the id.
 */
const MODEL_SCOPED: Partial<Record<StepId, readonly GovernanceModel[]>> = {
  units: ["federated"],
};

export function stepAppliesTo(id: StepId, model: GovernanceModel | null) {
  const models = MODEL_SCOPED[id];
  return !models || (model !== null && models.includes(model));
}

export function visibleSteps(model: GovernanceModel | null) {
  return STEPS.filter((step) => stepAppliesTo(step.id, model));
}

export function previousStep(id: StepId, model: GovernanceModel | null) {
  for (let i = stepIndex(id) - 1; i >= 0; i -= 1) {
    const step = STEPS[i];
    if (stepAppliesTo(step.id, model)) return step;
  }
  return null;
}
