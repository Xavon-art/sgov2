"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Account } from "@/lib/auth/session";
import type { WorkspaceRole } from "@/lib/auth/workspace";

/**
 * What the dashboard layout resolved once, published to every section route.
 *
 * Sections are separate routes now, and each one needs the account -- to decide
 * whether it may render at all, and whether the decentralized or centralized
 * framing applies. The obvious wiring is for each page to call `currentAccount()`
 * itself, but the layout has already resolved it, so that is a second session
 * lookup on every navigation for an answer the tree is holding.
 *
 * So the layout resolves the account and the workspace counters in one place and
 * hands them down here. Each section route costs no server reads of its own, which
 * is what keeps a section switch no more expensive than the single page it
 * replaced -- prefetched and rendered from one payload.
 *
 * The provider sits inside the gate, so it only ever holds a resolved, `active`
 * account. There is no path that puts `null` in front of a panel.
 */
export type DashboardMeta = {
  organizationName: string;
  charterNumber: string;
  academicYear: string;
  accent: string;
  theme: string;
  logoUrl: string | null;
  governanceModel: string | null;
  inviteCount: number;
  pendingCount: number;
  activatedCount: number;
  recentlyApproved: boolean;
};

type DashboardValue = {
  account: Account;
  meta: DashboardMeta;
  /**
   * The server-resolved workspace side. Children use it for capability gating
   * instead of inferring a role from client-supplied account fields.
   */
  role: WorkspaceRole;
};

const DashboardContext = createContext<DashboardValue | null>(null);

export function DashboardProvider({
  value,
  children,
}: {
  value: DashboardValue;
  children: ReactNode;
}) {
  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

/**
 * Throws rather than returning null. A missing provider is a wiring mistake, not
 * a state to render around, and failing here beats every section independently
 * inventing its own answer for an absent account.
 */
export function useDashboard(): DashboardValue {
  const value = useContext(DashboardContext);
  if (!value) {
    throw new Error("useDashboard must be called inside <DashboardProvider>");
  }
  return value;
}

export function useAccount(): Account {
  return useDashboard().account;
}

type IdentityFields = {
  isCentral?: boolean;
  isUnitAccount?: boolean;
  governanceModel?: "federated" | "unitary" | null;
};

function identityFields(value: Account | WorkspaceRole): IdentityFields {
  return value as unknown as IdentityFields;
}

export function WorkspaceGuard({ section }: { section: "usg" | "lsg" }) {
  const { account, role } = useDashboard();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const accountIdentity = identityFields(account);
    const roleIdentity = identityFields(role);
    const central =
      accountIdentity.isCentral === true ||
      roleIdentity.isCentral === true ||
      roleIdentity.governanceModel === "unitary";
    const unit =
      accountIdentity.isUnitAccount === true || roleIdentity.isUnitAccount === true;

    let target: string | null = null;
    if (central && section === "lsg") target = "/usg";
    else if (unit && section === "usg") target = "/lsg";
    else if (!central && role.side !== section) {
      target = role.side === "usg" ? "/usg" : "/lsg";
    }

    if (target && pathname !== target) router.replace(target);
  }, [account, role, pathname, router, section]);

  return null;
}
