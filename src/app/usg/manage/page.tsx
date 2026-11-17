"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccount } from "@/components/dashboard/dashboard-context";
import { UmbrellaSection } from "@/components/dashboard/UmbrellaSection";
import { InvitesPanel } from "@/components/dashboard/InvitesPanel";
import { ProfileSection } from "@/components/dashboard/ProfileSection";
import { StructureEditorPanel } from "@/components/dashboard/StructureEditorPanel";
import { SectionIcon } from "@/components/dashboard/workspace-shared";
import { IconBuilding, IconLayers, IconMail, IconUser } from "@/components/ui/Icons";
import { cn } from "@/lib/utils";

/**
 * Manage -- the USG's administrative roof.
 *
 * Three jobs that an owner thinks of as one: the umbrella they are responsible
 * for, the invitations that grow it, and their own profile and look. They sit
 * under a single nav entry with tabs rather than three top-level sections, so the
 * board's nav stays six items instead of eight.
 *
 * The umbrella is owner-only and the database refuses it for anyone else, so an
 * invited officer sees only the two floors they can actually use.
 */

type Tab = "umbrella" | "invites" | "structure" | "profile";

function isTab(value: string | null): value is Tab {
  return value === "umbrella" || value === "invites" || value === "structure" || value === "profile";
}

const TABS: Array<{ id: Tab; label: string; ownerOnly: boolean; icon: typeof IconBuilding }> = [
  { id: "umbrella", label: "Umbrella", ownerOnly: true, icon: IconBuilding },
  { id: "invites", label: "Invites", ownerOnly: true, icon: IconMail },
  { id: "structure", label: "Government structure", ownerOnly: true, icon: IconLayers },
  { id: "profile", label: "Profile & customization", ownerOnly: false, icon: IconUser },
];

export default function UsgManagePage() {
  const account = useAccount();
  const router = useRouter();
  const searchParams = useSearchParams();
  const canManage = account.accountScope === "owner";

  // The URL is the source of truth. Reading `?tab=` once on mount meant a
  // sidebar link changed the address bar but not the panel, because Next
  // re-renders the page instead of remounting it. Deriving the tab from
  // `useSearchParams` makes every sub-nav link work on the first click.
  const requested = searchParams.get("tab");
  const tab: Tab = isTab(requested) ? requested : "umbrella";

  // A non-owner has exactly one floor: their own profile. The guard is written
  // as an early return rather than a filter so the owner-only tabs are never
  // reachable even from stale state -- but the fallback is the profile, which is
  // useful, rather than a blank screen.
  if (!canManage) {
    return (
      <section className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <SectionIcon>
              <IconUser className="h-5 w-5" strokeWidth={1.7} />
            </SectionIcon>
            <div className="flex flex-col gap-1">
              <p className="eyebrow">Manage</p>
              <h1 className="text-[1.5rem] leading-tight sm:text-[1.75rem]">Your profile</h1>
            </div>
          </div>
          <p className="max-w-2xl text-[0.9375rem] leading-relaxed text-body">
            Your own account and the officer details attached to it.
          </p>
        </header>
        <ProfileSection allowCustomisation={false} />
      </section>
    );
  }

  const visible = TABS.filter((t) => canManage || !t.ownerOnly);

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <SectionIcon>
            <IconLayers className="h-5 w-5" strokeWidth={1.7} />
          </SectionIcon>
          <div className="flex flex-col gap-1">
            <p className="eyebrow">Manage</p>
            <h1 className="text-[1.5rem] leading-tight sm:text-[1.75rem]">
              {canManage ? "Your federation" : "Your profile"}
            </h1>
          </div>
        </div>
        <p className="max-w-2xl text-[0.9375rem] leading-relaxed text-body">
          {canManage
            ? "The units under you, the people you invite into them, and how the dashboard looks."
            : "Your own account and the officer details attached to it."}
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Manage sections"
        className="flex flex-wrap gap-1 border-b border-line/80"
      >
        {visible.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => router.replace(`/usg/manage?tab=${t.id}`, { scroll: false })}
            className={cn(
              "pressable -mb-px inline-flex items-center gap-2 rounded-t-lg border-b-2 px-4 py-2.5 text-[0.875rem] font-medium transition-colors",
              tab === t.id
                ? "border-brass text-ink"
                : "border-transparent text-muted hover:text-ink",
            )}
          >
            <t.icon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "umbrella" && canManage ? <UmbrellaSection /> : null}
      {tab === "invites" && canManage ? (
        <div id="invitations" className="scroll-mt-24">
          <p className="mb-5 text-[0.9375rem] leading-relaxed text-body">
            Invite a campus, department, or college by email. They receive a code, set a password,
            and appear under your umbrella.
          </p>
          <InvitesPanel />
        </div>
      ) : null}
      {tab === "profile" ? <ProfileSection allowCustomisation={canManage} /> : null}

      {tab === "structure" && canManage ? (
        <div className="rounded-2xl border border-line bg-paper/70 p-4 sm:p-5">
          <p className="eyebrow">Government structure</p>
          <h2 className="mt-1 text-[1.25rem] leading-tight">Your officers and committees</h2>
          <p className="mt-2 text-[0.875rem] leading-relaxed text-body">
            Build and maintain your own structure — add officers, positions, and
            committees — directly below. Review the structures your units have
            submitted via the queue.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/usg/structure"
              className="pressable inline-flex items-center gap-1.5 rounded-full border border-line-strong px-4 py-2 text-[0.875rem] font-medium text-ink hover:border-ink/40 hover:bg-ink/[0.035]"
            >
              Open the structure queue
            </Link>
          </div>
          <div className="mt-4">
            <StructureEditorPanel variant="chart" showQueue />
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
        <p className="eyebrow">More</p>
        <h2 className="mt-1 text-[1.25rem] leading-tight">Other management tools</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/usg/officers" className="pressable inline-flex items-center gap-1.5 rounded-full border border-line-strong px-4 py-2 text-[0.875rem] font-medium text-ink hover:border-ink/40 hover:bg-ink/[0.035]">Officers</Link>
          <Link href="/usg/surveys" className="pressable inline-flex items-center gap-1.5 rounded-full border border-line-strong px-4 py-2 text-[0.875rem] font-medium text-ink hover:border-ink/40 hover:bg-ink/[0.035]">Surveys</Link>
          <Link href="/usg/personal-requests" className="pressable inline-flex items-center gap-1.5 rounded-full border border-line-strong px-4 py-2 text-[0.875rem] font-medium text-ink hover:border-ink/40 hover:bg-ink/[0.035]">Personal requests</Link>
          <Link href="/usg/events" className="pressable inline-flex items-center gap-1.5 rounded-full border border-line-strong px-4 py-2 text-[0.875rem] font-medium text-ink hover:border-ink/40 hover:bg-ink/[0.035]">Events</Link>
          <Link href="/usg/messages" className="pressable inline-flex items-center gap-1.5 rounded-full border border-line-strong px-4 py-2 text-[0.875rem] font-medium text-ink hover:border-ink/40 hover:bg-ink/[0.035]">Messages</Link>
        </div>
      </div>
    </section>
  );
}
