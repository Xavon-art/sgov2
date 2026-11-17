import type { PageTour } from "../types";

export const createInstitutionTour: PageTour = {
  id: "create-institution",
  version: "1",
  route: "/create/institution",
  label: "Institution details",
  steps: [
    {
      target: "institution-university",
      title: "University",
      body: "Enter the name of your university as it appears on official documents.",
      placement: "right",
    },
    {
      target: "institution-campus",
      title: "Campus",
      body: "Add your campus name if your university has more than one campus.",
      placement: "right",
    },
    {
      target: "institution-college",
      title: "College",
      body: "Add your college or faculty name so students can identify your council.",
      placement: "right",
    },
    {
      target: "flow-header",
      title: "Setup header",
      body: "You can return to an earlier step at any time using the header controls.",
      placement: "bottom",
    },
  ],
};

export default createInstitutionTour;
