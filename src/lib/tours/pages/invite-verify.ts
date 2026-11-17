import type { PageTour } from "../types";

export const inviteVerifyTour: PageTour = {
  id: "invite-verify",
  version: "1",
  route: "/invite/*/verify",
  label: "Verify your invitation",
  roles: ["public"],
  steps: [
    {
      target: "invite-verify-form",
      title: "Verify your invitation",
      body: "Enter the code we sent to your email to finish activating your account.",
      placement: "bottom",
    },
    {
      target: "invite-verify-code",
      title: "Verification code",
      body: "Type the full code from the email exactly as it appears.",
      placement: "right",
    },
    {
      target: "invite-verify-submit",
      title: "Confirm code",
      body: "Use this button to check your code and complete your invitation.",
      placement: "bottom",
      advanceOnClick: true,
    },
    {
      target: "invite-verify-resend",
      title: "Resend the code",
      body: "If the email did not arrive, use this button to request a fresh code.",
      placement: "right",
    },
  ],
};

export default inviteVerifyTour;
