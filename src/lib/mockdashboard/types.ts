export type Role = "usg" | "lsg";
export type Status = "pending" | "in_review" | "approved" | "returned";
export type ItemKind = "proposal" | "event" | "budget";
export type Review = { decidedBy: string; at: string; comment: string };
export type TimelineEntry = {
  at: string;
  from: Status | "none";
  to: Status;
  by: string;
  note?: string;
};
export type Action = "start_review" | "approve" | "return" | "resubmit";