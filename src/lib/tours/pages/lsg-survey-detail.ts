import type { PageTour } from "../types";

export const lsgSurveyDetailTour: PageTour = {
  id: "lsg-survey-detail",
  version: "1",
  route: "/lsg/surveys/*",
  label: "Survey details",
  roles: ["lsg"],
  steps: [
    {
      target: "survey-detail-header",
      title: "Survey details",
      body: "This header shows the survey title and current status.",
      placement: "bottom",
    },
    {
      target: "survey-public-link",
      title: "Public link",
      body: "Share this link with students so they can respond to the survey.",
      placement: "right",
    },
    {
      target: "survey-actions",
      title: "Survey actions",
      body: "Use these actions to edit, close, or delete the survey.",
      placement: "left",
    },
    {
      target: "survey-question-editor",
      title: "Question editor",
      body: "Add and arrange questions in this area before publishing the survey.",
      placement: "bottom",
    },
  ],
};

export default lsgSurveyDetailTour;
