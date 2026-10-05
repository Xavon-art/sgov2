"use client";

import Link from "next/link";
import { Reveal } from "@/components/fx/Reveal";
import { Seal } from "@/components/ui/Seal";
import { IconArrowRight, IconBuilding, IconCheck, IconClock, IconLayers, IconMail, IconUser } from "@/components/ui/Icons";
import { useDashboard } from "@/components/dashboard/dashboard-context";

/**
 * Overview: what this workspace is, how many invitations it has, and the two
 * things an owner can do next.
 *
 * Counters come from the layout rather than from a request of its own. They were
 * never live-updated when an invitation was sent -- the single page did not
 * revalidate either -- so reading them from the layout costs nothing in accuracy
 * and saves a server read on every visit.
 */
export function OverviewSection() {
  const { account, meta } = useDashboard();

  const centralized = account.accountKind === "central";
  const isOwner = account.accountScope === "owner";
  const isUsg = account.accountKind === "usg";

  const framing = centralized
    ? {
        eyebrow: "Centralized workspace",
        title: meta.organizationName || "Centralized student government office",
        lede: "The central office records every unit directly. Individual student governments are not in the chain, so onboarding never depends on them.",
        chain: ["Central office", "Local units", "Officers"],
      }
    : {
        eyebrow: "Decentralized workspace",
        title: meta.organizationName || "University student government",
        lede: "You sit above your local student governments. Invite an officer, name the campus they belong to, and they become part of your umbrella.",
        chain: ["University", "Your USG", "Local governments"],
      };

  const counters = [
    {
      label: "Invitations",
      value: meta.inviteCount,
      icon: IconMail,
      hint: "Officers you have asked to join",
    },
    {
      label: "Pending",
      value: meta.pendingCount,
      icon: IconClock,
      hint: "Awaiting their emailed code",
    },
    {
      label: "Activated",
      value: meta.activatedCount,
      icon: IconCheck,
      hint: "Live in your workspace",
    },
  ];

  return (
    <section id="overview" className="scroll-mt-24">
      <Reveal className="flex flex-col items-center text-center">
        <Seal size={54} accent={meta.accent} />
        <p className="eyebrow mt-6">{framing.eyebrow}</p>
        <h1 className="mt-2 text-[1.875rem] leading-tight sm:text-[2.25rem]">{framing.title}</h1>
        <p className="mt-3 max-w-xl text-[0.9375rem] leading-relaxed text-body">{framing.lede}</p>
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

      {meta.recentlyApproved ? (
        <Reveal delay={0.08} className="mt-8">
          <div className="flex items-start gap-3 rounded-2xl border border-brass/40 bg-brass-soft/25 px-5 py-4 sm:items-center">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-brass-soft">
              <IconCheck className="h-4 w-4" strokeWidth={2.4} />
            </span>
            <p className="text-[0.875rem] leading-relaxed text-ink">
              <span className="font-semibold">Your USG has been approved.</span> The emailed code
              verified this workspace, so it is open for officers, campuses, and submissions.
            </p>
          </div>
        </Reveal>
      ) : null}

      <Reveal delay={0.1} className="mt-8">
        <div className="grid gap-4 sm:grid-cols-3">
          {counters.map((stat) => {
            const Icon = stat.icon;
            return (
              <Link
                key={stat.label}
                href="/usg/invitations"
                className="group flex items-start gap-4 rounded-2xl border border-line bg-paper/70 px-5 py-4 transition-[border-color,box-shadow] duration-300 hover:border-line-strong hover:shadow-lift"
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
              </Link>
            );
          })}
        </div>
      </Reveal>

      {isOwner ? (
        <Reveal delay={0.12} className="mt-6 grid gap-4 sm:grid-cols-2">
          <Link
            href={isUsg ? "/usg/units" : "/usg/invitations"}
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
            href="/usg/invitations"
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
              You were invited by {meta.organizationName || "your student government"} and your
              workspace is scoped to {account.campusName || "your unit"}. Only an account owner can
              send invitations.
            </p>
          </div>
        </Reveal>
      )}
    </section>
  );
}