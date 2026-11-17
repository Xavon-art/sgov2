import type { PageTour } from "../types";

export const createUnitsTour: PageTour = {
  id: "create-units",
  version: "1",
  route: "/create/units",
  label: "Name your organization",
  steps: [
    {
      target: "org-name",
      title: "Organization name",
      body: "Give your student government a clear name that students will recognize.",
      placement: "right",
    },
    {
      target: "org-description",
      title: "Description",
      body: "Write a short description of who your council represents and what it does.",
      placement: "right",
    },
    {
      target: "academic-year",
      title: "Academic year",
      body: "Choose the academic year this charter will cover.",
      placement: "bottom",
    },
    {
      target: "flow-progress",
      title: "Progress",
      body: "Check this indicator to see how many setup steps remain.",
      placement: "bottom",
    },
  ],
};

export default createUnitsTour;
