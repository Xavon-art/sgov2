import { redirect } from "next/navigation";
import ShaderField from "@/components/fx/ShaderField";
import { AppShell } from "@/components/dashboard/AppShell";
import { SessionGuard } from "@/components/dashboard/SessionGuard";
import { DashboardProvider, type DashboardMeta } from "@/components/dashboard/dashboard-context";
import { buildUsgNav } from "@/components/dashboard/usg-nav";
import { ButtonLink } from "@/components/ui/Button";
import { Seal } from "@/components/ui/Seal";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { currentAccount, readSessionToken } from "@/lib/auth/session";
import { resolveWorkspaceRole } from "@/lib/auth/workspace";

// The layout resolves the session and live counters on every navigation, so it
// must never be cached.
export const dynamic = "force-dynamic";

type WorkspacePayload = RpcResult &
  Omit<DashboardMeta, "governanceModel"> & { governanceModel: string | null };

/**
 * The USG workspace shell. University-wide oversight, decisions, and administration.
 *
 * The guard is the reason this file exists separately from the LSG one. An
 * account whose workspace resolves to `lsg` is redirected out before any child
 * renders, so an LSG officer following a `/usg` link lands on their own home
 * instead of a shell that has to hide things from them. Hiding is the wrong tool:
 * the data would still be fetched.
 *
 * Everything under `/usg` inherits this guard. A new page in this tree is
 * protected by being in the tree, not by remembering to add a check.
 */
export default async function UsgLayout({ children }: { children: React.ReactNode }) {
  const account = await currentAccount();
  if (!account) redirect("/login");

  const role = await resolveWorkspaceRole();

  if (!role) redirect("/login");
  if (role.side !== "usg") redirect("/lsg");

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
    theme: data.theme ?? "light",
    logoUrl: data.logoUrl ?? null,
    governanceModel: data.governanceModel,
    inviteCount: data.inviteCount,
    pendingCount: data.pendingCount,
    activatedCount: data.activatedCount,
    recentlyApproved: data.recentlyApproved,
  };

  const nav = buildUsgNav(role);
  const badge = role.isAdmin ? "USG Admin" : "USG workspace";

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