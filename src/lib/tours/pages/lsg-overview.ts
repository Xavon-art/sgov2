import type { PageTour } from "../types";

export const lsgOverviewTour: PageTour = {
  id: "lsg-overview",
  version: "2",
  route: "/lsg",
  label: "LSG workspace overview",
  roles: ["lsg"],
  autoStart: true,
  steps: [
    {
      target: "workspace-header",
      title: "Workspace header",
      body: "This header shows your council and gives you quick access to help and account options.",
      placement: "bottom",
    },
    {
      target: "workspace-tiles",
      title: "Workspace tiles",
      body: "Each tile opens a major area of your workspace, such as requests, messages, or surveys.",
      placement: "bottom",
    },
    {
      target: "workspace-customize",
      title: "Customize workspace",
      body: "Use this control to arrange the tiles so the tools you use most are easy to find.",
      placement: "left",
    },
    {
      target: "workspace-widgets",
      title: "Reports and signals",
      body: "These widgets summarize what your unit must file and what you have sent back. Use Customize to hide the ones you do not need.",
      placement: "top",
    },
    {
      target: "workspace-shortcuts",
      title: "Shortcuts",
      body: "These shortcuts take you directly to common tasks without opening another page.",
      placement: "top",
    },
  ],
};

export default lsgOverviewTour;
