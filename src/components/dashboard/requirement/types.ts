export type ActivityType =
  | "sports"
  | "culture"
  | "academic"
  | "community"
  | "wellness"
  | "special";

export type ItemKind = "file" | "link";

export type RequirementItem = {
  id: string;
  label: string;
  itemKind: ItemKind;
  allowedExtensions: string[];
  position: number;
};

export type ProgramRow = {
  id: string;
  name: string;
  description: string;
  icon: ActivityType;
  status: "draft" | "published";
  createdAt: string;
  items: RequirementItem[];
};

export type ProposalStatus =
  | "submitted"
  | "under_review"
  | "returned"
  | "requirements_requested"
  | "approved"
  | "rejected"
  | "published";

export type StatusTone = "neutral" | "info" | "warning" | "success" | "danger";

export type RequirementStatus = "requested" | "submitted" | "accepted" | "waived";

export type ProposalsListRow = {
  id: string;
  title: string;
  status: ProposalStatus;
  authorKind: "lsg" | "usg";
  activityType: ActivityType;
  eventDate: string | null;
  createdAt: string;
  programName: string | null;
  unitName: string | null;
  version: number;
  latestDecision: string | null;
  latestRemark: string | null;
};

/**
 * One "additional requirement" the USG attached to an approval, and the LSG's
 * answer to it. The artifact is either a link or a document -- the database
 * enforces exactly one -- so both fields are nullable and only one is set on a
 * `submitted`/`accepted` row.
 */
export type ProposalRequirement = {
  id: string;
  label: string;
  detail: string;
  status: RequirementStatus;
  linkUrl: string | null;
  storagePath: string | null;
  originalName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  respondedNote: string | null;
  respondedBy: string | null;
  respondedAt: string | null;
  versionNumber: number | null;
  position: number;
};

export type ProposalBudget = {
  id: string;
  title: string;
  justification: string;
  status: string;
  requestedTotal: number;
  approvedTotal: number | null;
  items: Array<{
    id: string;
    label: string;
    quantity: number;
    unitCost: number;
    subtotal: number;
  }>;
};

export const REQUIREMENT_STATUS_LABEL: Record<RequirementStatus, string> = {
  requested: "Awaiting response",
  submitted: "Submitted",
  accepted: "Accepted",
  waived: "Waived",
};

export const REQUIREMENT_STATUS_TONE: Record<RequirementStatus, StatusTone> = {
  requested: "warning",
  submitted: "info",
  accepted: "success",
  waived: "neutral",
};

export type ProposalDetail = {
  id: string;
  title: string;
  description: string;
  status: ProposalsListRow["status"];
  authorKind: "lsg" | "usg";
  activityType: ActivityType;
  eventDate: string | null;
  venue: string | null;
  createdAt: string;
  programName: string | null;
  unitName: string | null;
  versions: Array<{
    id: string;
    versionNumber: number;
    submittedBy: string;
    submissionNote: string | null;
    submittedAt: string;
    items: Array<{
      itemId: string;
      submissionId: string | null;
      label: string;
      itemKind: ItemKind;
      submissionKind: ItemKind;
      originalName: string | null;
      sizeBytes: number | null;
      linkUrl: string | null;
    }>;
  }>;
  reviews: Array<{
    versionNumber: number;
    decision: "approved" | "returned" | "rejected" | "requirements";
    remark: string | null;
    decidedBy: string;
    createdAt: string;
  }>;
  requirements: ProposalRequirement[];
  budget: ProposalBudget | null;
};