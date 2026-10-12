import type { NavItem } from "@/components/dashboard/AppShell";
import type { WorkspaceRole } from "@/lib/auth/workspace";

/**
 * The LSG workspace navigation.
 *
 * Reorganized per the full system reconstruction:
 * - "activities and events" replaces "proposals" as the top-level section,
 *   housing activity/proposal tracking for the officer's unit.
 * - "tasks" and "feed" removed from main navigation (functionality preserved
 *   via direct URLs if needed, but not in the primary nav).
 * - "help" retained as the fifth item for the short mobile-friendly list.
 */
export function buildLsgNav(role: WorkspaceRole): NavItem[] {
  return [
    {
      id: "today",
      label: "Today",
      hint: role.unitName ? `What ${role.unitName} owes USG` : "What your unit owes USG",
      href: "/lsg",
      icon: "dashboard",
    },
    {
      id: "activities-and-events",
      label: "Activities and Events",
      hint: "Proposals and activity tracking for your unit",
      href: "/lsg/activities-and-events",
      icon: "events",
    },
    {
      id: "budgets",
      label: "Budgets",
      hint: "Ask USG for funds",
      href: "/lsg/budgets",
      icon: "budget",
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