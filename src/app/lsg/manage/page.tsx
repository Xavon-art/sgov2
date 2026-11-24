"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useDashboard } from "@/components/dashboard/dashboard-context";
import { MyUsgPanel } from "@/components/dashboard/MyUsgPanel";
import { ProfileSection } from "@/components/dashboard/ProfileSection";
import { StructureEditorPanel } from "@/components/dashboard/StructureEditorPanel";
import { DocumentLibraryPanel } from "@/components/dashboard/DocumentLibraryPanel";
import { DocumentSearchPanel } from "@/components/dashboard/DocumentSearchPanel";
import { BudgetPanel } from "@/components/dashboard/BudgetPanel";
import { FeedbackWorkspace } from "@/components/dashboard/FeedbackWorkspace";
import { SectionIcon } from "@/components/dashboard/workspace-shared";
import { IconLayers } from "@/components/ui/Icons";

/**
 * Manage, from the LSG side.
 *
 * Two floors, not three: the umbrella and the invitations that grow it are the
 * USG's job, not a unit's. What a unit does own is its own profile and the
 * government structure of its council -- the officers and committees it is
 * accountable for -- so those are the two tabs here.
 *
 * The structure builder is `/my-council/structure`, which resolves the caller's
 * own council from the database rather than taking a unit id from the URL, so
 * there is no id to name here.
 */

type Tab = "unit" | "profile" | "structure" | "documents" | "search" | "budget" | "feedback";

function isTab(value: string | null): value is Tab {
  return (
    value === "unit" ||
    value === "profile" ||
    value === "structure" ||
    value === "documents" ||
    value === "search" ||
    value === "budget" ||
    value === "feedback"
  );
}

export default function LsgManagePage() {
  const { account, role } = useDashboard();
  const router = useRouter();
  const searchParams = useSearchParams();

  // The sidebar owns navigation. The query param only picks which panel renders.
  const centralized = role.isCentral || role.governanceModel === "unitary";
  const requested = searchParams.get("tab");
  const tab: Tab = isTab(requested) ? requested : centralized ? "structure" : "unit";

  // Old links used the USG-facing tab name; rewrite them so the LSG URL stays clean.
  useEffect(() => {
    if (requested === "usg") router.replace("/lsg/manage?tab=unit", { scroll: false });
  }, [requested, router]);

  const unitName = account.campusName || account.universityName || "your unit";

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <SectionIcon>
            <IconLayers className="h-5 w-5" strokeWidth={1.7} />
          </SectionIcon>
          <div className="flex flex-col gap-1">
            <p className="eyebrow">Manage</p>
            <h1 className="text-[1.5rem] leading-tight sm:text-[1.75rem]">{unitName}</h1>
          </div>
        </div>
        <p className="max-w-2xl text-[0.9375rem] leading-relaxed text-body">
          Your own account, and the government structure of your council.
        </p>
      </header>

      {tab === "unit" ? (
        <div data-tour="manage-unit">
          <MyUsgPanel />
        </div>
      ) : null}

      {tab === "profile" ? <ProfileSection allowCustomisation={false} /> : null}

      {tab === "documents" ? <DocumentLibraryPanel /> : null}
      {tab === "search" ? <DocumentSearchPanel /> : null}
      {tab === "budget" ? <BudgetPanel /> : null}
      {tab === "feedback" ? <FeedbackWorkspace side="lsg" /> : null}

      {tab === "structure" ? (
        <div className="rounded-2xl border border-line bg-paper/70 p-4 sm:p-5">
          <p className="eyebrow">Government structure</p>
          <h2 className="mt-1 text-[1.25rem] leading-tight">Your unit&rsquo;s officers and committees</h2>
          <p className="mt-2 text-[0.875rem] leading-relaxed text-body">
            The USG keeps its own umbrella chart, and every campus, college, department, and other
            LSG beneath it keeps its own. Build and maintain this unit&rsquo;s officers, positions,
            and committees directly below; choose a matching sample format or start from scratch.
          </p>
          <div className="mt-4">
            <StructureEditorPanel />
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
        <p className="eyebrow">More</p>
        <h2 className="mt-1 text-[1.25rem] leading-tight">Other management tools</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/lsg/surveys" className="pressable inline-flex items-center gap-1.5 rounded-full border border-line-strong px-4 py-2 text-[0.875rem] font-medium text-ink hover:border-ink/40 hover:bg-ink/[0.035]">Surveys</Link>
          <Link href="/lsg/personal-requests" className="pressable inline-flex items-center gap-1.5 rounded-full border border-line-strong px-4 py-2 text-[0.875rem] font-medium text-ink hover:border-ink/40 hover:bg-ink/[0.035]">Personal requests</Link>
          <Link href="/lsg/events" className="pressable inline-flex items-center gap-1.5 rounded-full border border-line-strong px-4 py-2 text-[0.875rem] font-medium text-ink hover:border-ink/40 hover:bg-ink/[0.035]">Events</Link>
          <Link href="/lsg/messages" className="pressable inline-flex items-center gap-1.5 rounded-full border border-line-strong px-4 py-2 text-[0.875rem] font-medium text-ink hover:border-ink/40 hover:bg-ink/[0.035]">Messages</Link>
        </div>
      </div>
    </section>
  );
}
