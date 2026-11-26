import type { PageTour } from "../types";

export const lsgSurveysTour: PageTour = {
  id: "lsg-surveys",
  version: "1",
  route: "/lsg/forms",
  label: "Forms",
  roles: ["lsg"],
  steps: [
    {
      target: "forms-header",
      title: "Forms page",
      body: "Create and manage surveys and feedback forms for students and council members here.",
      placement: "bottom",
    },
    {
      target: "forms-create",
      title: "Create form",
      body: "Select this area to start a new survey or feedback form.",
      placement: "bottom",
      advanceOnClick: true,
    },
    {
      target: "forms-list",
      title: "Form list",
      body: "Open a form from this list to see responses or edit questions.",
      placement: "top",
    },
  ],
};

export default lsgSurveysTour;
