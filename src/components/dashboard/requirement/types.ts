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

export type ProposalsListRow = {
  id: string;
  title: string;
  status: "submitted" | "returned" | "approved" | "rejected" | "published";
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
    decision: "approved" | "returned" | "rejected";
    remark: string | null;
    decidedBy: string;
    createdAt: string;
  }>;
};