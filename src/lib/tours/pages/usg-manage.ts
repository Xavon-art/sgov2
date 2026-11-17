import type { PageTour } from "../types";

export const usgManageTour: PageTour = {
  id: "usg-manage",
  version: "1",
  route: "/usg/manage",
  label: "Manage your council",
  roles: ["usg"],
  steps: [
    {
      target: "manage-tabs",
      title: "Manage tabs",
      body: "Use these tabs to switch between members, invitations, and structure settings.",
      placement: "bottom",
    },
    {
      target: "manage-umbrella",
      title: "Umbrella organization",
      body: "This section shows the larger organization your council belongs to.",
      placement: "bottom",
    },
    {
      target: "manage-invites",
      title: "Invitations",
      body: "Invite new officers here and track who has accepted their invitation.",
      placement: "right",
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
