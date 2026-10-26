"use client";

import Link from "next/link";
import { useAccount } from "@/components/dashboard/dashboard-context";
import { NotAvailable } from "@/components/dashboard/NotAvailable";
import { useCallback, useEffect, useState } from "react";

export default function UsgManagePage() {
  const account = useAccount();

  const [unitsKind, setUnitsKind] = useState<"loading" | "ready">("loading");
  const [invitesKind, setInvitesKind] = useState<"loading" | "ready">("loading");
  const [accessKind, setAccessKind] = useState<"loading" | "ready">("loading");
  const [structureKind, setStructureKind] = useState<"loading" | "ready">("loading");

  const loadUnits = useCallback(async () => {
    try {
      const res = await fetch("/api/units");
      const data = await res.json();
      if (res.ok && data.ok) setUnitsKind("ready");
    } catch {}
  }, []);

  const loadInvites = useCallback(async () => {
    try {
      const res = await fetch("/api/invites");
      const data = await res.json();
      if (res.ok && data.ok) setInvitesKind("ready");
    } catch {}
  }, []);

  const loadAccess = useCallback(async () => {
    try {
      const res = await fetch("/api/permissions");
      const data = await res.json();
      if (res.ok && data.ok) setAccessKind("ready");
    } catch {}
  }, []);

  const loadStructure = useCallback(async () => {
    try {
      const res = await fetch("/api/structure");
      const data = await res.json();
      if (res.ok && data.ok) setStructureKind("ready");
    } catch {}
  }, []);

  useEffect(() => {
    // Each kind flips after its fetch resolves, not during render; the rule
    // cannot see through the await when the loader is handed to the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadUnits();
  }, [loadUnits]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadInvites();
  }, [loadInvites]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAccess();
  }, [loadAccess]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStructure();
  }, [loadStructure]);

  if (
    unitsKind !== "ready"
    || invitesKind !== "ready"
    || accessKind !== "ready"
    || structureKind !== "ready"
  ) {
    return <div>Loading manage section…</div>;
  }

  return (
    <section className="space-y-8">
      <div>
        <p className="eyebrow">Structure</p>
        <h2 className="mt-1 text-[1.375rem] leading-tight sm:text-[1.625rem]">Your campuses</h2>
        <p className="mt-3 text-[0.9375rem] text-muted">
          To add a campus or department, use the form at{" "}
          <Link href="/usg/units">/usg/units</Link>
        </p>
        <button
          className="inline-flex items-center rounded-lg border border-line px-4 text-[0.9375rem] hover:bg-ink-deep"
          onClick={() => window.location.href="/usg/units"}
        >
          Add campus or department
        </button>
      </div>

      <div>
        <p className="eyebrow">Officers & units</p>
        <h2 className="mt-1 text-[1.375rem] leading-tight sm:text-[1.625rem]">
          Build your umbrella
        </h2>
        <p className="mt-3 text-[0.9375rem] text-muted">
          Manage officer invitations at{" "}
          <Link href="/usg/invitations">/usg/invitations</Link>
        </p>
        <button
          className="inline-flex items-center rounded-lg border border-line px-4 text-[0.9375rem] hover:bg-ink-deep"
          onClick={() => window.location.href="/usg/invitations"}
        >
          Manage invitations
        </button>
      </div>

      <div>
        <p className="eyebrow">Officers</p>
        <h2 className="mt-1 text-[1.375rem] leading-tight sm:text-[1.625rem]">
          Deactivate or remove officers
        </h2>
        <p className="mt-3 text-[0.9375rem] text-muted">
          Suspend an officer and hand over their seat, or purge an account
          outright. Manage at{" "}
          <Link href="/usg/officers">/usg/officers</Link>
        </p>
        <button
          className="inline-flex items-center rounded-lg border border-line px-4 text-[0.9375rem] hover:bg-ink-deep"
          onClick={() => (window.location.href = "/usg/officers")}
        >
          Manage officers
        </button>
      </div>

      <div>
        <p className="eyebrow">Access</p>
        <h2 className="mt-1 text-[1.375rem] leading-tight sm:text-[1.625rem]">
          Who is allowed to invite
        </h2>
        <p className="mt-3 text-[0.9375rem] text-muted">
          Manage grants at{" "}
          <Link href="/usg/access">/usg/access</Link>
        </p>
        <button
          className="inline-flex items-center rounded-lg border border-line px-4 text-[0.9375rem] hover:bg-ink-deep"
          onClick={() => window.location.href="/usg/access"}
        >
          Manage grants
        </button>
      </div>

      <div>
        <p className="eyebrow">Surveys</p>
        <h2 className="mt-1 text-[1.375rem] leading-tight sm:text-[1.625rem]">
          Create and manage surveys
        </h2>
        <p className="mt-3 text-[0.9375rem] text-muted">
          Build Google-Forms-style surveys, share a public link, and view
          responses. Manage at{" "}
          <Link href="/usg/surveys">/usg/surveys</Link>
        </p>
        <button
          className="inline-flex items-center rounded-lg border border-line px-4 text-[0.9375rem] hover:bg-ink-deep"
          onClick={() => (window.location.href = "/usg/surveys")}
        >
          Manage surveys
        </button>
      </div>

      <div>
        <p className="eyebrow">Personal requests</p>
        <h2 className="mt-1 text-[1.375rem] leading-tight sm:text-[1.625rem]">
          Review requests from LSG officers
        </h2>
        <p className="mt-3 text-[0.9375rem] text-muted">
          Approve or reject personal requests submitted by LSG officers. Manage
          at <Link href="/usg/personal-requests">/usg/personal-requests</Link>
        </p>
        <button
          className="inline-flex items-center rounded-lg border border-line px-4 text-[0.9375rem] hover:bg-ink-deep"
          onClick={() => (window.location.href = "/usg/personal-requests")}
        >
          Review requests
        </button>
      </div>

      <div>
        <p className="eyebrow">Events & acts</p>
        <h2 className="mt-1 text-[1.375rem] leading-tight sm:text-[1.625rem]">
          Calendar and claims
        </h2>
        <p className="mt-3 text-[0.9375rem] text-muted">
          Manage events and review claims from LSG officers. Manage at{" "}
          <Link href="/usg/events">/usg/events</Link>
        </p>
        <button
          className="inline-flex items-center rounded-lg border border-line px-4 text-[0.9375rem] hover:bg-ink-deep"
          onClick={() => (window.location.href = "/usg/events")}
        >
          Manage events
        </button>
      </div>

      <div>
        <p className="eyebrow">Messages</p>
        <h2 className="mt-1 text-[1.375rem] leading-tight sm:text-[1.625rem]">
          Conversations with officers
        </h2>
        <p className="mt-3 text-[0.9375rem] text-muted">
          Start and manage conversations. Manage at{" "}
          <Link href="/usg/messages">/usg/messages</Link>
        </p>
        <button
          className="inline-flex items-center rounded-lg border border-line px-4 text-[0.9375rem] hover:bg-ink-deep"
          onClick={() => (window.location.href = "/usg/messages")}
        >
          Open inbox
        </button>
      </div>

      <div>
        <p className="eyebrow">Council structure</p>
        <h2 className="mt-1 text-[1.375rem] leading-tight sm:text-[1.625rem]">
          Council structures
        </h2>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-body">
          Every council in your organization.
        </p>
        {structureKind === "ready" && (
          <button
            className="inline-flex items-center rounded-lg border border-line px-4 text-[0.9375rem] hover:bg-ink-deep"
            onClick={() => window.location.href="/usg/structure"}
          >
            View council structures
          </button>
        )}
      </div>
    </section>
  );
}