"use client";

import { useAccount } from "@/components/dashboard/dashboard-context";
import { RequirementWorkspace } from "@/components/dashboard/requirement/RequirementWorkspace";

/**
 * LSG Activities and Events page.
 *
 * Houses the officer's proposal/activity tracking under the new "Activities and
 * Events" section. Uses `LsgShell` for invited officers so the officer view
 * renders correctly. The heading differs from the USG side because the LSG
 * phrasing focuses on the unit's own proposals and budgets.
 */
export default function LsgActivitiesAndEventsPage() {
  const account = useAccount();

  return (
    <section>
      <div className="mb-5 flex items-end justify-between gap-4 border-b border-line/80 pb-4">
        <div>
          <p className="eyebrow">Your unit</p>
          <h1 className="mt-1 text-[1.375rem] leading-tight sm:text-[1.625rem]">
            Your proposals and budgets
          </h1>
        </div>
        <p className="hidden text-[0.8125rem] text-muted sm:block">Status and remarks</p>
      </div>

      <RequirementWorkspace account={account} />
    </section>
  );
}