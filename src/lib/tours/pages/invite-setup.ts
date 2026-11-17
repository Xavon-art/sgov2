import type { PageTour } from "../types";

export const inviteSetupTour: PageTour = {
  id: "invite-setup",
  version: "1",
  route: "/invite/*",
  label: "Invitation setup",
  roles: ["public"],
  steps: [
    {
      target: "invite-setup",
      title: "Invitation setup",
      body: "This page guides you through joining your council workspace as an invited officer.",
      placement: "bottom",
    },
    {
      target: "invite-details",
      title: "Your details",
      body: "Check your name and email address so your account is created correctly.",
      placement: "right",
    },
    {
      target: "invite-password",
      title: "Choose a password",
      body: "Create a strong password that you do not use on other sites.",
      placement: "right",
    },
    {
      target: "invite-continue",
      title: "Continue",
      body: "Select this button to save your details and move to code verification.",
      placement: "bottom",
      advanceOnClick: true,
    },
  ],
};

export default inviteSetupTour;
