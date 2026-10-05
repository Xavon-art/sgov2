"use client";

import { useAccount } from "@/components/dashboard/dashboard-context";
import { InvitesPanel } from "@/components/dashboard/InvitesPanel";
import { NotAvailable } from "@/components/dashboard/NotAvailable";

export default function DashboardInvitationsPage() {
  const account = useAccount();

  if (account.accountScope !== "owner") {
    return <NotAvailable />;
  }

  return (
    <section id="invitations" className="scroll-mt-24">
      <div className="mb-5 flex items-end justify-between gap-4 border-b border-line/80 pb-4">
        <div>
          <p className="eyebrow">Officers & units</p>
          <h2 className="mt-1 text-[1.375rem] leading-tight sm:text-[1.625rem]">
            Build your umbrella
          </h2>
        </div>
        <p className="hidden text-[0.8125rem] text-muted sm:block">
          {account.accountKind === "central" ? "Units on record" : "Officers invited"}
        </p>
      </div>

      <InvitesPanel />
    </section>
  );
}