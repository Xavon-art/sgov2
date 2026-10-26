import { redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import ShaderField from "@/components/fx/ShaderField";
import { Reveal } from "@/components/fx/Reveal";
import { Wordmark } from "@/components/ui/Seal";
import { SignOutButton } from "@/components/dashboard/SignOutButton";
import { SessionGuard } from "@/components/dashboard/SessionGuard";
import { StructureWorkspace } from "@/components/structure/StructureWorkspace";
import { ReviewQueue } from "@/components/structure/ReviewQueue";
import { currentAccount, readSessionToken } from "@/lib/auth/session";
import { fetchUnitChartResult } from "@/lib/chart";
import { fetchStructureForSession } from "@/lib/structure-server";

export const dynamic = "force-dynamic";

function Shell({ title, children }: { title: string; children: ReactNode }) {
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
            {title}
          </p>
          <div className="ml-auto flex items-center gap-2.5">
            <Link
              href="/dashboard"
              className="hidden rounded-full border border-line px-3.5 py-1.5 text-[0.8125rem] font-medium text-ink-soft transition-colors hover:border-line-strong hover:text-ink sm:inline-flex"
            >
              Dashboard
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

export default async function UsgStructurePage() {
  const account = await currentAccount();
  if (!account) redirect("/login");
  if (account.accountScope !== "owner") redirect("/lsg");

  const token = await readSessionToken();
  if (!token) redirect("/login");

  const chart = await fetchUnitChartResult(token);

  // USG's own structure: the root unit (the USG itself).
  let ownUnit: { id: string; name: string } | null = null;
  if (chart?.ok) {
    const root = chart.root;
    if (root) ownUnit = { id: root.id, name: root.name };
  }

  let structure: Awaited<ReturnType<typeof fetchStructureForSession>> = null;
  if (ownUnit) {
    structure = await fetchStructureForSession(token, ownUnit.id);
  }

  return (
    <SessionGuard>
      <Shell title="Structures">
        <Reveal className="flex flex-col items-center text-center">
          <p className="eyebrow">Structures</p>
          <h1 className="mt-2 text-[1.875rem] leading-tight sm:text-[2.25rem]">
            Your government structure
          </h1>
          <p className="mt-3 max-w-2xl text-[0.9375rem] leading-relaxed text-body">
            Build your own structure — add officers, positions, and committees — and review the
            structures your units have submitted below.
          </p>
        </Reveal>

        {ownUnit && structure?.ok && structure.capability?.canRead ? (
          <div className="mt-10">
            <StructureWorkspace
              unitId={ownUnit.id}
              unitName={ownUnit.name}
              capability={structure.capability}
            />
          </div>
        ) : (
          <div className="mt-10">
            <Empty
              title="We could not load your structure"
              body="The account database did not answer with your council. Sign in again in a moment."
            />
          </div>
        )}

        <div className="mt-16">
          <Reveal className="flex flex-col items-center text-center">
            <p className="eyebrow">Review queue</p>
            <h1 className="mt-2 text-[1.875rem] leading-tight sm:text-[2.25rem]">
              Council structures
            </h1>
            <p className="mt-3 max-w-2xl text-[0.9375rem] leading-relaxed text-body">
              Every council in your organization, in one queue. Approve a structure and it is
              published; send it back and the author keeps working on it.
            </p>
          </Reveal>
          <div className="mt-10">
            <ReviewQueue />
          </div>
        </div>
      </Shell>
    </SessionGuard>
  );
}