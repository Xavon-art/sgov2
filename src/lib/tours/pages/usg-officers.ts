import type { PageTour } from "../types";

export const usgOfficersTour: PageTour = {
  id: "usg-officers",
  version: "1",
  route: "/usg/officers",
  label: "Council officers",
  roles: ["usg"],
  steps: [
    {
      target: "officers-panel",
      title: "Officer panel",
      body: "This panel summarizes the officers currently serving in your council.",
      placement: "bottom",
    },
    {
      target: "officers-table",
      title: "Officer list",
      body: "Review officer names, positions, and contact details in this table.",
      placement: "top",
    },
  ],
};

export default usgOfficersTour;
