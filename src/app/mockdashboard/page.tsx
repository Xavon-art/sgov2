"use client";

import Link from "next/link";
import { Wordmark, Seal } from "@/components/ui/Seal";
import { useStore } from "@/lib/mockdashboard/use-store";
import { LoadingState } from "@/components/mockdashboard/loading-state";

export default function HomePage() {
  const { state, actions } = useStore();

  if (!state) return <LoadingState />;

  const counts = {
    proposals: state.proposals.length,
    events: state.events.length,
    budgets: state.budgets.length,
    announcements: state.announcements.length,
  };

  return (
    <main className="min-h-screen bg-canvas">
      <header
        className={`sticky top-0 z-40 border-b border-line/80 bg-canvas/85 backdrop-blur-xl backdrop-saturate-150`}
      >
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4 sm:px-6">
          <Link
            href="/"
            className="rounded-lg transition-opacity duration-300 hover:opacity-80"
            aria-label="SmartGov home"
          >
            <Wordmark />
          </Link>
          <button
            onClick={actions.reset}
            className="rounded-full border border-line bg-paper/70 px-4 py-2 text-sm font-medium text-ink transition-colors duration-300 hover:border-line-strong hover:shadow-lift"
          >
            Reset demo data
          </button>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-4 pt-16 pb-14 text-center sm:px-6">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-brass-soft/30 px-3 py-1 text-xs font-semibold text-brass-deep">
          Interactive demo · data lives in your browser
        </span>
        <h1 className="mx-auto mt-5 max-w-2xl text-4xl font-medium tracking-[-0.03em] text-ink-deep sm:text-5xl">
          Student government, filed and approved in one place
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-[0.9375rem] leading-relaxed text-muted">
          The USG reviews proposals, events, and budgets that councils file. Two
          dashboards, one shared workflow — open the USG side, then switch to LSG
          and file something to see it appear for approval.
        </p>

        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <RoleCard
            href="/mockdashboard/usg"
            title="USG dashboard"
            desc="University Student Government — approve proposals, events, budgets; manage units, councils, and announcements."
            tile="bg-ink text-brass"
          />
          <RoleCard
            href="/mockdashboard/lsg"
            title="LSG dashboard"
            desc="Local student council — file proposals, plan events, request funds, and track every status change."
            tile="bg-brass text-ink-deep"
          />
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 pb-16 sm:px-6">
        <div className="rounded-2xl border border-line bg-paper/70 p-6">
          <p className="eyebrow">Demo data loaded</p>
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Proposals" value={counts.proposals} />
            <Stat label="Events" value={counts.events} />
            <Stat label="Budget requests" value={counts.budgets} />
            <Stat label="Announcements" value={counts.announcements} />
          </dl>
        </div>
      </section>
    </main>
  );
}

function RoleCard({
  href,
  title,
  desc,
  tile,
}: {
  href: string;
  title: string;
  desc: string;
  tile: string;
}) {
  return (
    <Link
      href={href}
      className="group relative overflow-hidden rounded-2xl border border-line bg-paper/70 p-6 text-left transition-[border-color,box-shadow,transform] duration-500 ease-out hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lift"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-px origin-top scale-y-0 bg-gradient-to-b from-brass to-transparent transition-transform duration-500 ease-out group-hover:scale-y-100"
      />
      <span
        className={`grid h-10 w-10 place-items-center rounded-xl shadow-[0_1px_0_rgba(255,255,255,0.25)_inset,0_8px_20px_-10px_rgba(13,33,53,0.45)] ${tile}`}
      >
        <Seal size={22} accent={tile.includes("bg-brass") ? "#0d2135" : "#c9a24b"} />
      </span>
      <p className="mt-4 text-lg font-medium tracking-[-0.02em] text-ink group-hover:text-ink-deep">
        {title}
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{desc}</p>
      <span className="mt-4 inline-flex items-center gap-1 text-[0.8125rem] font-medium text-brass-deep">
        Open dashboard
        <span className="transition-transform duration-300 ease-out group-hover:translate-x-0.5">→</span>
      </span>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-muted">{label}</dt>
      <dd className="mt-1 text-[1.75rem] leading-none font-semibold text-ink">{value}</dd>
    </div>
  );
}