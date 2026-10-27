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
export function buildLsgNav(role: WorkspaceRole): NavItem[] {
  const where = role.unitName;
  return [
    {
      id: "overview",
      label: "Overview",
      hint: where ? `What ${where} owes USG` : "What your unit owes USG",
      href: "/lsg",
      icon: "dashboard",
    },
    {
      id: "manage",
      label: "Manage",
      hint: "Your profile and your structure",
      href: "/lsg/manage",
      icon: "layers",
      children: [
        { label: "My USG", href: "/lsg/manage?tab=usg" },
        { label: "Profile and Customization", href: "/lsg/manage?tab=profile" },
      ],
    },
    {
      id: "request",
      label: "Request",
      hint: "Tasks from USG, and what you send up",
      href: "/lsg/request",
      icon: "submission",
      children: [
        { label: "Tasks and Inbox", href: "/lsg/request" },
        { label: "My Personal Requests", href: "/lsg/personal-requests" },
      ],
    },
    {
      id: "events",
      label: "Events and Acts",
      hint: "Your calendar and its standing",
      href: "/lsg/events",
      icon: "events",
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
