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
 * `Feed` sits after Budgets rather than at the top: an officer opens this list to
 * act, and announcements are context for the work, not the work itself.
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
    {
      id: "feed",
      label: "Feed",
      hint: "Announcements and the calendar",
      href: "/lsg/feed",
      icon: "compass",
    },
    {
      id: "help",
      label: "Help",
      hint: "How this works",
      href: "/lsg/help",
      icon: "compass",
    },
  ];
}