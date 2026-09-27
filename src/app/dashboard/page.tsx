"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import ShaderField from "@/components/fx/ShaderField";
import { Reveal } from "@/components/fx/Reveal";
import { Wordmark, Seal } from "@/components/ui/Seal";
import { ButtonLink } from "@/components/ui/Button";
import { OrgDiagram } from "@/components/ui/OrgDiagram";
import {
  IconArchive,
  IconArrowRight,
  IconBudget,
  IconCheck,
  IconEvents,
  IconMonitoring,
  IconPyramid,
  IconSubmission,
} from "@/components/ui/Icons";
import { ROLE_LABELS, useOrgDraft, type MemberRole } from "@/lib/store";
import { useDraftHydrated } from "@/lib/useDraftHydrated";

const COMING = [
  { icon: IconSubmission, label: "Requirements & Resolutions" },
  { icon: IconArchive, label: "Document Storage" },
  { icon: IconBudget, label: "Budget Tracking" },
  { icon: IconMonitoring, label: "Monitoring & Reports" },
  { icon: IconEvents, label: "Events" },
];

export default function DashboardPage() {
  const router = useRouter();
  const hydrated = useDraftHydrated();
  const draft = useOrgDraft();

  useEffect(() => {
    if (hydrated && !draft.organization.name) router.replace("/");
  }, [hydrated, draft.organization.name, router]);

  const federated = draft.model === "federated";
  const hasOrg = Boolean(draft.organization.name);

  const rows: Array<[string, string]> = [
    ["Structure", federated ? "Federated / Decentralized" : "Unitary / Centralized"],
    ["Institution", draft.institution.universityName],
    ["Campus", federated ? draft.institution.campusName : "—"],
    ["College", federated ? draft.institution.college : "—"],
    ["Academic year", draft.organization.academicYear],
    ["Administrator", draft.account.fullName],
    ["Role", ROLE_LABELS[draft.account.role as MemberRole] ?? "—"],
    ["Email", draft.account.email],
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
            {draft.organization.name || "Workspace"}
          </p>
          <div className="ml-auto flex items-center gap-2.5">
            <span className="rounded-full border border-brass/45 bg-brass-soft/35 px-3 py-1 text-[0.625rem] font-semibold tracking-[0.12em] text-ink uppercase">
              Prototype
            </span>
            <ButtonLink href="/" size="sm" variant="ghost">
              Exit
            </ButtonLink>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[82rem] flex-1 px-5 py-14 sm:px-8 sm:py-16">
        {hydrated && hasOrg ? (
          <>
            <Reveal className="flex flex-col items-center text-center">
              <Seal size={54} accent={draft.organization.accent} />
              <h1 className="mt-6 text-[2rem] leading-tight sm:text-[2.5rem]">
                {draft.organization.name}
              </h1>
              <p className="mt-3 max-w-lg text-[0.9375rem] leading-relaxed text-body">
                {draft.organization.description ||
                  "Your chartered student organization workspace."}
              </p>
              <p className="mt-4 font-mono text-[0.75rem] tracking-[0.14em] text-brass-deep">
                {draft.charter ?? "—"}
              </p>
            </Reveal>

            <Reveal
              delay={0.08}
              className="mt-12 rounded-2xl border border-brass/40 bg-brass-soft/20 px-5 py-4"
            >
              <p className="flex items-center justify-center gap-2 text-[0.8125rem] font-medium text-ink">
                <IconCheck className="h-4 w-4 shrink-0 text-brass-deep" strokeWidth={2.2} />
                This is a dashboard placeholder. Setup is complete — the product
                surface is the next build phase.
              </p>
            </Reveal>

            <div className="mt-10 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              <Reveal variant="scale" className="rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
                <p className="eyebrow">Organization</p>
                <dl className="mt-4 flex flex-col">
                  {rows.map(([label, value]) => (
                    <div
                      key={label}
                      className="flex items-baseline justify-between gap-6 border-b border-line/70 py-2.5 last:border-b-0"
                    >
                      <dt className="text-[0.75rem] font-medium tracking-[0.06em] text-muted uppercase">
                        {label}
                      </dt>
                      <dd className="truncate text-[0.875rem] text-ink-deep">
                        {value || "—"}
                      </dd>
                    </div>
                  ))}
                </dl>
              </Reveal>

              <Reveal delay={0.1} className="flex flex-col gap-6">
                <div className="rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
                  <p className="eyebrow flex items-center gap-2">
                    <IconPyramid className="h-3.5 w-3.5 text-brass" />
                    Org chart
                  </p>
                  <div className="mt-4">
                    <OrgDiagram
                      model={federated ? "federated" : "unitary"}
                      accent={draft.organization.accent}
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
                  <p className="eyebrow">Building next</p>
                  <ul className="mt-4 flex flex-col gap-2.5">
                    {COMING.map((item) => {
                      const Icon = item.icon;
                      return (
                        <li
                          key={item.label}
                          className="flex items-center gap-2.5 text-[0.875rem] text-body"
                        >
                          <Icon className="h-4 w-4 shrink-0 text-ink-muted" />
                          {item.label}
                        </li>
                      );
                    })}
                  </ul>
                  <ButtonLink
                    href="/create"
                    size="sm"
                    variant="outline"
                    className="mt-6 w-full"
                  >
                    Back to setup flow
                    <IconArrowRight className="h-3.5 w-3.5" />
                  </ButtonLink>
                </div>
              </Reveal>
            </div>
          </>
        ) : (
          <div className="min-h-[50vh]" aria-hidden />
        )}
      </main>
    </div>
  );
}
