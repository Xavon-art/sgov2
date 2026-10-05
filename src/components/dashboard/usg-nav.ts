import type { NavItem } from "@/components/dashboard/AppShell";
import type { WorkspaceRole } from "@/lib/auth/workspace";

/**
 * The USG workspace navigation.
 *
 * This module and `lsg-nav.ts` are deliberately separate rather than one builder
 * with role conditionals. The rule that an LSG officer must not be able to reach
 * an invitation or member-management screen is much easier to hold when the LSG
 * bundle has no USG route string in it at all, than when it has one branch that
 * evaluates to `false`. Nothing here is shared with the LSG side, and nothing
 * here is imported by anything under `/lsg`.
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
      id: "proposals",
      label: "Proposals",
      hint: "Review inbox and programs",
      href: "/usg/proposals",
      icon: "submission",
    },
    {
      id: "budgets",
      label: "Budgets",
      hint: "Decide what the units ask for",
      href: "/usg/budgets",
      icon: "budget",
    },
    // `Tasks` and `Feed` join this list in their own slices, when the routes exist.
    // They are not listed ahead of their pages: a nav item that lands on a 404
    // teaches a user that the sidebar lies.
    // A centralized office records its units directly, so there is no campus
    // layer to build first -- offering the route would be offering a form the
    // database refuses.
    ...(role.isAdmin && role.accountKind === "usg"
      ? [
          {
            id: "units",
            label: "Campuses",
            hint: "Add a campus or department",
            href: "/usg/units",
            icon: "pyramid" as const,
          },
        ]
      : []),
    // Invitations and member management exist only on this side. The gates below
    // are a convenience for the sidebar; the real boundary is the `/usg` layout
    // guard plus the RPC's own scope check.
    ...(role.isAdmin
      ? [
          {
            id: "invitations",
            label: "Invitations",
            hint: "Officers you have asked to join",
            href: "/usg/invitations",
            icon: "user" as const,
          },
          {
            id: "access",
            label: "Access",
            hint: "Who is allowed to invite",
            href: "/usg/access",
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