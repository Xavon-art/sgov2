import type { PageTour } from "../types";

export const createReviewTour: PageTour = {
  id: "create-review",
  version: "1",
  route: "/create/review",
  label: "Review your charter",
  steps: [
    {
      target: "review-charter",
      title: "Charter summary",
      body: "Review the details you entered before you confirm your charter.",
      placement: "bottom",
    },
    {
      target: "review-sections",
      title: "Charter sections",
      body: "Each section collects one part of your council setup. Open a section to make changes.",
      placement: "right",
    },
    {
      target: "review-org-chart",
      title: "Organization chart",
      body: "This chart previews the units and positions that will be created with your charter.",
      placement: "left",
    },
    {
      target: "review-confirm",
      title: "Confirm charter",
      body: "Select this button when everything looks correct to finish your charter.",
      placement: "bottom",
      advanceOnClick: true,
    },
  ],
};

export default createReviewTour;
