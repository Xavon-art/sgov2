import type { PageTour } from "../types";

export const publicHomeTour: PageTour = {
  id: "public-home",
  version: "1",
  route: "/",
  label: "Welcome to SmartGov",
  roles: ["public"],
  steps: [
    {
      target: "landing-nav",
      title: "Top navigation",
      body: "Use these links to learn about the platform, sign in, or open the public survey.",
      placement: "bottom",
    },
    {
      target: "landing-hero",
      title: "What this site does",
      body: "SmartGov helps student councils plan work, run surveys, and keep their structure up to date.",
      placement: "bottom",
    },
    {
      target: "landing-hero-cta",
      title: "Get started",
      body: "Select this button to begin setting up a new council workspace or to sign in.",
      placement: "bottom",
      advanceOnClick: true,
    },
    {
      target: "landing-features",
      title: "Key features",
      body: "This section highlights the main tools available to student governments and their members.",
      placement: "top",
    },
  ],
};

export default publicHomeTour;
