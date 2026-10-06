import { redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import ShaderField from "@/components/fx/ShaderField";
import { Reveal } from "@/components/fx/Reveal";
import { Wordmark } from "@/components/ui/Seal";
import { ButtonLink } from "@/components/ui/Button";
import { SignOutButton } from "@/components/dashboard/SignOutButton";
import { SessionGuard } from "@/components/dashboard/SessionGuard";
import { currentAccount, readSessionToken } from "@/lib/auth/session";
import { ChartRefresher } from "@/components/org-chart/ChartRefresher";
import {
  fetchUnitChartResult,
  isUnitScopeChart,
  unitTypeLabel,
  type ChartSeat,
  type ChartUnit,
} from "@/lib/chart";

// The chart is scoped in Postgres to whatever the session token resolves to, so
// it changes with the cookie and must never be cached.
export const dynamic = "force-dynamic";

function PageShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col">
      <ChartRefresher />
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
            {title}
          </p>
          <div className="ml-auto flex items-center gap-2.5">
            <span className="hidden rounded-full border border-brass/45 bg-brass-soft/35 px-3 py-1 text-[0.625rem] font-semibold tracking-[0.12em] text-ink uppercase sm:inline-flex">
              Your council
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[82rem] flex-1 px-5 py-12 sm:px-8 sm:py-14">
        {children}
      </main>
    </div>
  );
}

function CouncilError() {
  return (
    <>
      <ChartRefresher />
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-[1.5rem] leading-tight">We could not load your council</h1>
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
    </>
  );
}

function NoSeatState() {
  return (
    <PageShell title="Your council">
      <Reveal className="flex flex-col items-center text-center">
        <p className="eyebrow">My council</p>
        <h1 className="mt-2 text-[1.875rem] leading-tight sm:text-[2.25rem]">
          Your council
        </h1>
      </Reveal>

      <Reveal delay={0.04} className="mt-10">
        <section className="mx-auto max-w-lg rounded-2xl border border-line bg-paper/70 px-6 py-10 text-center sm:px-7">
          <p className="eyebrow">No seat yet</p>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-body">
            {"You don't hold a seat in any council yet. Your USG officer can assign you one from the org chart."}
          </p>
          <div className="mt-6 flex justify-center">
            <ButtonLink href="/dashboard" variant="outline" size="md">
              Back to dashboard
            </ButtonLink>
          </div>
        </section>
      </Reveal>
    </PageShell>
  );
}

