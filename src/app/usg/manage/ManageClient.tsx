"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useDashboard } from "@/components/dashboard/dashboard-context";
import { ProfileSection } from "@/components/dashboard/ProfileSection";
import { StructureEditorPanel } from "@/components/dashboard/StructureEditorPanel";
import { DocumentLibraryPanel } from "@/components/dashboard/DocumentLibraryPanel";
import { UsgBudgetPanel } from "@/components/dashboard/UsgBudgetPanel";
import { FeedbackWorkspace } from "@/components/dashboard/FeedbackWorkspace";
import { PeoplePanel } from "@/components/dashboard/PeoplePanel";
import { SectionIcon } from "@/components/dashboard/workspace-shared";
import { IconLayers } from "@/components/ui/Icons";

type Tab = "umbrella" | "invites" | "people" | "structure" | "profile" | "documents" | "search" | "budget" | "monitoring" | "feedback" | "accounts";

type TabAccess = "owner" | "reviewer" | "self";

const TAB_ACCESS: Record<Tab, TabAccess> = {
  umbrella: "owner",
  invites: "owner",
  people: "owner",
  structure: "reviewer",
  profile: "self",
  documents: "reviewer",
  search: "reviewer",
  budget: "reviewer",
  monitoring: "reviewer",
  feedback: "reviewer",
  accounts: "owner",
};

function isTab(value: string | undefined): value is Tab {
  return value === "umbrella" || value === "invites" || value === "people" || value === "structure" || value === "profile" || value === "documents" || value === "search" || value === "budget" || value === "monitoring" || value === "feedback" || value === "accounts";
}

function allowsTab(tab: Tab, canManage: boolean, canReviewDocuments: boolean): boolean {
  const access = TAB_ACCESS[tab];
  return access === "self" || (access === "owner" ? canManage : canReviewDocuments);
}

