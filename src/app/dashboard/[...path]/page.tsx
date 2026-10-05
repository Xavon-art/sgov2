import { redirect } from "next/navigation";
import { currentAccount } from "@/lib/auth/session";
import { resolveWorkspaceRole } from "@/lib/auth/workspace";

/**
 * Legacy deep links, resolved by side.
 *
 * `/dashboard/units`, `/dashboard/invitations` and friends were links in old
 * invitations and in people's bookmarks. Rather than 404 them, each is mapped to
 * where that section actually lives now.
 *
 * The mapping is side-aware on purpose. An LSG officer following a USG section URL
 * is not redirected to that USG section to be bounced by the `/usg` guard -- they
 * go to their own home. Following a link you cannot use should land you somewhere
 * you can, not somewhere that says no.
 *
 * The `account` mapping for LSG goes to Help rather than to a settings screen,
 * because the LSG side has no account or role settings by design. Help is where
 * the "Contact USG" line lives.
 */
const USG_SECTIONS: Record<string, string> = {
  units: "/usg/units",
  invitations: "/usg/invitations",
  access: "/usg/access",
  account: "/usg/account",
  requirements: "/usg/proposals",
  proposals: "/usg/proposals",
  tasks: "/usg/tasks",
  feed: "/usg/feed",
  budget: "/usg/budget",
};

const LSG_SECTIONS: Record<string, string> = {
  requirements: "/lsg/proposals",
  proposals: "/lsg/proposals",
  tasks: "/lsg/tasks",
  feed: "/lsg/feed",
  account: "/lsg/help",
};

export default async function DashboardLegacySection({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const account = await currentAccount();
  if (!account) redirect("/login");

  const role = await resolveWorkspaceRole();
  if (!role) redirect("/login");

  const { path } = await params;
  const section = path[path.length - 1] ?? "";

  const table = role.side === "usg" ? USG_SECTIONS : LSG_SECTIONS;
  redirect(table[section] ?? (role.side === "usg" ? "/usg" : "/lsg"));
}