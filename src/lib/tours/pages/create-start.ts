import type { PageTour } from "../types";

export const createStartTour: PageTour = {
  id: "create-start",
  version: "1",
  route: "/create",
  label: "Create your council",
  roles: ["public"],
  steps: [
    {
      target: "flow-header",
      title: "Setup header",
      body: "This header shows where you are in the council setup flow and lets you leave at any time.",
      placement: "bottom",
    },
    {
      target: "create-welcome",
      title: "Welcome",
      body: "We will walk you through a few short steps to create your student government workspace.",
      placement: "bottom",
    },
    {
      target: "create-start",
      title: "Start setup",
      body: "Select this button to begin creating your council charter.",
      placement: "bottom",
      advanceOnClick: true,
    },
    {
      target: "create-step-list",
      title: "Setup checklist",
      body: "This list shows every step you will complete before your workspace is activated.",
      placement: "right",
    },
  ],
};

export default createStartTour;
