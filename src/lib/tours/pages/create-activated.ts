import type { PageTour } from "../types";

export const createActivatedTour: PageTour = {
  id: "create-activated",
  version: "1",
  route: "/create/activated",
  label: "Workspace activated",
  steps: [
    {
      target: "activated-summary",
      title: "Activation summary",
      body: "This panel confirms that your council workspace is active and ready to use.",
      placement: "bottom",
    },
    {
      target: "activated-sign-in",
      title: "Sign in",
      body: "Use this button to sign in with your new administrator account.",
      placement: "bottom",
      advanceOnClick: true,
    },
    {
      target: "activated-home",
      title: "Go to home",
      body: "Select this link to visit the public home page.",
      placement: "bottom",
    },
    {
      target: "flow-header",
      title: "Setup header",
      body: "The setup flow is complete. The header now offers links to your new workspace.",
      placement: "bottom",
    },
  ],
};

export default createActivatedTour;
