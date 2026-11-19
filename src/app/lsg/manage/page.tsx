"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccount } from "@/components/dashboard/dashboard-context";
import { MyUsgPanel } from "@/components/dashboard/MyUsgPanel";
import { ProfileSection } from "@/components/dashboard/ProfileSection";
import { StructureEditorPanel } from "@/components/dashboard/StructureEditorPanel";
import { DocumentLibraryPanel } from "@/components/dashboard/DocumentLibraryPanel";
import { DocumentSearchPanel } from "@/components/dashboard/DocumentSearchPanel";
import { BudgetPanel } from "@/components/dashboard/BudgetPanel";
import { FeedbackPanel } from "@/components/dashboard/FeedbackPanel";
import { SectionIcon } from "@/components/dashboard/workspace-shared";
import { IconArchive, IconBudget, IconBuilding, IconEye, IconLayers, IconMail, IconUser } from "@/components/ui/Icons";
import { cn } from "@/lib/utils";

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

type Tab = "usg" | "profile" | "structure" | "documents" | "search" | "budget" | "feedback";

function isTab(value: string | null): value is Tab {
  return (
    value === "usg" ||
    value === "profile" ||
    value === "structure" ||
    value === "documents" ||
    value === "search" ||
    value === "budget" ||
    value === "feedback"
  );
}

export default function LsgManagePage() {
  const account = useAccount();
  const router = useRouter();
  const searchParams = useSearchParams();

  // URL is the source of truth so a sidebar link switches the panel on the
  // first click, not only after a full reload.
  const requested = searchParams.get("tab");
  const tab: Tab = isTab(requested) ? requested : "usg";

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

      <div
        data-tour="manage-tabs"
        role="tablist"
        aria-label="Manage sections"
        className="flex flex-wrap gap-1 border-b border-line/80"
      >
        {([
          { id: "usg" as const, label: "My USG", icon: IconBuilding },
          { id: "profile" as const, label: "Profile", icon: IconUser },
          { id: "structure" as const, label: "Government structure", icon: IconLayers },
          { id: "documents" as const, label: "Documents", icon: IconArchive },
          { id: "search" as const, label: "Search", icon: IconEye },
          { id: "budget" as const, label: "Budget", icon: IconBudget },
          { id: "feedback" as const, label: "Feedback", icon: IconMail },
        ]).map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => router.replace(`/lsg/manage?tab=${t.id}`, { scroll: false })}
            className={cn(
              "pressable -mb-px inline-flex items-center gap-2 rounded-t-lg border-b-2 px-4 py-2.5 text-[0.875rem] font-medium transition-colors",
              tab === t.id ? "border-brass text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            <t.icon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "usg" ? (
        <div data-tour="manage-usg">
          <MyUsgPanel />
        </div>
      ) : null}

      {tab === "profile" ? <ProfileSection allowCustomisation={false} /> : null}

      {tab === "documents" ? <DocumentLibraryPanel /> : null}
      {tab === "search" ? <DocumentSearchPanel /> : null}
      {tab === "budget" ? <BudgetPanel /> : null}
      {tab === "feedback" ? <FeedbackPanel mode="submit" /> : null}

      {tab === "structure" ? (
        <div className="rounded-2xl border border-line bg-paper/70 p-4 sm:p-5">
          <p className="eyebrow">Government structure</p>
          <h2 className="mt-1 text-[1.25rem] leading-tight">Your officers and committees</h2>
          <p className="mt-2 text-[0.875rem] leading-relaxed text-body">
            Build and maintain your council&rsquo;s chart — the officers, positions, and committees
            your unit is accountable for — directly below.
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
