import type { PageTour } from "../types";

export const councilStructureTour: PageTour = {
  id: "council-structure",
  version: "2",
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
      target: "structure-mode",
      title: "Chart or form",
      body: "Build your officers on the chart, or switch to the classic form. Your draft saves while you work.",
      placement: "bottom",
    },
    {
      target: "structure-chart",
      title: "Arrange your officers",
      body: "Drag a seat onto another to set who it reports to. Choose a format, theme, and size before you submit for review.",
      placement: "top",
    },
    {
      target: "council-structure-shell",
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
