import { redirect } from "next/navigation";
import ShaderField from "@/components/fx/ShaderField";
import { AppShell } from "@/components/dashboard/AppShell";
import { SessionGuard } from "@/components/dashboard/SessionGuard";
import { DashboardProvider, type DashboardMeta } from "@/components/dashboard/dashboard-context";
import { buildDashboardNav } from "@/components/dashboard/nav";
import { ButtonLink } from "@/components/ui/Button";
import { Seal } from "@/components/ui/Seal";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { currentAccount, readSessionToken } from "@/lib/auth/session";

// The layout reads the session and live counters on every navigation, so it must
// never be cached.
export const dynamic = "force-dynamic";

type WorkspacePayload = RpcResult &
  Omit<DashboardMeta, "governanceModel"> & { governanceModel: string | null };

/**
 * The shell every dashboard section renders inside.
 *
 * Owns the three things that used to be copied into each page: the sign-in gate,
 * the session guard that ends a session on a fresh document load, and the nav.
 * A section page is now only its own section.
 *
 * The layout is also where the account and the counters are resolved, once. They
 * reach the section routes through `DashboardProvider` rather than each page
 * calling `currentAccount()` again -- a section switch costs one server render,
 * the same as the single page it replaced.
 *
 * The gate stays here rather than in each page because `currentAccount` only ever
 * resolves an `active` account: someone halfway through the OTP step cannot reach
 * a section even with a valid cookie, and that is now true of all four routes
 * instead of one.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const account = await currentAccount();
  if (!account) redirect("/login");

  let data: WorkspacePayload | null = null;
  try {
    const token = await readSessionToken();
    data = await callRpc<WorkspacePayload>("account_workspace", {
      p_session_token: token,
    });
  } catch {
    data = null;
  }

  if (!data?.ok) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <Seal size={48} />
        <h1 className="text-[1.5rem] leading-tight">We could not load your workspace</h1>
        <p className="text-[0.9375rem] leading-relaxed text-body">
          The account database is not reachable yet. If the migration has not been applied, sign in
          again once it has.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <ButtonLink href="/login" size="md">
            Back to sign in
          </ButtonLink>
          <ButtonLink href="/" variant="outline" size="md">
            Home
          </ButtonLink>
        </div>
      </main>
    );
  }

  const meta: DashboardMeta = {
    organizationName: data.organizationName,
    charterNumber: data.charterNumber,
    academicYear: data.academicYear,
    accent: data.accent,
    governanceModel: data.governanceModel,
    inviteCount: data.inviteCount,
    pendingCount: data.pendingCount,
    activatedCount: data.activatedCount,
    recentlyApproved: data.recentlyApproved,
  };

  const nav = buildDashboardNav(account);
  const badge = account.accountKind === "central" ? "Centralized workspace" : "Decentralized workspace";

  return (
    <DashboardProvider value={{ account, meta }}>
      <SessionGuard>
        <div className="relative isolate min-h-dvh">
          <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
            <ShaderField strength={0.5} scale={1.3} speed={0.022} />
            <div className="absolute inset-0 bg-gradient-to-b from-canvas/80 via-canvas/70 to-canvas" />
          </div>

          <AppShell nav={nav} orgName={meta.organizationName || "Workspace"} badge={badge}>
            {children}
          </AppShell>
        </div>
      </SessionGuard>
    </DashboardProvider>
  );
}