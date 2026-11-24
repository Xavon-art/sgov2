import type { PageTour } from "../types";

export const usgRequestTour: PageTour = {
  id: "usg-request",
  version: "1",
  route: "/usg/request",
  label: "Requests and tasks",
  roles: ["usg"],
  steps: [
    {
      target: "request-header",
      title: "Requests page",
      body: "Track tasks your council has asked you to complete from this page.",
      placement: "bottom",
    },
    {
      target: "workspace-nav",
      title: "Request sections",
      body: "Tasks, Requirements, Personal Requests, and Resolutions are sidebar links — no duplicate tabs here.",
      placement: "right",
    },
    {
      target: "request-create-task",
      title: "Create task",
      body: "Use this button to assign a new task to a member or team.",
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

export default usgRequestTour;
