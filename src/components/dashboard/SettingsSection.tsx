"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Reveal } from "@/components/fx/Reveal";
import { SignOutButton } from "@/components/dashboard/SignOutButton";
import { useDashboard } from "@/components/dashboard/dashboard-context";

/**
 * Settings -- the account's own controls, shared by both workspaces.
 *
 * The content is deliberately thin, and that is the design: everything the
 * federated system actually does is a section of its own (Manage, Request,
 * Events, Survey). Settings holds only what is about the account rather than
 * about the work -- who you are, how the dashboard looks, where the structure
 * editor lives, and the way out.
 *
 * The appearance block is not duplicated here; it links to Manage, which owns
 * profile and customisation. Two screens editing one row is how they drift.
 */
export function SettingsSection({ side }: { side: "usg" | "lsg" }) {
  const { account, meta } = useDashboard();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const manageHref = side === "usg" ? "/usg/manage" : "/lsg/manage";

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="eyebrow">Settings</p>
        <h1 className="text-[1.5rem] leading-tight sm:text-[1.75rem]">Your account</h1>
        <p className="max-w-2xl text-[0.9375rem] leading-relaxed text-body">
          Who you are on SmartGov, how the dashboard behaves, and the way out.
        </p>
      </header>

      <Reveal>
        <div className="rounded-2xl border border-line bg-paper/70 p-6">
          <p className="eyebrow">Workspace</p>
          <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <div>
              <dt className="text-[0.75rem] tracking-[0.08em] text-muted uppercase">Workspace</dt>
              <dd className="mt-0.5 text-[0.9375rem] text-ink">
                {side === "usg" ? "University student government" : "Local student government"}
              </dd>
            </div>
            <div>
              <dt className="text-[0.75rem] tracking-[0.08em] text-muted uppercase">Organisation</dt>
              <dd className="mt-0.5 text-[0.9375rem] text-ink">
                {meta.organizationName || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[0.75rem] tracking-[0.08em] text-muted uppercase">Government model</dt>
              <dd className="mt-0.5 text-[0.9375rem] text-ink">
                {meta.governanceModel === "federated" ? "Federated (USG over LSGs)" : "Centralised"}
              </dd>
            </div>
            <div>
              <dt className="text-[0.75rem] tracking-[0.08em] text-muted uppercase">Your unit</dt>
              <dd className="mt-0.5 text-[0.9375rem] text-ink">{account.campusName || "—"}</dd>
            </div>
          </dl>
        </div>
      </Reveal>

      <Reveal delay={0.04}>
        <div className="flex flex-col gap-3 rounded-2xl border border-line bg-paper/70 p-6">
          <p className="eyebrow">Profile & appearance</p>
          <p className="text-[0.9375rem] leading-relaxed text-body">
            Your name, sign-in email, password, and the dashboard&rsquo;s accent and theme live in
            Manage, next to the structure they belong to.
          </p>
          <div>
            <Link
              href={manageHref}
              className="pressable inline-flex items-center gap-1.5 rounded-full border border-line-strong px-4 py-2 text-[0.875rem] font-medium text-ink hover:border-ink/40 hover:bg-ink/[0.035]"
            >
              Open Manage
            </Link>
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.08}>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-paper/70 p-6">
          <div>
            <p className="eyebrow">Session</p>
            <p className="mt-1 text-[0.9375rem] text-body">
              Signed in as {account.displayName}.
            </p>
          </div>
          {mounted ? <SignOutButton /> : null}
        </div>
      </Reveal>
    </section>
  );
}
