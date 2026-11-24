import { redirect } from "next/navigation";
import { currentAccount } from "@/lib/auth/session";
import { loadNotifications } from "@/lib/notifications-server";
import { NotificationsClient } from "./NotificationsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const account = await currentAccount();
  if (!account) redirect("/login");

  // Same limit as the shell; React cache() dedupes this into one RPC per render.
  const snapshot = await loadNotifications(10);

  return (
    <NotificationsClient
      accountId={account.id}
      accountName={account.displayName}
      initialNotifications={snapshot.notifications}
      initialUnreadCount={snapshot.unreadCount}
    />
  );
}
