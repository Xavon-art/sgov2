import type { PageTour } from "../types";

export const usgManageTour: PageTour = {
  id: "usg-manage",
  version: "1",
  route: "/usg/manage",
  label: "Manage your council",
  roles: ["usg"],
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
      target: "manage-people",
      title: "People and units",
      body: "Units, officers, invitations, and feedback access live in one owner-only view.",
      placement: "bottom",
    },
    {
      target: "manage-structure",
      title: "Structure settings",
      body: "Use this area to manage units and leadership positions for your council.",
      placement: "left",
    },
  ],
};

export default usgManageTour;
