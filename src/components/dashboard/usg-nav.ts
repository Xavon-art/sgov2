import type { NavItem } from "@/components/dashboard/AppShell";
import type { WorkspaceRole } from "@/lib/auth/workspace";

/**
 * The USG workspace navigation, rebuilt around the federated IH: the USG is the
 * centre and every LSG sits under it.
 *
 *   Overview     what needs a decision, and a way into everything else
 *   Manage       people and units, government structure, and your own profile
 *   Inbox        messages with the student governments, always one click away
 *   Request      the core of the system -- tasks pushed down to LSGs, and the
 *                personal requests they send back up
 *   Events       the calendar of events and acts
 *   Forms        surveys and feedback, built by either side
 *   Settings     your account and how the dashboard behaves
 *
 * The sections are named after the work, not the table behind it. "Manage" holds
 * one roof for people, structure, documents, and profile rather than separate
 * top-level entries, because an owner thinks of them as one administrative job.
 *
 * Icons are keys, resolved in `AppShell`; a component cannot cross the server to
 * client boundary here.
 */
export function buildUsgNav(input: WorkspaceRole): NavItem[] {
  const role = input as WorkspaceRole & {
    isCentral?: boolean;
    governanceModel?: "federated" | "unitary" | null;
  };
  const centralized = role.isCentral || role.governanceModel === "unitary";
  const canManage = role.accountScope === "owner";
  // The workspace side is resolved by the database: every USG-side account is
  // the owner or an org reviewer, which is exactly the pair the document SQL
  // allows to read pending rows and approve them.
  const canReviewDocuments = role.side === "usg";
  const manageChildren = [
    { label: "People & Units", href: "/usg/manage?tab=people&view=units" },
    { label: "Government structure", href: "/usg/manage?tab=structure" },
    { label: "Profile and Customization", href: "/usg/manage?tab=profile" },
    { label: "Documents", href: "/usg/manage?tab=documents" },
    { label: "Budget", href: "/usg/manage?tab=budget" },
  ].filter(
    (_, index) =>
      (!centralized || index !== 0) &&
      (canManage || index === 2 ||
      (canReviewDocuments && (index === 1 || index === 3 || index === 4))),
  );
  return [
    {
      id: "overview",
      label: "Overview",
      hint: role.unitName ? `${role.unitName} · what needs a decision` : "What needs a decision",
      href: "/usg",
      icon: "dashboard",
    },
    {
      id: "manage",
      label: "Manage",
      hint: centralized
        ? "Structure, documents, and your profile"
        : canManage
          ? "People, structure, and your profile"
          : canReviewDocuments
            ? "Documents and your profile"
            : "Your profile",
      href: "/usg/manage",
      icon: "layers",
      children: manageChildren,
    },
    {
      id: "messages",
      label: "Inbox",
      hint: "Messages with the student governments",
      href: "/usg/messages",
      icon: "compass",
    },
    {
      id: "request",
      label: "Request",
      hint: "Tasks and personal requests",
      href: "/usg/request",
      icon: "submission",
      children: [
        { label: "Tasks", href: "/usg/request?tab=tasks" },
        { label: "Requirements", href: "/usg/request?tab=requirements" },
        { label: "Personal Requests", href: "/usg/request?tab=personal" },
        { label: "Resolutions", href: "/usg/request?tab=resolutions" },
      ],
    },
    {
      id: "events",
      label: "Events and Acts",
      hint: "The calendar, and what was honoured",
      href: "/usg/events",
      icon: "events",
      children: [
        { label: "Calendar", href: "/usg/events?tab=calendar" },
        { label: "Future Events", href: "/usg/events?tab=future" },
        { label: "Accomplishment", href: "/usg/events?tab=accomplishment" },
      ],
    },
    {
      id: "survey",
      label: "Forms",
      hint: "Build surveys and feedback, read the results",
      href: "/usg/forms",
      icon: "monitoring",
    },
    {
      id: "settings",
      label: "Settings",
      hint: "Account and dashboard",
      href: "/usg/settings",
      icon: "lock",
    },
  ];
}
