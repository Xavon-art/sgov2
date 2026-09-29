"use client";

import Link from "next/link";
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
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white">
              SG
            </span>
            <span className="text-sm font-semibold text-slate-900">SmartGov</span>
          </div>
          <button
            onClick={actions.reset}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          >
            Reset demo data
          </button>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-4 py-14 text-center sm:px-6">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
          Interactive demo · data lives in your browser
        </span>
        <h1 className="mx-auto mt-4 max-w-2xl text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Student government, filed and approved in one place
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-500">
          The USG reviews proposals, events, and budgets that councils file. Two
          dashboards, one shared workflow — open the USG side, then switch to LSG
          and file something to see it appear for approval.
        </p>

        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <RoleCard
            href="/mockdashboard/usg"
            title="USG dashboard"
            desc="University Student Government — approve proposals, events, budgets; manage units, councils, and announcements."
            accent="bg-indigo-600"
          />
          <RoleCard
            href="/mockdashboard/lsg"
            title="LSG dashboard"
            desc="Local student council — file proposals, plan events, request funds, and track every status change."
            accent="bg-emerald-600"
          />
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 pb-14 sm:px-6">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Demo data loaded</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
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
  accent,
}: {
  href: string;
  title: string;
  desc: string;
  accent: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm text-white ${accent}`}>
        →
      </span>
      <p className="mt-3 text-base font-semibold text-slate-900 group-hover:text-indigo-600">{title}</p>
      <p className="mt-1 text-sm leading-5 text-slate-500">{desc}</p>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-2xl font-bold text-slate-900">{value}</dd>
    </div>
  );
}