export function ManageClient({
  requestedTab,
  initialQuery = "",
  initialView = "",
}: {
  requestedTab?: string;
  initialQuery?: string;
  initialView?: string;
}) {
  const { account, role } = useDashboard();
  const router = useRouter();
  const searchParams = useSearchParams();
  const canManage = account.accountScope === "owner";
  const canReviewDocuments = role.side === "usg";
  const centralized = role.isCentral || role.governanceModel === "unitary";

  // The sidebar owns navigation. The query param only picks which panel renders,
  // with a default matching the first child link shown for this role.
  const defaultTab: Tab = canManage ? (centralized ? "structure" : "people") : "profile";
  const legacyView = canManage && !centralized
    ? requestedTab === "umbrella"
      ? "units"
      : requestedTab === "invites"
        ? "invites"
        : requestedTab === "accounts"
          ? "permissions"
          : requestedTab === "officers"
            ? "officers"
            : null
    : null;
  const selectedTab: Tab = legacyView
    ? "people"
    : requestedTab &&
        isTab(requestedTab) &&
        allowsTab(requestedTab, canManage, canReviewDocuments) &&
        !(centralized && requestedTab === "people")
      ? requestedTab
      : defaultTab;
  const tab: Tab = selectedTab === "search" ? "documents" : selectedTab;
  const view = legacyView ?? initialView;

  useEffect(() => {
    if (legacyView) {
      router.replace(`/usg/manage?tab=people&view=${legacyView}`, { scroll: false });
      return;
    }
    if (requestedTab === "monitoring") {
      router.replace("/usg", { scroll: false });
      return;
    }
    if (requestedTab !== "search") return;
    const query = searchParams.get("q");
    router.replace(
      query ? `/usg/manage?tab=documents&q=${encodeURIComponent(query)}` : "/usg/manage?tab=documents",
      { scroll: false },
    );
  }, [legacyView, requestedTab, router, searchParams]);

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
              {canManage
                ? "Your federation"
                : canReviewDocuments
                  ? "Documents and profile"
                  : "Your profile"}
            </h1>
          </div>
        </div>
        <p className="max-w-2xl text-[0.9375rem] leading-relaxed text-body">
          {canManage
            ? "The units under you, the people you invite into them, and how the dashboard looks."
            : canReviewDocuments
              ? "Review the organisation's document catalog, search what has been filed, and manage your own account."
              : "Your own account and the officer details attached to it."}
        </p>
      </header>

      {tab === "people" && canManage && !centralized ? <PeoplePanel view={view} /> : null}
      {tab === "profile" ? <ProfileSection allowCustomisation={canManage} /> : null}

      {tab === "documents" && canReviewDocuments ? <DocumentLibraryPanel initialQuery={initialQuery} /> : null}
      {tab === "budget" && canReviewDocuments ? <UsgBudgetPanel /> : null}
      {tab === "feedback" && canReviewDocuments ? <FeedbackWorkspace side="usg" /> : null}

      {tab === "structure" && (canManage || canReviewDocuments) ? (
        <div className="rounded-2xl border border-line bg-paper/70 p-4 sm:p-5">
          <p className="eyebrow">Government structure</p>
          <h2 className="mt-1 text-[1.25rem] leading-tight">Your officers and committees</h2>
          <p className="mt-2 text-[0.875rem] leading-relaxed text-body">
            Build and maintain your own structure — add officers, positions, and
            committees — directly below. Review the structures your units have
            submitted via the queue.
          </p>
          {canManage ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href="/structure/editor?returnTo=/usg/manage?tab=structure"
                className="pressable inline-flex items-center gap-1.5 rounded-full border border-line-strong px-4 py-2 text-[0.875rem] font-medium text-ink hover:border-ink/40 hover:bg-ink/[0.035]"
              >
                Open the structure queue
              </Link>
              {!centralized ? (
                <Link
                  href="/org-chart"
                  className="pressable inline-flex items-center gap-1.5 rounded-full border border-line-strong px-4 py-2 text-[0.875rem] font-medium text-ink hover:border-ink/40 hover:bg-ink/[0.035]"
                >
                  View published chart
                </Link>
              ) : null}
            </div>
          ) : null}
          <div className="mt-4">
            <StructureEditorPanel showQueue />
          </div>
        </div>
      ) : null}

      {canManage ? (
        <div className="rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
          <p className="eyebrow">More</p>
          <h2 className="mt-1 text-[1.25rem] leading-tight">Other management tools</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {!centralized ? (
              <Link href="/usg/manage?tab=people&view=officers" className="pressable inline-flex items-center gap-1.5 rounded-full border border-line-strong px-4 py-2 text-[0.875rem] font-medium text-ink hover:border-ink/40 hover:bg-ink/[0.035]">People &amp; Units</Link>
            ) : null}
            <Link href="/usg/forms" className="pressable inline-flex items-center gap-1.5 rounded-full border border-line-strong px-4 py-2 text-[0.875rem] font-medium text-ink hover:border-ink/40 hover:bg-ink/[0.035]">Forms</Link>
            <Link href="/usg/request?tab=personal" className="pressable inline-flex items-center gap-1.5 rounded-full border border-line-strong px-4 py-2 text-[0.875rem] font-medium text-ink hover:border-ink/40 hover:bg-ink/[0.035]">Personal requests</Link>
            <Link href="/usg/events" className="pressable inline-flex items-center gap-1.5 rounded-full border border-line-strong px-4 py-2 text-[0.875rem] font-medium text-ink hover:border-ink/40 hover:bg-ink/[0.035]">Events</Link>
            <Link href="/usg/messages" className="pressable inline-flex items-center gap-1.5 rounded-full border border-line-strong px-4 py-2 text-[0.875rem] font-medium text-ink hover:border-ink/40 hover:bg-ink/[0.035]">Inbox</Link>
          </div>
        </div>
      ) : null}
    </section>
  );
}
