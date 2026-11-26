import type { PageTour } from "../types";

export const usgOverviewTour: PageTour = {
  id: "usg-overview",
  version: "3",
  route: "/usg",
  label: "USG workspace overview",
  roles: ["usg"],
  autoStart: true,
  steps: [
    {
      target: "workspace-header",
      title: "Decision desk",
      body: "This overview answers one question: what needs your decision before the day ends.",
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
      title: "Needs review now",
      body: "Open the Review Queue from here to work the oldest submissions first.",
      placement: "bottom",
    },
    {
      target: "workspace-overview-list",
      title: "Where units are behind",
      body: "Overdue units and task submission progress point straight to the affected work.",
      placement: "top",
    },
    {
      target: "workspace-overview-budget",
      title: "University budget",
      body: "The budget snapshot links to the per-unit table where allocations are decided.",
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

export default usgOverviewTour;
