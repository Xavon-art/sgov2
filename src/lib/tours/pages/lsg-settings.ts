import type { PageTour } from "../types";

export const lsgSettingsTour: PageTour = {
  id: "lsg-settings",
  version: "1",
  route: "/lsg/settings",
  label: "Workspace settings",
  roles: ["lsg"],
  steps: [
    {
      target: "settings-header",
      title: "Settings page",
      body: "Manage your workspace and account preferences from this page.",
      placement: "bottom",
    },
    {
      target: "settings-workspace",
      title: "Workspace settings",
      body: "Update your council name and other workspace details here.",
      placement: "right",
    },
    {
      target: "settings-profile-link",
      title: "Profile link",
      body: "Follow this link to edit your personal profile.",
      placement: "right",
    },
    {
      target: "settings-session",
      title: "Session",
      body: "This section shows your current session and lets you sign out.",
      placement: "top",
    },
  ],
};

export default lsgSettingsTour;
