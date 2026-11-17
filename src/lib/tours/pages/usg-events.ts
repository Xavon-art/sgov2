import type { PageTour } from "../types";

export const usgEventsTour: PageTour = {
  id: "usg-events",
  version: "1",
  route: "/usg/events",
  label: "Council events",
  roles: ["usg"],
  steps: [
    {
      target: "events-header",
      title: "Events page",
      body: "Plan and review council activities from this page.",
      placement: "bottom",
    },
    {
      target: "events-toolbar",
      title: "Event tools",
      body: "Use the toolbar to filter or search for events.",
      placement: "bottom",
    },
    {
      target: "events-create",
      title: "Create event",
      body: "Select this button to add a new event to the council calendar.",
      placement: "bottom",
      advanceOnClick: true,
    },
    {
      target: "events-list",
      title: "Event list",
      body: "Upcoming and past events appear in this list with their dates.",
      placement: "top",
    },
  ],
};

export default usgEventsTour;
