import { redirect } from "next/navigation";
import Link from "next/link";
import ShaderField from "@/components/fx/ShaderField";
import { Reveal } from "@/components/fx/Reveal";
import { Wordmark, Seal } from "@/components/ui/Seal";
import { ButtonLink } from "@/components/ui/Button";
import { Workspace } from "@/components/dashboard/Workspace";
import { SignOutButton } from "@/components/dashboard/SignOutButton";
import { IconCheck } from "@/components/ui/Icons";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { currentAccount, readSessionToken } from "@/lib/auth/session";

// The dashboard reads the session and live counters on every request, so it
// must never be cached.
export const dynamic = "force-dynamic";

type WorkspacePayload = RpcResult & {
  email: string;
  displayName: string;
  accountKind: "usg" | "central";
  accountScope: "owner" | "invited";
  universityName: string;
  campusName: string;
  organizationName: string;
  charterNumber: string;
  academicYear: string;
  accent: string;
  governanceModel: string | null;
  inviteCount: number;
  pendingCount: number;
  activatedCount: number;
  recentlyApproved: boolean;
};

/**
 * The two dashboards live on one route and differ by `account_kind`, which the
 * database sets from the organization's governance model: federated (USG above
 * its campuses) or unitary (central office above the units).
 *
 * The sign-in gate lives here on the server. `currentAccount` only resolves an
 * `active` account, so someone halfway through the OTP step cannot reach this
 * page even if their session cookie exists.
 */
export default async function DashboardPage() {
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
          The account database is not reachable yet. If the migration has not been
          applied, sign in again once it has.
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

  const centralized = data.accountKind === "central";

  const framing = centralized
    ? {
        eyebrow: "Centralized workspace",
        title: data.organizationName || "Centralized student government office",
        lede:
          "The central office records every unit directly. Individual student governments are not in the chain, so onboarding never depends on them.",
        chain: ["Central office", "Local units", "Officers"],
      }
    : {
        eyebrow: "Decentralized workspace",
        title: data.organizationName || "University student government",
        lede:
          "You sit above your local student governments. Invite an officer, name the campus they belong to, and they become part of your umbrella.",
        chain: ["University", "Your USG", "Local governments"],
      };

  const rows: Array<[string, string]> = [
    ["Account", data.email],
    ["Signed in as", data.displayName],
    ["Role", data.accountScope === "owner" ? "Account owner" : "Invited member"],
    ["Workspace", centralized ? "Centralized" : "Decentralized"],
    ["University", data.universityName || "—"],
    ["Campus", data.campusName || "—"],
    ["Charter", data.charterNumber || "—"],
    ["Academic year", data.academicYear || "—"],
  ];

  return (
    <div className="relative isolate flex min-h-dvh flex-col">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <ShaderField strength={0.5} scale={1.3} speed={0.022} />
        <div className="absolute inset-0 bg-gradient-to-b from-canvas/80 via-canvas/70 to-canvas" />
      </div>

      <header className="border-b border-line/80 bg-canvas/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[82rem] items-center gap-4 px-5 sm:px-8">
          <Link href="/" aria-label="SmartGov home">
            <Wordmark compact />
          </Link>
          <span aria-hidden className="hidden h-4 w-px bg-line sm:block" />
          <p className="hidden truncate text-[0.8125rem] font-medium text-ink-soft sm:block">
            {data.organizationName || "Workspace"}
          </p>
          <div className="ml-auto flex items-center gap-2.5">
            <span className="hidden rounded-full border border-brass/45 bg-brass-soft/35 px-3 py-1 text-[0.625rem] font-semibold tracking-[0.12em] text-ink uppercase sm:inline-flex">
              {centralized ? "Centralized" : "Decentralized"}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[82rem] flex-1 px-5 py-12 sm:px-8 sm:py-14">
        <Reveal className="flex flex-col items-center text-center">
          <Seal size={54} accent={data.accent} />
          <p className="eyebrow mt-6">{framing.eyebrow}</p>
          <h1 className="mt-2 text-[1.875rem] leading-tight sm:text-[2.25rem]">
            {framing.title}
          </h1>
          <p className="mt-3 max-w-xl text-[0.9375rem] leading-relaxed text-body">
            {framing.lede}
          </p>
        </Reveal>

        <Reveal delay={0.06} className="mt-8 flex justify-center">
          <ol className="flex flex-wrap items-center justify-center gap-2 text-[0.75rem] font-medium tracking-[0.08em] text-ink-soft uppercase">
            {framing.chain.map((step, i) => (
              <li key={step} className="flex items-center gap-2">
                {i > 0 ? (
                  <span aria-hidden className="text-brass">
                    /
                  </span>
                ) : null}
                {step}
              </li>
            ))}
          </ol>
        </Reveal>

        <Reveal delay={0.1} className="mt-10">
          {data.recentlyApproved ? (
            <div className="mb-8 flex items-start gap-3 rounded-2xl border border-brass/40 bg-brass-soft/25 px-5 py-4 sm:items-center">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-brass-soft">
                <IconCheck className="h-4 w-4" strokeWidth={2.4} />
              </span>
              <p className="text-[0.875rem] leading-relaxed text-ink">
                <span className="font-semibold">Your USG has been approved.</span>{" "}
                The emailed code verified this workspace, so it is open for
                officers, campuses, and submissions.
              </p>
            </div>
          ) : null}
          <Workspace account={account} variant={data.accountKind} />
        </Reveal>

        <Reveal delay={0.14} className="mt-8">
          <section className="rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
            <p className="eyebrow">Account</p>
            <dl className="mt-4 flex flex-col">
              {rows.map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-baseline justify-between gap-6 border-b border-line/70 py-2.5 last:border-b-0"
                >
                  <dt className="text-[0.75rem] font-medium tracking-[0.06em] text-muted uppercase">
                    {label}
                  </dt>
                  <dd className="truncate text-[0.875rem] text-ink-deep">{value || "—"}</dd>
                </div>
              ))}
            </dl>
          </section>
        </Reveal>
      </main>
    </div>
  );
}
