"use client";

import { useAccount } from "@/components/dashboard/dashboard-context";
import { RequirementWorkspace } from "@/components/dashboard/requirement/RequirementWorkspace";

export default function DashboardRequirementsPage() {
  const account = useAccount();

  return (
    <section id="requirements" className="scroll-mt-24">
      <div className="mb-5 flex items-end justify-between gap-4 border-b border-line/80 pb-4">
        <div>
          <p className="eyebrow">Proposals &amp; requirements</p>
          <h2 className="mt-1 text-[1.375rem] leading-tight sm:text-[1.625rem]">
            {account.accountScope === "owner" ? "Run the governance" : "Your unit's proposals"}
          </h2>
        </div>
        <p className="hidden text-[0.8125rem] text-muted sm:block">
          {account.accountScope === "owner" ? "Awaiting your decision" : "Status and remarks"}
        </p>
      </div>

      <RequirementWorkspace account={account} />
    </section>
  );
}