function SeatLine({ seat }: { seat: ChartSeat }) {
  const held = Boolean(seat.rosterId);

  return (
    <li className="border-b border-line/70 py-2.5 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <span className="text-[0.875rem] text-ink-deep">{seat.label}</span>

        {held ? (
          <span className="min-w-0 text-right">
            <span className="block truncate text-[0.8125rem] font-medium text-ink">
              {seat.fullName || seat.email}
            </span>
            {seat.email ? (
              <span className="block truncate text-[0.75rem] text-muted">
                {seat.email}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="rounded-full border border-line px-2.5 py-1 text-[0.6875rem] font-semibold tracking-[0.06em] uppercase text-muted">
            Vacant
          </span>
        )}
      </div>
    </li>
  );
}

function UnitCard({ unit }: { unit: ChartUnit }) {
  return (
    <article className="rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-[1.0625rem] leading-snug text-ink-deep">{unit.name}</h3>
        <span className="rounded-full border border-brass/45 bg-brass-soft/30 px-2.5 py-1 text-[0.625rem] font-semibold tracking-[0.12em] text-ink uppercase">
          {unitTypeLabel(unit.unitType)}
        </span>
      </div>

      {unit.seats.length > 0 ? (
        <ul className="mt-4 flex flex-col">
          {unit.seats.map((seat) => (
            <SeatLine key={seat.positionId} seat={seat} />
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-[0.8125rem] leading-relaxed text-muted">
          No positions are enabled for this unit yet.
        </p>
      )}
    </article>
  );
}

/**
 * The LSG officer's read-only view of their own council.
 *
 * Every row on this page comes from the single `unit_chart` call below, which
 * the database has already narrowed to the caller's own units and their
 * parent USG. Nothing else is fetched: the scoping is the point of the page,
 * and a second call to "fill in details" would be a second chance to widen it.
 */
export default async function MyCouncilPage() {
  // The chart function authenticates the token itself, but it answers
  // `unauthenticated` for a lapsed session exactly as it does for an
  // unreachable database. Resolving the account first sends the expired cookie
  // to sign-in rather than to the error state, which is the order the dashboard
  // uses.
  const account = await currentAccount();
  if (!account) redirect("/login");

  const token = await readSessionToken();
  if (!token) redirect("/login");

  const result = await fetchUnitChartResult(token);

  if (!result) return <CouncilError />;

  if (!result.ok) {
    // `no_unit` is not a failure: it is the answer to "what can this officer
    // see", and the empty state is the honest rendering of it.
    if (result.reason === "no_unit") return <NoSeatState />;
    return <CouncilError />;
  }

  // The owner's chart is the whole organization; they belong on the owner
  // page. This redirect is part of the scoping: nothing below it renders
  // unless the database has narrowed the chart to one officer.
  if (!isUnitScopeChart(result)) redirect("/org-chart");

  const { root, units } = result;
  const ownUnits = root ? units.filter((unit) => unit.id !== root.id) : units;
  // A unitary organization has no USG above the council, so the officer's own
  // unit is the root and the only unit: it must still render as a card, or
  // its seats would never appear.
  const cardUnits = ownUnits.length > 0 ? ownUnits : units;
  const unitary = ownUnits.length === 0;
  const title = cardUnits.length === 1 ? cardUnits[0].name : "Your council";

  return (
    <SessionGuard>
    <PageShell title={title}>
      <Reveal className="flex flex-col items-center text-center">
        <p className="eyebrow">My council</p>
        <h1 className="mt-2 text-[1.875rem] leading-tight sm:text-[2.25rem]">
          {title}
        </h1>
        <p className="mt-3 max-w-xl text-[0.9375rem] leading-relaxed text-body">
          {unitary
            ? "Your council and who holds each seat. This view is read-only."
            : "Your student government above, your council beneath it, and who holds each seat. This view is read-only."}
        </p>
      </Reveal>

      {root && !unitary ? (
        <Reveal delay={0.04} className="mt-10">
          <section className="rounded-2xl border border-line-strong bg-paper/80 p-6 shadow-lift sm:p-7">
            <p className="eyebrow">Top of the chart</p>
            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-[1.25rem] leading-snug text-ink-deep">
                {root.name}
              </h2>
              <span className="rounded-full border border-brass/45 bg-brass-soft/30 px-2.5 py-1 text-[0.625rem] font-semibold tracking-[0.12em] text-ink uppercase">
                {unitTypeLabel(root.unitType)}
              </span>
            </div>
          </section>
        </Reveal>
      ) : null}

      <div className="mt-8">
        <div className="grid gap-4 sm:grid-cols-2">
          {cardUnits.map((unit, i) => (
            <Reveal key={unit.id} delay={0.06 + i * 0.02}>
              <UnitCard unit={unit} />
            </Reveal>
          ))}
        </div>
      </div>

      {/* This page is reached from the structure builder's "Back to council" and
          has no app nav of its own, so without a way out it is a dead end: the
          officer would have to edit the URL to reach the page they came from. */}
      <Reveal delay={0.1} className="mt-10">
        <div className="flex flex-wrap justify-center gap-3">
          <ButtonLink href="/dashboard" variant="outline" size="md">
            Back to dashboard
          </ButtonLink>
          <ButtonLink href="/my-council/structure" variant="paper" size="md">
            Council structure
          </ButtonLink>
        </div>
      </Reveal>
    </PageShell>
    </SessionGuard>
  );
}
