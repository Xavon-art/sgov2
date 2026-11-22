import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { readSessionToken, type GovernanceModel } from "@/lib/auth/session";

/**
 * Which workspace an account belongs to.
 *
 * `usg` is the university-wide side: the owner, and anyone holding a seat on the
 * USG board. `lsg` is everybody else. An account that holds both seats resolves
 * to `usg` because that is the strictly larger privilege set, and its LSG
 * membership stays in the database untouched.
 */
export type WorkspaceSide = "usg" | "lsg";

/** Row shape of `smartgov.account_workspace_role`. */
export type WorkspaceRole = {
  side: WorkspaceSide;
  /** The USG Admin. The only role that can grant `can_invite` to somebody else. */
  isAdmin: boolean;
  /** Owners always can. Officers need the grant. LSG officers never can. */
  canInvite: boolean;
  permissions: string[];
  /** The caller's own unit, derived from their membership. Never client-supplied. */
  unitId: string | null;
  unitName: string | null;
  accountScope: string;
  accountKind: string;
  isCentral: boolean;
  isUnitAccount: boolean;
  governanceModel: GovernanceModel | null;
};

type RolePayload = RpcResult & Partial<WorkspaceRole>;

/**
 * Resolves the caller's workspace and permissions in one round trip.
 *
 * Both dashboard layouts need this, and each was about to need it twice, so it is
 * one call rather than `my_unit` plus `am_i_reviewer` plus a permissions read.
 * Returns `null` for an absent session or a rejected token; callers treat that
 * the same as "not signed in" and send the browser to `/login`.
 */
export async function resolveWorkspaceRole(): Promise<WorkspaceRole | null> {
  const token = await readSessionToken();

  const data = await callRpc<RolePayload>("account_workspace_role", {
    p_session_token: token,
  });

  if (!data.ok || (data.side !== "usg" && data.side !== "lsg")) return null;

  const isUnitAccount = Boolean(data.isUnitAccount);

  return {
    side: data.side === "usg" ? "usg" : "lsg",
    isAdmin: Boolean(data.isAdmin),
    canInvite: !isUnitAccount && Boolean(data.canInvite),
    permissions: Array.isArray(data.permissions) ? data.permissions : [],
    unitId: data.unitId ?? null,
    unitName: data.unitName ?? null,
    accountScope: data.accountScope ?? "",
    accountKind: data.accountKind ?? "",
    isCentral: Boolean(data.isCentral),
    isUnitAccount,
    governanceModel: data.governanceModel ?? null,
  };
}