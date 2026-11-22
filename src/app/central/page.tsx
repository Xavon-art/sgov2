import { redirect } from "next/navigation";
import { currentAccount } from "@/lib/auth/session";
import { resolveWorkspaceRole, type WorkspaceRole } from "@/lib/auth/workspace";

export const dynamic = "force-dynamic";

export default async function CentralPage() {
  const account = await currentAccount();
  if (!account) redirect("/login");

  const role = await resolveWorkspaceRole();
  if (!role) redirect("/login");

  const roleIdentity = role as WorkspaceRole & {
    isCentral?: boolean;
    isUnitAccount?: boolean;
    governanceModel?: "federated" | "unitary" | null;
  };
  const accountIdentity = account as typeof account & {
    isCentral?: boolean;
    isUnitAccount?: boolean;
  };
  const central =
    roleIdentity.isCentral === true ||
    accountIdentity.isCentral === true ||
    roleIdentity.governanceModel === "unitary";

  if (
    !central &&
    (roleIdentity.side === "lsg" ||
      roleIdentity.isUnitAccount === true ||
      accountIdentity.isUnitAccount === true)
  ) {
    redirect("/lsg");
  }

  redirect("/usg");
}
