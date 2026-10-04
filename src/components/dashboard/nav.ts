import type { NavItem } from "@/components/dashboard/AppShell";
import type { Account } from "@/lib/auth/session";

/**
 * The dashboard's section map, in one place.
 *
 * The shell used to receive `active` flags computed by whichever page happened to
 * render it, so a section could not be added without editing the page, the nav,
 * and the anchor it jumped to. A route has to be listed once, here, and both the
 * sidebar and the mobile drawer read the same array -- they already did, but the
 * flag no longer comes from a page that has to know about navigation at all.
 */
export function buildDashboardNav(account: Account): NavItem[] {
  const isOwner = account.accountScope === "owner";
  const isUsg = account.accountKind === "usg";

  return [
    {
      id: "overview",
      label: "Overview",
      hint: isUsg ? "Decentralized workspace" : "Centralized workspace",
      href: "/dashboard",
      icon: "dashboard",
    },
    // Proposals and requirements is the one section both roles get, and it is
    // deliberately not gated on `isOwner`. The USG officer gets the review inbox
    // and its programs; an LSG officer gets the programs to draft against and its
    // own unit's submissions. Hiding it from non-owners is what left an invited
    // officer staring at a dashboard with nothing on it but "you were invited".
    {
      id: "requirements",
      label: "Proposals",
      hint: isOwner ? "Review inbox and programs" : "Your unit's submissions",
      href: "/dashboard/requirements",
      icon: "submission" as const,
    },
    // A centralized office records its units directly, so there is no campus
    // layer to build first -- offering the route would be offering a form the
    // database refuses.
    ...(isOwner && isUsg
      ? [
          {
            id: "units",
            label: "Campuses",
            hint: "Add a campus or department",
            href: "/dashboard/units",
            icon: "pyramid" as const,
          },
        ]
      : []),
    ...(isOwner
      ? [
          {
            id: "invitations",
            label: "Invitations",
            hint: "Officers you have asked to join",
            href: "/dashboard/invitations",
            icon: "user" as const,
          },
        ]
      : []),
    {
      id: "account",
      label: "Account",
      hint: "Your sign-in details",
      href: "/dashboard/account",
      icon: "lock",
    },
  ];
}