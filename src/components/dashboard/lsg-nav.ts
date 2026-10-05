import type { NavItem } from "@/components/dashboard/AppShell";
import type { WorkspaceRole } from "@/lib/auth/workspace";

/**
 * The LSG workspace navigation.
 *
 * Five items is the design, not a coincidence: an invited officer opens this on a
 * phone between classes and the whole point is that the list is short enough to
 * read before the screen locks. Tasks, proposals, the feed and Help are all of
 * it.
 *
 * What is deliberately absent, and will stay absent: invitations, member and
 * officer management, account and role settings, the requirement-template
 * builder, the review queue, other units' data, and budget totals for anybody
 * else. Not hidden, not disabled, not greyed out -- absent, so that no greyed-out
 * control can suggest that a greyed-out officer might ask somebody for access.
 *
 * An LSG officer sees its own money and nothing else: its own requests, its own
 * approved figures. The university-wide totals and every other unit's numbers live
 * behind `/usg`, and this file holds no route that could show them.
 *
 * `Tasks` and `Feed` appear in a later slice, when those routes exist. They are
 * not listed before then: a nav item pointing at a 404 is worse than a short nav.
 */
export function buildLsgNav(role: WorkspaceRole): NavItem[] {
  return [
    {
      id: "today",
      label: "Today",
      // The unit name comes from the caller's own membership, so it is the one
      // piece of context that makes "Today" feel like a specific desk.
      hint: role.unitName ? `What ${role.unitName} owes USG` : "What your unit owes USG",
      href: "/lsg",
      icon: "dashboard",
    },
    {
      id: "tasks",
      label: "Tasks",
      hint: "What your unit owes USG",
      href: "/lsg/tasks",
      icon: "clock",
    },
    {
      id: "proposals",
      label: "Proposals",
      hint: "Submit and track your activities",
      href: "/lsg/proposals",
      icon: "submission",
    },
    {
      id: "budgets",
      label: "Budgets",
      hint: "Ask USG for funds",
      href: "/lsg/budgets",
      icon: "budget",
    },
    // `Feed and calendar` joins this list in its own slice, when the route
    // exists. Not before: a nav item that lands on a 404 teaches a user that the
    // sidebar lies, and this side is used on a phone.
    {
      id: "help",
      label: "Help",
      hint: "How this works",
      href: "/lsg/help",
      icon: "compass",
    },
  ];
}