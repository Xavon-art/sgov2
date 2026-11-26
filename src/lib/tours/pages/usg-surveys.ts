import type { PageTour } from "../types";

export const usgSurveysTour: PageTour = {
  id: "usg-surveys",
  version: "1",
  route: "/usg/forms",
  label: "Forms",
  roles: ["usg"],
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

export default usgSurveysTour;
