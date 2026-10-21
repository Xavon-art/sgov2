import { currentAccount } from "@/lib/auth/session";
import { resolveWorkspaceRole } from "@/lib/auth/workspace";
import { buildUsgNav } from "@/components/dashboard/usg-nav";
import { FederatedOverview } from "@/components/dashboard/FederatedOverview";

export const dynamic = "force-dynamic";

/**
 * The USG overview.
 *
 * The section list is rebuilt here rather than read from the layout because the
 * layout hands `nav` to `AppShell` and to nothing else. Rebuilding it is one
 * pure function over the already-resolved role, not a second session read, and it
 * keeps the overview's cards and the sidebar's links from ever disagreeing.
 */
export default async function UsgDashboardPage() {
  const account = await currentAccount();
  const role = await resolveWorkspaceRole();

  // The layout already redirected an account with no session or the wrong side,
  // so by the time this renders both are present. The guard here is defence in
  // depth: a `null` role would otherwise throw inside `buildUsgNav`.
  if (!account || !role) return null;

  return <FederatedOverview nav={buildUsgNav(role)} side="usg" />;
}
