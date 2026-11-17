import type { PageTour } from "../types";

export const createVerificationTour: PageTour = {
  id: "create-verification",
  version: "1",
  route: "/create/verification",
  label: "Verify your email",
  steps: [
    {
      target: "verification-status",
      title: "Verification status",
      body: "This area tells you whether your email address has been verified yet.",
      placement: "bottom",
    },
    {
      target: "verification-progress",
      title: "Progress",
      body: "Follow this indicator to see what is left before activation.",
      placement: "bottom",
    },
    {
      target: "verification-email-card",
      title: "Verification email",
      body: "Check the card for the address where your verification code was sent.",
      placement: "right",
    },
    {
      target: "verification-resend",
      title: "Resend code",
      body: "Use this button if you need another verification email.",
      placement: "right",
    },
  ],
};

export default createVerificationTour;
