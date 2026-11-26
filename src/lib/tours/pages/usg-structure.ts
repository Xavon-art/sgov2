import type { PageTour } from "../types";

export const usgStructureTour: PageTour = {
  id: "usg-structure",
  version: "2",
  route: "/structure/editor",
  label: "Council structure",
  roles: ["usg"],
  steps: [
    {
      target: "workspace-main",
      title: "Structure page",
      body: "This page shows how your student government is organized into units and positions.",
      placement: "bottom",
    },
    {
      target: "structure-mode",
      title: "Two ways to work",
      body: "Build on the chart or switch to the classic form. Drafts save themselves while you edit.",
      placement: "bottom",
    },
    {
      target: "structure-chart",
      title: "Arrange the chart",
      body: "Drag a seat onto another to set who it reports to, or onto an empty row to move it a tier. Pick a format, theme, and size above the chart.",
      placement: "top",
    },
    {
      target: "manage-structure",
      title: "Structure editor",
      body: "Use the editor to add, rename, or reorder units and leadership positions.",
      placement: "right",
    },
    {
      target: "structure-chart",
      title: "Change queue",
      body: "Changes wait here until they are reviewed and published to the council.",
      placement: "left",
    },
  ],
};

export default usgStructureTour;
