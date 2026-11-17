import type { PageTour } from "../types";

export const myCouncilTour: PageTour = {
  id: "my-council",
  version: "1",
  route: "/my-council",
  label: "My council",
  roles: ["lsg"],
  steps: [
    {
      target: "my-council-header",
      title: "My council",
      body: "This page gives you a quick view of your council and its leadership.",
      placement: "bottom",
    },
    {
      target: "my-council-root",
      title: "Council root",
      body: "The top card represents your council as a whole.",
      placement: "bottom",
    },
    {
      target: "my-council-units",
      title: "Units",
      body: "These sections show the units and positions within your council.",
      placement: "top",
    },
    {
      target: "my-council-actions",
      title: "Council actions",
      body: "Use these actions to open the full structure view or contact your officers.",
      placement: "right",
    },
  ],
};

export default myCouncilTour;
