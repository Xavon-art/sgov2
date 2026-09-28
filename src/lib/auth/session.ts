import { cookies } from "next/headers";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";

export const SESSION_COOKIE = "sgov_session";

/** Matches the 30-day lifetime granted inside `smartgov.login_account`. */
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export type AccountKind = "usg" | "central";
export type AccountScope = "owner" | "invited";

export type Account = {
  id: string;
  email: string;
  displayName: string;
  accountKind: AccountKind;
  accountScope: AccountScope;
  organizationId: string | null;
  universityName: string;
  campusName: string;
};

/** Row shape of `smartgov.resolve_account`, which is snake_case. */
type AccountRow = {
  id: string;
  email: string;
  display_name: string;
  account_kind: AccountKind;
  account_scope: AccountScope;
  organization_id: string | null;
  university_name: string;
  campus_name: string;
};

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    accountKind: row.account_kind,
    accountScope: row.account_scope,
    organizationId: row.organization_id,
    universityName: row.university_name,
    campusName: row.campus_name,
  };
}

export async function readSessionToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value ?? null;
}

export async function setSessionCookie(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

/**
 * Resolves the signed-in account, or null.
 *
 * The token is verified in Postgres against `smartgov.sessions`, which also
 * refuses expired sessions and any account that is not `active` -- so a
 * half-finished OTP flow cannot reach a dashboard even with a valid cookie.
 */
export async function currentAccount(): Promise<Account | null> {
  const token = await readSessionToken();
  if (!token) return null;

  // `resolve_account` is set-returning, so PostgREST hands back an array.
  const rows = await callRpc<AccountRow[] | AccountRow | null>("resolve_account", {
    p_token: token,
  });

  if (!rows) return null;
  const row = Array.isArray(rows) ? rows[0] : rows;
  return row ? toAccount(row) : null;
}

/** True when the account owns its organization and may send invitations. */
export function canInvite(account: Account | null): boolean {
  return Boolean(account && account.accountScope === "owner" && account.organizationId);
}

/**
 * True when the account may run the owner-only chart writes.
 *
 * `account_scope` is the same signal `smartgov.create_invite` gates on, and an
 * invited member is always written as `invited`, so owner-scope is a necessary
 * condition for the founding-member check the chart functions make. It costs one
 * row read here where re-reading the chart to learn `scope` costs an aggregate
 * over every unit -- and it is a gate, not the authority: the function still
 * proves `organization_members.is_founding` before it writes.
 */
export function canManageChart(account: Account | null): boolean {
  return Boolean(account && account.accountScope === "owner" && account.organizationId);
}

export type { RpcResult };
