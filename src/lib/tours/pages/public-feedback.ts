import type { PageTour } from "../types";

export const publicFeedbackTour: PageTour = {
  id: "public-feedback",
  version: "1",
  route: "/feedback/f/*",
  label: "Public feedback",
  roles: ["public"],
  steps: [
    {
      target: "public-feedback-intro",
      title: "Feedback form",
      body: "Read the form title and description so you know what the organizer is asking about.",
      placement: "bottom",
    },
    {
      target: "public-feedback-questions",
      title: "Your answers",
      body: "Answer each question in the order shown. Required questions are marked with an asterisk.",
      placement: "top",
    },
    {
      target: "public-feedback-submit",
      title: "Send your response",
      body: "Check your answers, then submit once. The organizer receives the response immediately.",
      placement: "bottom",
      advanceOnClick: true,
    },
  ],
};

export default publicFeedbackTour;
