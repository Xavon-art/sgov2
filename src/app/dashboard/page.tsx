import { redirect } from "next/navigation";
import Link from "next/link";
import ShaderField from "@/components/fx/ShaderField";
import { Reveal } from "@/components/fx/Reveal";
import { Seal } from "@/components/ui/Seal";
import { ButtonLink } from "@/components/ui/Button";
import { AppShell, type NavItem } from "@/components/dashboard/AppShell";
import { Workspace } from "@/components/dashboard/Workspace";
import {
  IconArrowRight,
  IconBuilding,
  IconCheck,
  IconClock,
  IconLayers,
  IconMail,
  IconUser,
} from "@/components/ui/Icons";
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
 * database sets from the organization's governance model. The sign-in gate
 * lives here on the server: `currentAccount` only resolves an `active` account,
 * so someone halfway through the OTP step cannot reach this page even if their
 * session cookie exists.
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
  const isOwner = data.accountScope === "owner";
  const isUsg = data.accountKind === "usg";

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
    ["Role", isOwner ? "Account owner" : "Invited member"],
    ["Scope", centralized ? "Central office" : "University student government"],
    ["University", data.universityName || "—"],
    ["Campus", data.campusName || "—"],
    ["Charter", data.charterNumber || "—"],
    ["Academic year", data.academicYear || "—"],
  ];

  const nav: NavItem[] = [
    { id: "overview", label: "Overview", hint: framing.eyebrow, icon: "dashboard", active: true },
    ...(isOwner && isUsg
      ? [{ id: "units", label: "Campuses", hint: "Add a campus or department", icon: "pyramid" as const }]
      : []),
    ...(isOwner ? [{ id: "invitations", label: "Invitations", hint: "Officers you have asked to join", icon: "user" as const }] : []),
    { id: "account", label: "Account", hint: "Your sign-in details", icon: "lock" },
  ];

  const counters = [
    {
      label: "Invitations",
      value: data.inviteCount,
      icon: IconMail,
      hint: "Officers you have asked to join",
    },
    {
      label: "Pending",
      value: data.pendingCount,
      icon: IconClock,
      hint: "Awaiting their emailed code",
    },
    {
      label: "Activated",
      value: data.activatedCount,
      icon: IconCheck,
      hint: "Live in your workspace",
    },
  ];

  return (
    <div className="relative isolate min-h-dvh">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <ShaderField strength={0.5} scale={1.3} speed={0.022} />
        <div className="absolute inset-0 bg-gradient-to-b from-canvas/80 via-canvas/70 to-canvas" />
      </div>

      <AppShell nav={nav} orgName={data.organizationName || "Workspace"} badge={framing.eyebrow}>
        {/* Overview */}
        <section id="overview" className="scroll-mt-24">
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
            <ol className="flex flex-wrap items-center justify-center gap-2 text-[0.6875rem] font-medium tracking-[0.1em] text-ink-soft uppercase">
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

          {data.recentlyApproved ? (
            <Reveal delay={0.08} className="mt-8">
              <div className="flex items-start gap-3 rounded-2xl border border-brass/40 bg-brass-soft/25 px-5 py-4 sm:items-center">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-brass-soft">
                  <IconCheck className="h-4 w-4" strokeWidth={2.4} />
                </span>
                <p className="text-[0.875rem] leading-relaxed text-ink">
                  <span className="font-semibold">Your USG has been approved.</span>{" "}
                  The emailed code verified this workspace, so it is open for
                  officers, campuses, and submissions.
                </p>
              </div>
            </Reveal>
          ) : null}

          <Reveal delay={0.1} className="mt-8">
            <div className="grid gap-4 sm:grid-cols-3">
              {counters.map((stat) => {
                const Icon = stat.icon;
                return (
                  <div
                    key={stat.label}
                    className="flex items-start gap-4 rounded-2xl border border-line bg-paper/70 px-5 py-4"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-full border border-brass/40 bg-brass-soft/25 text-brass-deep">
                      <Icon className="h-[1.15rem] w-[1.15rem]" strokeWidth={1.8} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[0.6875rem] font-semibold tracking-[0.1em] text-muted uppercase">
                        {stat.label}
                      </p>
                      <p className="mt-1.5 text-[1.875rem] leading-none font-semibold text-ink">
                        {stat.value}
                      </p>
                      <p className="mt-1 truncate text-[0.75rem] text-muted">{stat.hint}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Reveal>

          {isOwner ? (
            <Reveal delay={0.12} className="mt-6 grid gap-4 sm:grid-cols-2">
              <Link
                href={isUsg ? "#units" : "#invitations"}
                className="group flex min-h-24 items-center gap-4 rounded-2xl border border-line bg-paper/70 px-5 py-4 transition-[border-color,box-shadow] duration-300 hover:border-line-strong hover:shadow-lift"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-full border border-line-strong bg-canvas text-brass-deep">
                  {isUsg ? (
                    <IconBuilding className="h-[1.15rem] w-[1.15rem]" strokeWidth={1.8} />
                  ) : (
                    <IconUser className="h-[1.15rem] w-[1.15rem]" strokeWidth={1.8} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.9375rem] font-medium text-ink">
                    {isUsg ? "Add a campus or department" : "Invite a unit"}
                  </span>
                  <span className="mt-0.5 block text-[0.8125rem] text-muted">
                    {isUsg
                      ? "Create a campus first, then invite an LSG officer into it."
                      : "Record that unit directly under your office."}
                  </span>
                </span>
                <IconArrowRight
                  className="h-4 w-4 shrink-0 text-brass-deep transition-transform duration-300 group-hover:translate-x-0.5"
                  strokeWidth={1.8}
                />
              </Link>

              <Link
                href="#invitations"
                className="group flex min-h-24 items-center gap-4 rounded-2xl border border-line bg-paper/70 px-5 py-4 transition-[border-color,box-shadow] duration-300 hover:border-line-strong hover:shadow-lift"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-full border border-line-strong bg-canvas text-brass-deep">
                  <IconLayers className="h-[1.15rem] w-[1.15rem]" strokeWidth={1.8} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.9375rem] font-medium text-ink">
                    Review your invitations
                  </span>
                  <span className="mt-0.5 block text-[0.8125rem] text-muted">
                    See who has activated, who is waiting, and who to follow up with.
                  </span>
                </span>
                <IconArrowRight
                  className="h-4 w-4 shrink-0 text-brass-deep transition-transform duration-300 group-hover:translate-x-0.5"
                  strokeWidth={1.8}
                />
              </Link>
            </Reveal>
          ) : (
            <Reveal delay={0.12} className="mt-6">
              <div className="flex items-start gap-3 rounded-2xl border border-brass/40 bg-brass-soft/20 px-5 py-4">
                <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-brass-deep" strokeWidth={2} />
                <p className="text-[0.875rem] leading-relaxed text-ink">
                  You were invited by {data.organizationName || "your student government"} and
                  your workspace is scoped to {data.campusName || "your unit"}. Only an
                  account owner can send invitations.
                </p>
              </div>
            </Reveal>
          )}
        </section>

        {/* Owner workspace: add units + send invitations + the table */}
        {isOwner ? (
          <section id="invitations" className="mt-12 scroll-mt-24">
            <div className="mb-5 flex items-end justify-between gap-4 border-b border-line/80 pb-4">
              <div>
                <p className="eyebrow">Officers & units</p>
                <h2 className="mt-1 text-[1.375rem] leading-tight sm:text-[1.625rem]">
                  Build your umbrella
                </h2>
              </div>
              <p className="hidden text-[0.8125rem] text-muted sm:block">
                {centralized ? "Units on record" : "Campuses under you"}
              </p>
            </div>
            <Workspace account={account} variant={data.accountKind} />
          </section>
        ) : null}

        {/* Account */}
        <section id="account" className="mt-12 scroll-mt-24">
          <Reveal>
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
        </section>
      </AppShell>
    </div>
  );
}