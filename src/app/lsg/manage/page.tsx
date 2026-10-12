"use client";

import { useAccount } from "@/components/dashboard/dashboard-context";
import { NotAvailable } from "@/components/dashboard/NotAvailable";
import { useCallback, useEffect, useState } from "react";

/**
 * LSG Manage page - simplified state version.
 */
export default function LsgManagePage() {
  const account = useAccount();

  const [structureKind, setStructureKind] = useState<"loading" | "ready">("loading");

  const loadStructure = useCallback(async () => {
    try {
      const res = await fetch("/api/structure");
      const data = await res.json();
      if (res.ok && data.ok) setStructureKind("ready");
    } catch {}
  }, []);

  useEffect(() => {
    // The kind flips after the fetch resolves, not during render; the rule
    // cannot see through the await when the loader is handed to the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStructure();
  }, [loadStructure]);

  if (structureKind !== "ready") {
    return <div>Loading manage section…</div>;
  }

  // Simulated deactivated check - in real app this would come from API
  const deactivated = false;

  return (
    <section className="space-y-4">
      <p className="eyebrow">Council structure</p>
      <h2 className="mt-1 text-[1.375rem] leading-tight sm:text-[1.625rem]">
        Council structures
      </h2>
      <p className="mt-1 text-[0.9375rem] leading-relaxed text-body">
        Every council in your organization.
      </p>
      {deactivated ? (
        <div className="rounded-card border border-brass/50 bg-brass-soft/30 p-4">
          <p className="text-[0.9375rem] text-brass-deep font-medium">
            ⚠️ One or more accounts are deactivated. The dashboard is inaccessible
            until the account is reactivated or handed over.
          </p>
        </div>
      ) : (
        <div className="rounded-card border border-line bg-paper p-4">
          <p className="text-[0.9375rem] text-ink">
            All accounts are active. Structure is operational.
          </p>
        </div>
      )}

      <div className="mt-4">
        <button
          className="inline-flex items-center rounded-lg border border-line px-4 text-[0.9375rem] hover:bg-ink-deep"
          onClick={() => window.location.href="/my-council/structure"}
        >
          View council structures
        </button>
      </div>
    </section>
  );
}