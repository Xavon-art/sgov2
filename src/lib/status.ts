/**
 * The unified status model used everywhere in SmartGov.
 *
 * Every status-bearing table and component speaks this vocabulary:
 *
 *   pending   draft   under_review   returned   approved   rejected   overdue
 *
 * A record can be in exactly one status at a time. "overdue" is never written
 * directly: it is derived on read from the due date (see effectiveStatus). A
 * submission made after its due date is a separate flag (see
 * isLateSubmission), not a status of its own -- an overdue item that has since
 * been approved stays "approved", the lateness is recorded separately.
 *
 * Legacy values written by older migrations are mapped here on read (see
 * LEGACY_TO_STATUS), so nothing stored before this change is unreadable, and
 * everything written after it uses these values directly. Modules whose legacy
 * "submitted" means "waiting for review" rather than "under review" should use
 * their own normalizer before falling back to this shared one.
 */

export type Status =
  | "pending"
  | "draft"
  | "under_review"
  | "returned"
  | "approved"
  | "rejected"
  | "overdue";

export const STATUS_LABEL: Record<Status, string> = {
  pending: "Pending",
  draft: "Draft",
  under_review: "Under review",
  returned: "Returned",
  approved: "Approved",
  rejected: "Rejected",
  overdue: "Overdue",
};

export const STATUS_CLASS: Record<Status, string> = {
  pending: "border-line bg-canvas text-muted",
  draft: "border-brass/40 bg-brass-soft/30 text-brass-deep",
  under_review: "border-brass/40 bg-brass-soft/30 text-brass-deep",
  returned: "border-[#a3702a]/35 bg-[#a3702a]/[0.08] text-[#8a5f22]",
  approved: "border-[#2f6d4f]/35 bg-[#2f6d4f]/[0.08] text-[#255639]",
  rejected: "border-[#d9a99c] bg-[#a5442c]/[0.08] text-[#a5442c]",
  overdue: "border-[#a5442c] bg-[#a5442c]/[0.12] text-[#a5442c] font-semibold",
};

function deadlineTime(value: string): number {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const time = new Date(dateOnly ? `${value}T23:59:59.999` : value).getTime();
  return time;
}

/**
 * A submission is "late" when it arrived after its due date. This is a flag on
 * top of the workflow status: an overdue item that has since been approved
 * stays "approved", the lateness is recorded separately. Returns false when
 * either date is missing.
 */
export function isLateSubmission(
  submittedAt: string | null | undefined,
  dueDate: string | null | undefined,
): boolean {
  if (!submittedAt || !dueDate) return false;
  const submitted = new Date(submittedAt).getTime();
  const due = deadlineTime(dueDate);
  if (Number.isNaN(submitted) || Number.isNaN(due)) return false;
  return submitted > due;
}

/**
 * The status shown to a user: anything still open whose deadline has passed
 * reads as "overdue" regardless of its workflow step. Approved and rejected
 * items keep their outcome even after the deadline.
 */
export function effectiveStatus(
  status: Status,
  dueDate: string | null | undefined,
): Status {
  if (status !== "approved" && status !== "rejected" && dueDate) {
    if (deadlineTime(dueDate) < new Date().getTime()) return "overdue";
  }
  return status;
}

/**
 * Legacy status strings written by older migrations, mapped to the unified
 * model. Anything already in the unified vocabulary maps to itself.
 */
export const LEGACY_TO_STATUS: Record<string, Status> = {
  // Task assignments (the task tables are remapped by migration)
  assigned: "pending",
  in_progress: "draft",
  submitted: "under_review",
  done: "approved",
  // Resolutions / proposals / structures
  returned: "returned",
  published: "approved",
  requirements_requested: "under_review",
  // Personal requests / budgets
  granted: "approved",
  declined: "rejected",
  needs_revision: "returned",
  submission_required: "returned",
  withdrawn: "rejected",
  expired: "rejected",
  // Events
  upcoming: "pending",
  claimed: "under_review",
  honored: "approved",
  // Documents / feedback forms / accomplishment reports
  new: "pending",
  acknowledged: "approved",
  superseded: "rejected",
};

/** Map any stored status string to the unified model. Unknown values fall back
 *  to "draft" so a legacy row is always classifiable rather than crash. */
export function normalizeStatus(value: string | null | undefined): Status {
  if (!value) return "draft";
  const lower = value.toLowerCase();
  if (lower in STATUS_LABEL) return lower as Status;
  return LEGACY_TO_STATUS[lower] ?? "draft";
}

/**
 * Every valid status transition, used by the API to reject regressions. A
 * renewal reopens an approved/rejected item as a new draft.
 */
export const ALLOWED_TRANSITIONS: Record<Status, Status[]> = {
  draft: ["pending", "under_review"],
  pending: ["draft", "under_review", "approved", "rejected"],
  under_review: ["pending", "approved", "rejected", "returned"],
  returned: ["draft", "under_review"],
  approved: ["draft"],
  rejected: ["draft"],
  overdue: ["draft", "pending", "under_review", "approved", "rejected"],
};

export function isValidTransition(from: Status, to: Status): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function statusLabel(status: Status): string {
  return STATUS_LABEL[status] ?? status;
}

export function statusClass(status: Status): string {
  return STATUS_CLASS[status] ?? STATUS_CLASS.pending;
}
