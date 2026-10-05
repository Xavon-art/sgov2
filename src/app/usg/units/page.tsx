"use client";

import { useAccount } from "@/components/dashboard/dashboard-context";
import { UnitsPanel } from "@/components/dashboard/UnitsPanel";
import { NotAvailable } from "@/components/dashboard/NotAvailable";

export default function DashboardUnitsPage() {
  const account = useAccount();

  // The nav already hides this route from anyone who cannot use it, but a URL is
  // a URL. The centralized office has no campus layer -- `add_unit` refuses to
  // extend one -- so offering the form here would offer something that cannot be
  // submitted.
  if (account.accountScope !== "owner" || account.accountKind !== "usg") {
    return <NotAvailable />;
  }

  return (
    <section id="units" className="scroll-mt-24">
      <div className="mb-5 flex items-end justify-between gap-4 border-b border-line/80 pb-4">
        <div>
          <p className="eyebrow">Structure</p>
          <h2 className="mt-1 text-[1.375rem] leading-tight sm:text-[1.625rem]">Your campuses</h2>
        </div>
        <p className="hidden text-[0.8125rem] text-muted sm:block">Units under you</p>
      </div>

      <UnitsPanel />
    </section>
  );
}