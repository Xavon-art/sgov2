import type { PageTour } from "../types";

export const lsgManageTour: PageTour = {
  id: "lsg-manage",
  version: "1",
  route: "/lsg/manage",
  label: "Manage your council",
  roles: ["lsg"],
  steps: [
    {
      target: "workspace-nav",
      title: "Manage in the sidebar",
      body: "Click Manage in the sidebar to expand its sections. Click it again to collapse them.",
      placement: "right",
    },
    {
      target: "workspace-nav",
      title: "Everything under Manage",
      body: "Documents, Budget, and Feedback are sidebar links here — no duplicate tabs on the page.",
      placement: "right",
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
