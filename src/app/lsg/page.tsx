import { currentAccount } from "@/lib/auth/session";
import { resolveWorkspaceRole } from "@/lib/auth/workspace";
import { buildLsgNav } from "@/components/dashboard/lsg-nav";
import { FederatedOverview } from "@/components/dashboard/FederatedOverview";

export const dynamic = "force-dynamic";

/**
 * The LSG overview -- the mirror of `/usg/page.tsx`, from the side that answers.
 *
 * Same component, different nav. The links arrive as a prop, so this file holds
 * no `/usg` route string and an officer's bundle cannot grow one.
 */
export default async function LsgTodayPage() {
  const account = await currentAccount();
  const role = await resolveWorkspaceRole();

  if (!account || !role) return null;

  return <FederatedOverview nav={buildLsgNav(role)} side="lsg" />;
}
