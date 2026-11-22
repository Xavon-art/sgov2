import type { NavItem } from "@/components/dashboard/AppShell";
import type { WorkspaceRole } from "@/lib/auth/workspace";

/**
 * The LSG workspace navigation -- the mirror of the USG one, from the side that
 * answers rather than the side that decides.
 *
 *   Overview   what your unit owes, and what it has back
 *   Manage     your profile and your own government structure
 *   Request    the tasks USG sent down, and the requests you send up
 *   Events     your calendar, and whether USG honoured each entry
 *   Survey     respond, and build your own
 *   Settings   your account and how the dashboard behaves
 *
 * The two navs are separate modules on purpose: this file names no `/usg`
 * route, so no USG route string can leak into an LSG bundle.
 */
export function buildLsgNav(input: WorkspaceRole): NavItem[] {
  const role = input as WorkspaceRole & {
    isCentral?: boolean;
    governanceModel?: "federated" | "unitary" | null;
  };
  const centralized = role.isCentral || role.governanceModel === "unitary";
  const where = role.unitName;
  return [
    {
      id: "overview",
      label: "Overview",
      hint: where ? `What ${where} must file` : "What your unit must file",
      href: "/lsg",
      icon: "dashboard",
    },
    {
      id: "manage",
      label: "Manage",
      hint: "Your profile and your LSG structure",
      href: "/lsg/manage",
      icon: "layers",
      children: [
        ...(centralized ? [] : [{ label: "Unit details", href: "/lsg/manage?tab=usg" }]),
        { label: "Government structure", href: "/lsg/manage?tab=structure" },
        { label: "Profile and Customization", href: "/lsg/manage?tab=profile" },
        { label: "Documents", href: "/lsg/manage?tab=documents" },
        { label: "Search", href: "/lsg/manage?tab=search" },
        { label: "Budget", href: "/lsg/manage?tab=budget" },
        { label: "Feedback", href: "/lsg/manage?tab=feedback" },
      ],
    },
    {
      id: "request",
      label: "Request",
      hint: "Tasks from the student government, and what you send up",
      href: "/lsg/request",
      icon: "submission",
      children: [
        { label: "Tasks and Inbox", href: "/lsg/request" },
        { label: "My Personal Requests", href: "/lsg/personal-requests" },
        ...(centralized ? [] : [{ label: "Resolutions", href: "/lsg/request?tab=resolutions" }]),
      ],
    },
    {
      id: "events",
      label: "Events and Acts",
      hint: "Your calendar and its standing",
      href: "/lsg/events",
      icon: "events",
      children: [
        { label: "Calendar", href: "/lsg/events?tab=calendar" },
        { label: "Future Events", href: "/lsg/events?tab=future" },
        { label: "Accomplishment", href: "/lsg/events?tab=accomplishment" },
      ],
    },
    {
      id: "survey",
      label: "Survey",
      hint: "Answer, and build your own",
      href: "/lsg/surveys",
      icon: "monitoring",
    },
    {
      id: "settings",
      label: "Settings",
      hint: "Account and dashboard",
      href: "/lsg/settings",
      icon: "lock",
    },
  ];
}
