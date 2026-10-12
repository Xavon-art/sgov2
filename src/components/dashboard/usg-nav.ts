import type { NavItem } from "@/components/dashboard/AppShell";
import type { WorkspaceRole } from "@/lib/auth/workspace";

/**
 * The USG workspace navigation.
 *
 * Reorganized per the full system reconstruction:
 * - "activities and events" replaces "proposals" as the top-level section,
 *   housing all proposal/activity tracking.
 * - "manage" is a centralized admin section combining units, invitations,
 *   access, and deactivation handling.
 * - "tasks" removed from main navigation (functionality preserved, not in nav).
 * - "feed" kept only for USG admins; LSG has no feed link.
 */
export function buildUsgNav(role: WorkspaceRole): NavItem[] {
  return [
    {
      id: "overview",
      label: "Overview",
      hint: "What needs a decision",
      href: "/usg",
      icon: "dashboard",
    },
    {
      id: "activities-and-events",
      label: "Activities and Events",
      hint: "Proposals, events, and activity tracking",
      href: "/usg/activities-and-events",
      icon: "events",
    },
    {
      id: "budgets",
      label: "Budgets",
      hint: "Decide what the units ask for",
      href: "/usg/budgets",
      icon: "budget",
    },
    // Centralized admin section: units (departments/campuses), invitations,
    // access control, and deactivated-account handling.
    ...(role.isAdmin
      ? [
          {
            id: "manage",
            label: "Manage",
            hint: "Units, invitations, access, deactivation",
            href: "/usg/manage",
            icon: "layers" as const,
          },
        ]
      : []),
    {
      id: "account",
      label: "Account",
      hint: "Your sign-in details",
      href: "/usg/account",
      icon: "lock",
    },
  ];
}