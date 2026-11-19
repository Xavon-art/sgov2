import type { NavItem } from "@/components/dashboard/AppShell";
import type { WorkspaceRole } from "@/lib/auth/workspace";

/**
 * The USG workspace navigation, rebuilt around the federated IH: the USG is the
 * centre and every LSG sits under it.
 *
 *   Overview     what needs a decision, and a way into everything else
 *   Manage       the umbrella: your LSGs, invitations, and your own profile
 *   Request      the core of the system -- tasks pushed down to LSGs, and the
 *                personal requests they send back up
 *   Events       the calendar of events and acts
 *   Survey       forms, built by either side
 *   Settings     your account and how the dashboard behaves
 *
 * The sections are named after the work, not the table behind it. "Manage" holds
 * three floors under one roof rather than three top-level entries, because an
 * owner thinks of the umbrella, the invitations and their own profile as one
 * administrative job.
 *
 * Icons are keys, resolved in `AppShell`; a component cannot cross the server to
 * client boundary here.
 */
export function buildUsgNav(role: WorkspaceRole): NavItem[] {
  const canManage = role.accountScope === "owner";
  // The workspace side is resolved by the database: every USG-side account is
  // the owner or an org reviewer, which is exactly the pair the document SQL
  // allows to read pending rows and approve them.
  const canReviewDocuments = role.side === "usg";
  const manageChildren = [
    { label: "Your Umbrella", href: "/usg/manage?tab=umbrella" },
    { label: "Invites", href: "/usg/manage?tab=invites" },
    { label: "Government structure", href: "/usg/manage?tab=structure" },
    { label: "Profile and Customization", href: "/usg/manage?tab=profile" },
    { label: "Documents", href: "/usg/manage?tab=documents" },
    { label: "Search", href: "/usg/manage?tab=search" },
    { label: "Budget", href: "/usg/manage?tab=budget" },
  ].filter(
    (_, index) =>
      canManage || index === 3 ||
      (canReviewDocuments && (index === 4 || index === 5)) ||
      (canReviewDocuments && index === 6),
  );
  if (canReviewDocuments) {
    manageChildren.push({ label: "Monitoring", href: "/usg/manage?tab=monitoring" });
    manageChildren.push({ label: "Feedback", href: "/usg/manage?tab=feedback" });
  }
  if (canManage) {
    // `/org-chart` is a full-page view of the published chart. It has to be
    // reached from inside the app: the session guard ends a session that arrives
    // by loading the URL, so a pasted link would sign the owner out.
    manageChildren.push({ label: "Published chart", href: "/org-chart" });
    manageChildren.push({ label: "Accounts", href: "/usg/manage?tab=accounts" });
  }

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
      hint: canManage
        ? "Your umbrella, invitations, and profile"
        : canReviewDocuments
          ? "Documents, search, and your profile"
          : "Your profile",
      href: "/usg/manage",
      icon: "layers",
      children: manageChildren,
    },
    {
      id: "request",
      label: "Request",
      hint: "Tasks and personal requests",
      href: "/usg/request",
      icon: "submission",
      children: [
        { label: "Tasks", href: "/usg/request" },
        { label: "Inbox", href: "/usg/messages" },
        { label: "Personal Requests", href: "/usg/personal-requests" },
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
      label: "Survey",
      hint: "Build forms, read the results",
      href: "/usg/surveys",
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
