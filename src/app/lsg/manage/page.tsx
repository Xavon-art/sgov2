"use client";

import Link from "next/link";
import { useState } from "react";
import { useAccount } from "@/components/dashboard/dashboard-context";
import { ProfileSection } from "@/components/dashboard/ProfileSection";
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

type Tab = "profile" | "structure";

export default function LsgManagePage() {
  const account = useAccount();
  const [tab, setTab] = useState<Tab>("profile");

  const unitName = account.campusName || account.universityName || "your unit";

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="eyebrow">Manage</p>
        <h1 className="text-[1.5rem] leading-tight sm:text-[1.75rem]">{unitName}</h1>
        <p className="max-w-2xl text-[0.9375rem] leading-relaxed text-body">
          Your own account, and the government structure of your council.
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Manage sections"
        className="flex flex-wrap gap-1 border-b border-line/80"
      >
        {([
          { id: "profile" as const, label: "Profile" },
          { id: "structure" as const, label: "Government structure" },
        ]).map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "pressable -mb-px rounded-t-lg border-b-2 px-4 py-2.5 text-[0.875rem] font-medium transition-colors",
              tab === t.id ? "border-brass text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "profile" ? <ProfileSection allowCustomisation={false} /> : null}

      {tab === "structure" ? (
        <div className="rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
          <p className="eyebrow">Government structure</p>
          <h2 className="mt-1 text-[1.25rem] leading-tight">Your officers and committees</h2>
          <p className="mt-2 text-[0.875rem] leading-relaxed text-body">
            Build and maintain your council&rsquo;s chart — the officers, positions, and committees
            your unit is accountable for. The USG sees it under their umbrella.
          </p>
          <div className="mt-4">
            <Link
              href="/my-council/structure"
              className="pressable inline-flex items-center gap-1.5 rounded-full border border-line-strong px-4 py-2 text-[0.875rem] font-medium text-ink hover:border-ink/40 hover:bg-ink/[0.035]"
            >
              Open the structure builder
            </Link>
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
