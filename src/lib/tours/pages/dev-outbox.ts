import type { PageTour } from "../types";

export const devOutboxTour: PageTour = {
  id: "dev-outbox",
  version: "1",
  route: "/dev/outbox",
  label: "Development outbox",
  roles: ["usg", "lsg"],
  steps: [
    {
      target: "outbox-header",
      title: "Outbox",
      body: "This development page shows messages that the app has queued for delivery.",
      placement: "bottom",
    },
    {
      target: "outbox-list",
      title: "Message list",
      body: "Each row represents one queued message with its recipient and status.",
      placement: "right",
    },
    {
      target: "outbox-detail",
      title: "Message detail",
      body: "Select a message in the list to inspect its contents here.",
      placement: "left",
    },
  ],
};

export default devOutboxTour;
