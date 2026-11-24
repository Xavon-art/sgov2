import "server-only";

import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { readSessionToken } from "@/lib/auth/session";
import type { NotificationItem } from "@/lib/notifications";

export type NotificationSnapshot = {
  notifications: NotificationItem[];
  unreadCount: number;
};

const EMPTY: NotificationSnapshot = { notifications: [], unreadCount: 0 };

/**
 * Server-side notification snapshot.
 *
 * The bell and the notification page used to wait for a client-side API call,
 * which made real data appear seconds after the shell. Loading it in the server
 * render puts the first paint and the data in the same response; the realtime
 * subscription only has to keep that snapshot fresh afterwards.
 */
export async function loadNotifications(limit: number): Promise<NotificationSnapshot> {
  try {
    const token = await readSessionToken();
    if (!token) return EMPTY;

    const res = await callRpc<RpcResult & NotificationSnapshot>("list_notifications", {
      p_session_token: token,
      p_limit: limit,
    });
    if (!res.ok) return EMPTY;

    return {
      notifications: res.notifications ?? [],
      unreadCount: res.unreadCount ?? 0,
    };
  } catch {
    return EMPTY;
  }
}
