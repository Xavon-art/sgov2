import type { PageTour } from "../types";

export const usgStructureTour: PageTour = {
  id: "usg-structure",
  version: "1",
  route: "/usg/structure",
  label: "Council structure",
  roles: ["usg"],
  steps: [
    {
      target: "usg-structure-header",
      title: "Structure page",
      body: "This page shows how your student government is organized into units and positions.",
      placement: "bottom",
    },
    {
      target: "usg-structure-editor",
      title: "Structure editor",
      body: "Use the editor to add, rename, or reorder units and leadership positions.",
      placement: "right",
    },
    {
      target: "usg-structure-queue",
      title: "Change queue",
      body: "Changes wait here until they are reviewed and published to the council.",
      placement: "left",
    },
  ],
};

export default usgStructureTour;
