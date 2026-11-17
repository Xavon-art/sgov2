import type { PageTour } from "../types";

export const publicLoginTour: PageTour = {
  id: "public-login",
  version: "1",
  route: "/login",
  label: "Sign in",
  roles: ["public"],
  steps: [
    {
      target: "login-form",
      title: "Sign in form",
      body: "Enter the credentials for your council account to open your workspace.",
      placement: "right",
    },
    {
      target: "login-email",
      title: "Email address",
      body: "Use the email address you registered with your council.",
      placement: "right",
    },
    {
      target: "login-password",
      title: "Password",
      body: "Type your account password here. Passwords are case sensitive.",
      placement: "right",
    },
    {
      target: "login-submit",
      title: "Sign in",
      body: "Select this button to submit your credentials and continue to your workspace.",
      placement: "bottom",
      advanceOnClick: true,
    },
  ],
};

export default publicLoginTour;
