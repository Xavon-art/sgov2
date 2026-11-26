import "server-only";

import { cache } from "react";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { readSessionToken } from "@/lib/auth/session";
import type { NotificationItem } from "@/lib/notifications";

export type NotificationSnapshot = {
  notifications: NotificationItem[];
  unreadCount: number;
};

export type NotificationRecipient = { id: string };

type UmbrellaAccount = { id?: string; status?: string };
type UmbrellaUnit = {
  unitId?: string;
  members?: Array<{ account?: UmbrellaAccount | null }>;
};
type Officer = {
  id?: string;
  unitId?: string | null;
  status?: string;
  statusLabel?: string;
};
type OrgAccount = {
  id?: string;
  accountKind?: string;
  accountScope?: string;
};

const EMPTY: NotificationSnapshot = { notifications: [], unreadCount: 0 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Server-side notification snapshot.
 *
 * The bell and the notification page used to wait for a client-side API call,
 * which made real data appear seconds after the shell. Loading it in the server
 * render puts the first paint and the data in the same response; the realtime
 * subscription only has to keep that snapshot fresh afterwards.
 */
export const loadNotifications = cache(async (limit: number): Promise<NotificationSnapshot> => {
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
});

export async function loadUnitRecipientIds(
  token: string,
  unitIds: string[],
): Promise<string[]> {
  const wanted = new Set(unitIds.filter((id) => UUID.test(id)));

  try {
    const [officers, umbrella] = await Promise.all([
      callRpc<RpcResult & { officers?: Officer[] }>("list_officers", {
        p_session_token: token,
      }),
      callRpc<RpcResult & { units?: UmbrellaUnit[] }>("list_umbrella", {
        p_session_token: token,
      }),
    ]);

    const ids = new Set<string>();

    if (officers.ok && Array.isArray(officers.officers)) {
      for (const officer of officers.officers) {
        if (!officer.id || officer.statusLabel === "deactivated" || officer.status === "deactivated") continue;
        if (!officer.unitId) continue;
        if (wanted.size > 0 && !wanted.has(officer.unitId)) continue;
        ids.add(officer.id);
      }
    }

    if (umbrella.ok && Array.isArray(umbrella.units)) {
      for (const unit of umbrella.units) {
        if (wanted.size > 0 && (!unit.unitId || !wanted.has(unit.unitId))) continue;
        for (const member of unit.members ?? []) {
          const account = member.account;
          if (!account?.id || account.status !== "active") continue;
          ids.add(account.id);
        }
      }
    }

    return [...ids];
  } catch {
    return [];
  }
}

export async function loadUsgRecipientIds(token: string): Promise<string[]> {
  try {
    const res = await callRpc<RpcResult & { accounts?: OrgAccount[] }>("list_org_accounts", {
      p_session_token: token,
    });
    if (!res.ok || !Array.isArray(res.accounts)) return [];

    return res.accounts
      .filter((account) =>
        account.accountKind === "usg" ||
        account.accountKind === "central" ||
        account.accountScope === "owner",
      )
      .map((account) => account.id)
      .filter((id): id is string => typeof id === "string" && UUID.test(id));
  } catch {
    return [];
  }
}

export async function loadCurrentAccountId(token: string): Promise<string | null> {
  try {
    const res = await callRpc<RpcResult & { account?: { id?: string } }>("my_profile", {
      p_session_token: token,
    });
    const id = res.account?.id;
    return res.ok && typeof id === "string" && UUID.test(id) ? id : null;
  } catch {
    return null;
  }
}

export async function notifyAccounts(
  token: string,
  recipients: NotificationRecipient[],
  input: {
    kind: string;
    title: string;
    body: string;
    link: string;
    excludeAccountId?: string | null;
  },
): Promise<void> {
  const ids = new Set<string>();
  for (const recipient of recipients) {
    if (
      recipient.id &&
      UUID.test(recipient.id) &&
      recipient.id !== input.excludeAccountId
    ) {
      ids.add(recipient.id);
    }
  }
  if (ids.size === 0) return;

  await Promise.allSettled(
    [...ids].map((accountId) =>
      callRpc("create_notification", {
        p_session_token: token,
        p_account_id: accountId,
        p_kind: input.kind,
        p_title: input.title,
        p_body: input.body,
        p_link: input.link,
      }),
    ),
  );
}
