import type { PageTour } from "../types";

export const lsgRequestTour: PageTour = {
  id: "lsg-request",
  version: "1",
  route: "/lsg/request",
  label: "Requests and tasks",
  roles: ["lsg"],
  steps: [
    {
      target: "request-header",
      title: "Requests page",
      body: "Track tasks and personal requests assigned to you from this page.",
      placement: "bottom",
    },
    {
      target: "request-tabs",
      title: "Request tabs",
      body: "Switch between your assigned tasks and personal requests.",
      placement: "bottom",
    },
    {
      target: "request-tabs",
      title: "Resolutions",
      body: "The new Resolutions tab shows the decisions your council filed and the ones your office approved.",
      placement: "bottom",
    },
    {
      target: "request-file-personal",
      title: "File personal request",
      body: "Use this button to submit a personal request to your council.",
      placement: "bottom",
      advanceOnClick: true,
    },
    {
      target: "request-task-list",
      title: "Task list",
      body: "This list shows each task with its status and due date.",
      placement: "top",
    },
  ],
};

export default lsgRequestTour;
