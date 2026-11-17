import type { PageTour } from "../types";

export const publicSurveyTour: PageTour = {
  id: "public-survey",
  version: "1",
  route: "/survey/*",
  label: "Public survey",
  roles: ["public"],
  steps: [
    {
      target: "public-survey-intro",
      title: "Survey introduction",
      body: "Read this introduction to understand why the council is asking for your feedback.",
      placement: "bottom",
    },
    {
      target: "public-survey-questions",
      title: "Survey questions",
      body: "Answer each question honestly. Your responses help the council make better decisions.",
      placement: "top",
    },
    {
      target: "public-survey-submit",
      title: "Submit your responses",
      body: "Review your answers, then use this button to send them to the council.",
      placement: "bottom",
      advanceOnClick: true,
    },
    {
      target: "public-survey-otp",
      title: "Verification code",
      body: "Enter the one-time code sent to your email to confirm that your response is valid.",
      placement: "top",
    },
  ],
};

export default publicSurveyTour;
