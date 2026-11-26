import type { PageTour } from "../types";

export const lsgOverviewTour: PageTour = {
  id: "lsg-overview",
  version: "3",
  route: "/lsg",
  label: "LSG workspace overview",
  roles: ["lsg"],
  autoStart: true,
  steps: [
    {
      target: "workspace-header",
      title: "Action desk",
      body: "This overview answers one question: what your unit must do next.",
      placement: "bottom",
    },
    {
      target: "workspace-tiles",
      title: "Status strip",
      body: "Each status opens the Request list already filtered to that status.",
      placement: "bottom",
    },
    {
      target: "workspace-overview-action",
      title: "Next action",
      body: "The earliest open deadline opens straight into the task and its thread.",
      placement: "bottom",
    },
    {
      target: "workspace-overview-list",
      title: "Due soon and decisions",
      body: "Deadlines and recent USG decisions are shown together so nothing waits unnoticed.",
      placement: "top",
    },
    {
      target: "workspace-overview-budget",
      title: "Unit budget",
      body: "Your budget snapshot links to the full unit budget workspace.",
      placement: "top",
    },
    {
      target: "workspace-shortcuts",
      title: "Shortcuts",
      body: "These shortcuts take you directly to the actions you repeat most.",
      placement: "top",
    },
  ],
};

export default lsgOverviewTour;
