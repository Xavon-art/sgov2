import type { PageTour } from "../types";

export const createAccountTour: PageTour = {
  id: "create-account",
  version: "1",
  route: "/create/account",
  label: "Create your account",
  steps: [
    {
      target: "account-full-name",
      title: "Full name",
      body: "Enter your full name as it should appear on council records.",
      placement: "right",
    },
    {
      target: "account-email",
      title: "Email address",
      body: "Use an email address you can access because it will be used for verification.",
      placement: "right",
    },
    {
      target: "account-password",
      title: "Password",
      body: "Choose a strong password to protect your administrator account.",
      placement: "right",
    },
    {
      target: "account-confirm-password",
      title: "Confirm password",
      body: "Type the same password again to confirm it is correct.",
      placement: "right",
    },
  ],
};

export default createAccountTour;
