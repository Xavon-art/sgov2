"use client";

import { useAccount } from "@/components/dashboard/dashboard-context";
import { RequirementWorkspace } from "@/components/dashboard/requirement/RequirementWorkspace";

/**
 * The LSG proposals desk.
 *
 * `RequirementWorkspace` picks `LsgShell` for an invited officer, so this route
 * renders the officer view. Reaching it is already guaranteed by the `/lsg`
 * layout guard -- an account with the USG side is redirected to `/usg` before
 * this renders.
 *
 * The heading is written here rather than inside the workspace because the two
 * workspaces phrase the same data differently, and that is a copy decision, not a
 * layout one.
 */
export default function LsgProposalsPage() {
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