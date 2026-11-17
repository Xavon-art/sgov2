import type { PageTour } from "../types";

export const lsgManageTour: PageTour = {
  id: "lsg-manage",
  version: "1",
  route: "/lsg/manage",
  label: "Manage your council",
  roles: ["lsg"],
  steps: [
    {
      target: "manage-tabs",
      title: "Manage tabs",
      body: "Use these tabs to switch between council details, your profile, and structure.",
      placement: "bottom",
    },
    {
      target: "manage-usg",
      title: "USG details",
      body: "This section shows information about the undergraduate student government you belong to.",
      placement: "bottom",
    },
    {
      target: "manage-profile",
      title: "Your profile",
      body: "Update your personal details and contact information here.",
      placement: "right",
    },
    {
      target: "manage-structure",
      title: "Structure",
      body: "View the units and positions that make up your council.",
      placement: "left",
    },
  ],
};

export default lsgManageTour;
