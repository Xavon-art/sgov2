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

  return (
    <section className="space-y-4">
      <p className="eyebrow">Council structure</p>
      <h2 className="mt-1 text-[1.375rem] leading-tight sm:text-[1.625rem]">
        Council structures
      </h2>
      <p className="mt-1 text-[0.9375rem] leading-relaxed text-body">
        Every council in your organization.
      </p>
      <div className="rounded-card border border-line bg-paper p-4">
        <p className="text-[0.9375rem] text-ink">
          Structure is operational.
        </p>
      </div>

      <div className="mt-4">
        <button
          className="inline-flex items-center rounded-lg border border-line px-4 text-[0.9375rem] hover:bg-ink-deep"
          onClick={() => window.location.href="/my-council/structure"}
        >
          View council structures
        </button>
      </div>

      <div className="mt-6">
        <p className="eyebrow">Personal requests</p>
        <h2 className="mt-1 text-[1.375rem] leading-tight sm:text-[1.625rem]">
          Submit a request to the USG office
        </h2>
        <p className="mt-1 text-[0.9375rem] leading-relaxed text-body">
          Send a personal request with a cover letter and deadline.
        </p>
        <button
          className="mt-3 inline-flex items-center rounded-lg border border-line px-4 text-[0.9375rem] hover:bg-ink-deep"
          onClick={() => (window.location.href = "/lsg/personal-requests")}
        >
          Manage requests
        </button>
      </div>

      <div className="mt-6">
        <p className="eyebrow">Events & acts</p>
        <h2 className="mt-1 text-[1.375rem] leading-tight sm:text-[1.625rem]">
          Calendar and claims
        </h2>
        <p className="mt-1 text-[0.9375rem] leading-relaxed text-body">
          Record events and claim acts for USG review.
        </p>
        <button
          className="mt-3 inline-flex items-center rounded-lg border border-line px-4 text-[0.9375rem] hover:bg-ink-deep"
          onClick={() => (window.location.href = "/lsg/events")}
        >
          Manage events
        </button>
      </div>

      <div className="mt-6">
        <p className="eyebrow">Messages</p>
        <h2 className="mt-1 text-[1.375rem] leading-tight sm:text-[1.625rem]">
          Conversations with the USG office
        </h2>
        <p className="mt-1 text-[0.9375rem] leading-relaxed text-body">
          Start and manage conversations.
        </p>
        <button
          className="mt-3 inline-flex items-center rounded-lg border border-line px-4 text-[0.9375rem] hover:bg-ink-deep"
          onClick={() => (window.location.href = "/lsg/messages")}
        >
          Open inbox
        </button>
      </div>

      <div className="mt-6">
        <p className="eyebrow">Surveys</p>
        <h2 className="mt-1 text-[1.375rem] leading-tight sm:text-[1.625rem]">
          Create and manage surveys
        </h2>
        <p className="mt-1 text-[0.9375rem] leading-relaxed text-body">
          Build surveys, share a public link, and view responses.
        </p>
        <button
          className="mt-3 inline-flex items-center rounded-lg border border-line px-4 text-[0.9375rem] hover:bg-ink-deep"
          onClick={() => (window.location.href = "/lsg/surveys")}
        >
          Manage surveys
        </button>
      </div>
    </section>
  );
}