import { redirect } from "next/navigation";
import { currentAccount, readSessionToken } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function UsgStructurePage() {
  const account = await currentAccount();
  if (!account) redirect("/login");
  if (account.accountScope !== "owner") redirect("/lsg");

  const token = await readSessionToken();
  if (!token) redirect("/login");

  redirect(`/structure/editor?returnTo=/usg/manage?tab=structure`);
}
