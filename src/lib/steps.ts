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
    short: "Campus",
  },
  {
    id: "organization",
    label: "Organization",
    title: "Name your student organization",
    path: "/create/organization",
    short: "Org",
  },
  {
    id: "review",
    label: "Review",
    title: "Review your charter",
    path: "/create/review",
    short: "Review",
  },
  {
    id: "success",
    label: "Charter",
    title: "Charter granted",
    path: "/create/success",
    short: "Charter",
  },
] as const;

export type StepId = (typeof STEPS)[number]["id"];

export const FORM_STEP_COUNT = STEPS.length;

export function stepIndex(id: string) {
  return STEPS.findIndex((step) => step.id === id);
}
