import { redirect } from "next/navigation";
import { currentAccount } from "@/lib/auth/session";
import { resolveWorkspaceRole } from "@/lib/auth/workspace";

/**
 * Compatibility redirect for the old single-tree `/dashboard`.
 *
 * The dashboard used to be one tree whose navigation was filtered by role. It is
 * now `/usg` and `/lsg`, so this path only decides which of the two the account
 * belongs to and sends it there. It renders nothing.
 *
 * Kept deliberately rather than 404ing: these paths are in bookmarks, in
 * in-flight links from old email invitations, and in the login redirect. A
 * redirect that lands on the right workspace is the least surprising outcome.
 */
export default async function DashboardCompatPage() {
  const account = await currentAccount();
  if (!account) redirect("/login");

  const role = await resolveWorkspaceRole();

  if (!role) redirect("/login");
  redirect(role.side === "usg" ? "/usg" : "/lsg");
}