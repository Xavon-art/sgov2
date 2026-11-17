import type { PageTour } from "../types";

export const orgChartTour: PageTour = {
  id: "org-chart",
  version: "1",
  route: "/org-chart",
  label: "Organization chart",
  roles: ["usg"],
  steps: [
    {
      target: "org-chart-header",
      title: "Organization chart",
      body: "This page shows the units and positions in your student government.",
      placement: "bottom",
    },
    {
      target: "org-chart-add-position",
      title: "Add position",
      body: "Use this button to create a new leadership position in the chart.",
      placement: "bottom",
      advanceOnClick: true,
    },
    {
      target: "org-chart-root",
      title: "Council root",
      body: "The top node represents your council as a whole.",
      placement: "bottom",
    },
    {
      target: "org-chart-units",
      title: "Units",
      body: "Each branch shows a unit and the positions that belong to it.",
      placement: "top",
    },
  ],
};

export default orgChartTour;
