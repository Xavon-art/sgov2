import type { PageTour } from "../types";

export const councilStructureTour: PageTour = {
  id: "council-structure",
  version: "1",
  route: "/my-council/structure",
  label: "Council structure",
  roles: ["lsg"],
  steps: [
    {
      target: "council-structure-header",
      title: "Structure page",
      body: "Review how your council is divided into units and positions.",
      placement: "bottom",
    },
    {
      target: "council-structure-workspace",
      title: "Structure workspace",
      body: "This area displays the current structure of your council.",
      placement: "bottom",
    },
    {
      target: "council-structure-shell",
      title: "Structure shell",
      body: "Use the controls on this panel to explore units and their positions.",
      placement: "left",
    },
  ],
};

export default councilStructureTour;
