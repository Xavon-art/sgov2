import type { PageTour } from "../types";

export const createGovernanceModelTour: PageTour = {
  id: "create-governance-model",
  version: "1",
  route: "/create/governance-model",
  label: "Choose a governance model",
  steps: [
    {
      target: "flow-progress",
      title: "Progress",
      body: "This indicator shows how far you are in the setup flow.",
      placement: "bottom",
    },
    {
      target: "model-choices",
      title: "Model choices",
      body: "Compare the available governance models before choosing the one that fits your institution.",
      placement: "bottom",
    },
    {
      target: "model-cards",
      title: "Available models",
      body: "Each card explains a different way to structure your council and its leadership.",
      placement: "top",
    },
    {
      target: "model-diagram",
      title: "Structure preview",
      body: "The diagram shows how positions connect under each governance model.",
      placement: "left",
    },
  ],
};

export default createGovernanceModelTour;
