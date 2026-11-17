import type { PageTour } from "../types";

export const usgMessagesTour: PageTour = {
  id: "usg-messages",
  version: "1",
  route: "/usg/messages",
  label: "Messages",
  roles: ["usg"],
  steps: [
    {
      target: "messages-inbox",
      title: "Inbox",
      body: "Your council conversations are collected here.",
      placement: "right",
    },
    {
      target: "messages-new",
      title: "New message",
      body: "Select this button to start a new conversation with another member.",
      placement: "bottom",
      advanceOnClick: true,
    },
    {
      target: "messages-conversation-list",
      title: "Conversations",
      body: "Choose a conversation from this list to read its full thread.",
      placement: "right",
    },
    {
      target: "messages-thread",
      title: "Message thread",
      body: "Read and reply to messages in this panel.",
      placement: "left",
    },
  ],
};

export default usgMessagesTour;
