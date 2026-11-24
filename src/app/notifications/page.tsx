import { redirect } from "next/navigation";
import { currentAccount } from "@/lib/auth/session";
import { NotificationsClient } from "./NotificationsClient";

export const runtime = "nodejs";

export default async function NotificationsPage() {
  const account = await currentAccount();
  if (!account) redirect("/login");

  return <NotificationsClient accountId={account.id} accountName={account.displayName} />;
}
