import type { PageTour } from "../types";

export const usgSurveysTour: PageTour = {
  id: "usg-surveys",
  version: "1",
  route: "/usg/surveys",
  label: "Surveys",
  roles: ["usg"],
  steps: [
    {
      target: "surveys-header",
      title: "Surveys page",
      body: "Create and manage surveys for students and council members here.",
      placement: "bottom",
    },
    {
      target: "surveys-create",
      title: "Create survey",
      body: "Select this button to start a new survey.",
      placement: "bottom",
      advanceOnClick: true,
    },
    {
      target: "surveys-list",
      title: "Survey list",
      body: "Open a survey from this list to see responses or edit questions.",
      placement: "top",
    },
  ],
};

export default usgSurveysTour;
