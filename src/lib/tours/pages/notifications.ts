import type { PageTour } from "../types";

export const notificationsTour: PageTour = {
  id: "notifications",
  version: "1",
  route: "/notifications",
  label: "Notifications",
  roles: ["usg", "lsg"],
  steps: [
    {
      target: "notifications-header",
      title: "Your notification inbox",
      body: "Only signals addressed to this account appear here, and the ten newest are kept.",
      placement: "bottom",
    },
    {
      target: "notifications-list",
      title: "Read and unread",
      body: "A brass dot marks a new notification. Opening it marks it read and removes it from this list.",
      placement: "top",
    },
    {
      target: "notifications-delete",
      title: "Remove one",
      body: "Use the cross to delete a notification you no longer need.",
      placement: "left",
    },
  ],
};

export default notificationsTour;
