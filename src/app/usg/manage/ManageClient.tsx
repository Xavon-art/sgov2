"use client";

import Link from "next/link";
import { useDashboard } from "@/components/dashboard/dashboard-context";
import { UmbrellaSection } from "@/components/dashboard/UmbrellaSection";
import { InvitesPanel } from "@/components/dashboard/InvitesPanel";
import { ProfileSection } from "@/components/dashboard/ProfileSection";
import { StructureEditorPanel } from "@/components/dashboard/StructureEditorPanel";
import { DocumentLibraryPanel } from "@/components/dashboard/DocumentLibraryPanel";
import { DocumentSearchPanel } from "@/components/dashboard/DocumentSearchPanel";
import { BudgetPanel } from "@/components/dashboard/BudgetPanel";
import { MonitoringPanel } from "@/components/dashboard/MonitoringPanel";
import { FeedbackWorkspace } from "@/components/dashboard/FeedbackWorkspace";
import { AccountsPanel } from "@/components/dashboard/AccountsPanel";
import { SectionIcon } from "@/components/dashboard/workspace-shared";
import { IconLayers } from "@/components/ui/Icons";

type Tab = "umbrella" | "invites" | "structure" | "profile" | "documents" | "search" | "budget" | "monitoring" | "feedback" | "accounts";

type TabAccess = "owner" | "reviewer" | "self";

const TAB_ACCESS: Record<Tab, TabAccess> = {
  umbrella: "owner",
  invites: "owner",
  structure: "owner",
  profile: "self",
  documents: "reviewer",
  search: "reviewer",
  budget: "reviewer",
  monitoring: "reviewer",
  feedback: "reviewer",
  accounts: "owner",
};

function isTab(value: string | undefined): value is Tab {
  return value === "umbrella" || value === "invites" || value === "structure" || value === "profile" || value === "documents" || value === "search" || value === "budget" || value === "monitoring" || value === "feedback" || value === "accounts";
}

function allowsTab(tab: Tab, canManage: boolean, canReviewDocuments: boolean): boolean {
  const access = TAB_ACCESS[tab];
  return access === "self" || (access === "owner" ? canManage : canReviewDocuments);
}

export function ManageClient({ requestedTab }: { requestedTab?: string }) {
  const { account, role } = useDashboard();
  const canManage = account.accountScope === "owner";
  const canReviewDocuments = role.side === "usg";
  const centralized = role.isCentral || role.governanceModel === "unitary";

  // The sidebar owns navigation. The query param only picks which panel renders,
  // with a default matching the first child link shown for this role.
  const defaultTab: Tab = canManage ? (centralized ? "structure" : "umbrella") : "profile";
  const tab: Tab =
    requestedTab && isTab(requestedTab) && allowsTab(requestedTab, canManage, canReviewDocuments)
      ? requestedTab
      : defaultTab;

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

      {tab === "documents" && canReviewDocuments ? <DocumentLibraryPanel /> : null}
      {tab === "search" && canReviewDocuments ? <DocumentSearchPanel /> : null}
      {tab === "budget" && canReviewDocuments ? <BudgetPanel /> : null}
      {tab === "monitoring" && canReviewDocuments ? <MonitoringPanel /> : null}
      {tab === "feedback" && canReviewDocuments ? <FeedbackWorkspace side="usg" /> : null}
      {tab === "accounts" && canManage ? <AccountsPanel /> : null}

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
            <StructureEditorPanel showQueue />
          </div>
        </div>
      ) : null}

      {canManage ? (
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
      ) : null}
    </section>
  );
}
