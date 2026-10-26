"use client";

import { useAccount } from "@/components/dashboard/dashboard-context";
import { NotAvailable } from "@/components/dashboard/NotAvailable";
import { OfficersPanel } from "@/components/dashboard/OfficersPanel";

export default function UsgOfficersPage() {
  const account = useAccount();

  if (account.accountScope !== "owner") {
    return <NotAvailable />;
  }

  return (
    <section className="mx-auto w-full max-w-5xl">
      <header className="border-b border-line/80 pb-4">
        <p className="eyebrow">Officers</p>
        <h1 className="mt-1 text-[1.5rem] leading-tight sm:text-[1.75rem]">
          Manage officers
        </h1>
        <p className="mt-1 max-w-prose text-[0.9375rem] leading-relaxed text-body">
          Suspend an officer and hand their seat to a successor, or remove an
          account outright. Suspending keeps their authored records; purging
          re-points those records at you.
        </p>
      </header>

      <div className="mt-6">
        <OfficersPanel />
      </div>
    </section>
  );
}