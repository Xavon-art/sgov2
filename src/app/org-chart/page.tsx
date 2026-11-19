import { redirect } from "next/navigation";
import Link from "next/link";
import ShaderField from "@/components/fx/ShaderField";
import { Reveal } from "@/components/fx/Reveal";
import { Wordmark } from "@/components/ui/Seal";
import { ButtonLink } from "@/components/ui/Button";
import { SignOutButton } from "@/components/dashboard/SignOutButton";
import { SessionGuard } from "@/components/dashboard/SessionGuard";
import {
  AddPositionControl,
  SeatRow,
  UnitSeatToggles,
} from "@/components/org-chart/OrgChartControls";
import { currentAccount, readSessionToken } from "@/lib/auth/session";
import { ChartRefresher } from "@/components/org-chart/ChartRefresher";
import { ChartViewer } from "@/components/structure/ChartViewer";
import { fetchOrgStructureForSession } from "@/lib/structure-server";
import {
  fetchRoster,
  fetchUnitChart,
  unitTypeLabel,
  type ChartPosition,
  type ChartUnit,
  type RosterEntry,
} from "@/lib/chart";

// The chart is scoped in Postgres to whatever the session token resolves to, so
// it changes with the cookie and must never be cached.
export const dynamic = "force-dynamic";

function UnitCard({
  unit,
  positions,
  roster,
  rosterAvailable,
}: {
  unit: ChartUnit;
  positions: ChartPosition[];
  roster: RosterEntry[];
  rosterAvailable: boolean;
}) {
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
            <SeatRow
              key={seat.positionId}
              seat={seat}
              unitId={unit.id}
              unitType={unit.unitType}
              roster={roster}
              rosterAvailable={rosterAvailable}
            />
          ))}
        </ul>
      ) : (
        // A unit with nothing enabled still renders, deliberately: the empty
        // card is how an owner sees that it exists and needs staffing.
        <p className="mt-4 text-[0.8125rem] leading-relaxed text-muted">
          No positions are enabled for this unit yet.
        </p>
      )}

      <UnitSeatToggles unit={unit} positions={positions} />
    </article>
  );
}

/**
 * The owner's view of the organization, from one scoped read.
 *
 * An LSG officer is sent to the council page instead: their chart is scoped to
 * their own unit and its parent, and rendering a one-unit version of this page
 * would be a second, differently-shaped view of the same data.
 */
export default async function OrgChartPage() {
  // The chart function authenticates the token itself, but it answers
  // `unauthenticated` for a lapsed session exactly as it does for an
  // unreachable database. Resolving the account first sends the expired cookie
  // to sign-in rather than to the error state, which is the order the dashboard
  // uses.
  const account = await currentAccount();
  if (!account) redirect("/login");

  const token = await readSessionToken();
  if (!token) redirect("/login");

  const chart = await fetchUnitChart(token);
  const roster = await fetchRoster(token);
  const org = await fetchOrgStructureForSession(token);

  if (!chart) {
    return (
      <>
        <ChartRefresher />
        <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
          <h1 className="text-[1.5rem] leading-tight">We could not load your organization chart</h1>
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

  if (chart.scope === "unit") redirect("/my-council");

  const { root } = chart;
  // The owner branch of the function aggregates every unit in the organization
  // into `units`, root included, so the top card would otherwise be drawn twice.
  const children = chart.units.filter((unit) => unit.id !== root?.id);
  const title = root?.name || account.universityName || "Organization chart";

  return (
    <SessionGuard>
    <div className="relative isolate flex min-h-dvh flex-col">
      <ChartRefresher />
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <ShaderField strength={0.5} scale={1.3} speed={0.022} />
        <div className="absolute inset-0 bg-gradient-to-b from-canvas/80 via-canvas/70 to-canvas" />
      </div>

      <header data-tour="org-chart-header" className="border-b border-line/80 bg-canvas/70 backdrop-blur-xl">
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
              Owner view
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[82rem] flex-1 px-5 py-12 sm:px-8 sm:py-14">
        <Reveal className="flex flex-col items-center text-center">
          <p className="eyebrow">Organization chart</p>
          <h1 className="mt-2 text-[1.875rem] leading-tight sm:text-[2.25rem]">{title}</h1>
          <p className="mt-3 max-w-xl text-[0.9375rem] leading-relaxed text-body">
            Your student government at the top, every college, campus, and department beneath
            it, and who holds each seat.
          </p>
        </Reveal>

        <Reveal delay={0.04} className="mt-10">
          <div data-tour="org-chart-add-position" className="contents">
          <AddPositionControl positions={chart.positions} />
          </div>
        </Reveal>

        <Reveal delay={0.06} className="mt-4">
          <section data-tour="org-chart-root" className="rounded-2xl border border-line-strong bg-paper/80 p-6 shadow-lift sm:p-7">
            <p className="eyebrow">Top of the chart</p>
            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-[1.25rem] leading-snug text-ink-deep">
                {root?.name || "Your student government"}
              </h2>
              <span className="rounded-full border border-brass/45 bg-brass-soft/30 px-2.5 py-1 text-[0.625rem] font-semibold tracking-[0.12em] text-ink uppercase">
                {unitTypeLabel(root?.unitType)}
              </span>
            </div>
          </section>
        </Reveal>

        {org?.structure ? (
          <Reveal delay={0.08} className="mt-6">
            <section
              data-tour="org-chart-published"
              className="rounded-2xl border border-line bg-paper/80 p-5 shadow-lift sm:p-6"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <p className="eyebrow">Published officer chart</p>
                  <p className="mt-1 text-[0.875rem] text-body">
                    {org.structure.termLabel} &middot; revision {org.structure.revision}
                  </p>
                </div>
                <Link
                  href="/dashboard"
                  className="text-[0.75rem] font-medium text-brass hover:underline"
                >
                  Open the builder
                </Link>
              </div>
              <div className="mt-4">
                <ChartViewer
                  doc={org.structure.document}
                  title={`${org.unit?.name ?? title} officers`}
                  subtitle={`${org.structure.termLabel} · revision ${org.structure.revision}`}
                  filename={`${(org.unit?.name ?? title).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-officers`}
                  maxHeight={560}
                />
              </div>
            </section>
          </Reveal>
        ) : null}

        <div data-tour="org-chart-units" className="mt-8">
          {children.length === 0 ? (
            <Reveal delay={0.1}>
              <section className="rounded-2xl border border-line bg-paper/70 px-6 py-10 text-center sm:px-7">
                <p className="eyebrow">Nothing beneath it yet</p>
                <h2 className="mt-2 text-[1.25rem] leading-snug text-ink-deep">
                  Your organization is a single council
                </h2>
                <p className="mx-auto mt-3 max-w-md text-[0.875rem] leading-relaxed text-body">
                  The setup wizard is what creates the units under you, and this organization
                  was created without any. Its officers are recorded on the top card instead of
                  a council of its own.
                </p>
                <div className="mt-6 flex justify-center">
                  <ButtonLink href="/dashboard" variant="outline" size="md">
                    Back to dashboard
                  </ButtonLink>
                </div>
              </section>
            </Reveal>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {children.map((unit, i) => (
                <Reveal key={unit.id} delay={i * 0.02}>
                  <UnitCard
                    unit={unit}
                    positions={chart.positions}
                    roster={roster ?? []}
                    rosterAvailable={roster !== null}
                  />
                </Reveal>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
    </SessionGuard>
  );
}
