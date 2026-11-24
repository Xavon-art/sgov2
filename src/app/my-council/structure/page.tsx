import { redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import ShaderField from "@/components/fx/ShaderField";
import { Reveal } from "@/components/fx/Reveal";
import { Wordmark } from "@/components/ui/Seal";
import { SignOutButton } from "@/components/dashboard/SignOutButton";
import { SessionGuard } from "@/components/dashboard/SessionGuard";
import { StructureWorkspace } from "@/components/structure/StructureWorkspace";
import { currentAccount, readSessionToken } from "@/lib/auth/session";
import { fetchUnitChartResult, isUnitScopeChart } from "@/lib/chart";
import { structureFormat } from "@/lib/structure";
import { fetchStructureForSession } from "@/lib/structure-server";

/**
 * The officer's own council, on its own page.
 *
 * The unit id is not a query parameter. It comes from `unit_chart`, which the
 * database has already narrowed to this caller's own seats, so there is no way
 * to arrive here holding somebody else's council id -- putting it in the URL
 * would make the page's scope something a person could edit.
 */
export const dynamic = "force-dynamic";

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div data-tour="council-structure-shell" className="relative isolate flex min-h-dvh flex-col">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <ShaderField strength={0.5} scale={1.3} speed={0.022} />
        <div className="absolute inset-0 bg-gradient-to-b from-canvas/80 via-canvas/70 to-canvas" />
      </div>

      <header data-tour="council-structure-header" className="border-b border-line/80 bg-canvas/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[82rem] items-center gap-4 px-5 sm:px-8">
          <Link href="/" aria-label="SmartGov home">
            <Wordmark compact />
          </Link>
          <span aria-hidden className="hidden h-4 w-px bg-line sm:block" />
          <p className="hidden truncate text-[0.8125rem] font-medium text-ink-soft sm:block">
            {title}
          </p>
          <div className="ml-auto flex items-center gap-2.5">
            <Link
              href="/my-council"
              className="hidden rounded-full border border-line px-3.5 py-1.5 text-[0.8125rem] font-medium text-ink-soft transition-colors hover:border-line-strong hover:text-ink sm:inline-flex"
            >
              My council
            </Link>
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

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <Reveal className="flex flex-col items-center text-center">
      <p className="eyebrow">Structure</p>
      <h1 className="mt-2 text-[1.875rem] leading-tight sm:text-[2.25rem]">{title}</h1>
      <p className="mt-3 max-w-xl text-[0.9375rem] leading-relaxed text-body">{body}</p>
    </Reveal>
  );
}

export default async function StructurePage() {
  const account = await currentAccount();
  if (!account) redirect("/login");

  const isOwner = account.accountScope === "owner";

  const token = await readSessionToken();
  if (!token) redirect("/login");

  const chart = await fetchUnitChartResult(token);
  if (!chart) {
    return (
      <Shell title="Structure">
        <Empty
          title="We could not load your council"
          body="The account database is not reachable yet. Sign in again once the structure migration has been applied."
        />
      </Shell>
    );
  }
  if (!chart.ok) {
    if (chart.reason === "no_unit") {
      return (
        <Shell title="Structure">
          <Empty
            title="No seat yet"
            body="You do not hold a seat in any council yet, so there is no structure to build. Your USG officer can assign you one from the org chart."
          />
        </Shell>
      );
    }
    return (
      <Shell title="Structure">
        <Empty
          title="We could not load your council"
          body="The account database did not answer. Sign in again in a moment."
        />
      </Shell>
    );
  }

  // An owner edits their own USG council here too. Only non-owners without a
  // unit scope are bounced to the USG queue.
  if (!isUnitScopeChart(chart) && !isOwner) redirect("/usg/structure");

  // A chart in unit scope has the council as its root, or as the single unit
  // beneath the USG root. Both resolve to one council, and that council is the
  // subject of the page. An owner edits the root unit (their USG) itself.
  const root = chart.root;
  const belowRoot = root ? chart.units.filter((u) => u.id !== root.id) : chart.units;
  const own = isOwner
    ? root ?? belowRoot[0]
    : belowRoot.find((u) => u.unitType === "lsg") ?? belowRoot[0] ?? root;

  if (!own) {
    return (
      <Shell title="Structure">
        <Empty
          title="No council found"
          body="Your account is scoped to a unit that no longer exists. Ask your USG officer to check the org chart."
        />
      </Shell>
    );
  }

  // The capability is read here rather than assumed. `get_structure` decides
  // whether this account may edit this council, and the page renders an editor
  // or a viewer on that answer alone.
  const structure = await fetchStructureForSession(token, own.id);
  if (!structure?.ok || !structure.capability?.canRead) {
    return (
      <Shell title="Structure">
        <Empty
          title="We could not load this structure"
          body="The database did not answer with this council. If you believe you should have access, ask your USG officer to check your seat."
        />
      </Shell>
    );
  }

  return (
    <SessionGuard>
      <Shell title={own.name}>
        <Reveal className="flex flex-col items-center text-center">
          <p className="eyebrow">Structure</p>
          <h1 className="mt-2 text-[1.875rem] leading-tight sm:text-[2.25rem]">{own.name}</h1>
          <p className="mt-3 max-w-2xl text-[0.9375rem] leading-relaxed text-body">
            Build your council and its committees, name the officers who hold each seat, and
            send the whole thing to your USG for approval.
          </p>
        </Reveal>

        <div data-tour="council-structure-workspace" className="mt-10">
          <StructureWorkspace
            unitId={own.id}
            unitName={own.name}
            scope={isOwner ? "usg" : "lsg"}
            format={structureFormat({ isRoot: isOwner, unitType: own.unitType })}
            capability={structure.capability}
          />
        </div>
      </Shell>
    </SessionGuard>
  );
}