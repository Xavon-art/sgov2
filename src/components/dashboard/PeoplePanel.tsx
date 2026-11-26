"use client";

import Link from "next/link";
import { AccountsPanel } from "@/components/dashboard/AccountsPanel";
import { InvitesPanel } from "@/components/dashboard/InvitesPanel";
import { OfficersPanel } from "@/components/dashboard/OfficersPanel";
import { UmbrellaSection } from "@/components/dashboard/UmbrellaSection";
import { cn } from "@/lib/utils";

type View = "units" | "officers" | "invites" | "permissions";

const VIEWS: Array<{ id: View; label: string; hint: string }> = [
  { id: "units", label: "Units", hint: "Units under your umbrella and scheduled pauses" },
  { id: "officers", label: "Officers", hint: "Officer records, handover, deactivation, and purge" },
  { id: "invites", label: "Invites", hint: "Invite people and create new units" },
  { id: "permissions", label: "Feedback access", hint: "Cross-unit feedback targeting" },
];

function parseView(value: string | undefined): View {
  return value === "officers" || value === "invites" || value === "permissions"
    ? value
    : "units";
}

export function PeoplePanel({ view }: { view?: string }) {
  const active = parseView(view);

  return (
    <section className="grid gap-6" data-tour="manage-people">
      <div className="rounded-2xl border border-line bg-paper/70 p-4 sm:p-5">
        <p className="eyebrow">People and units</p>
        <h2 className="mt-1 text-[1.25rem] leading-tight">One place for the federation roster</h2>
        <p className="mt-2 text-[0.875rem] leading-relaxed text-body">
          Keep units, officers, invitations, and feedback access together. Each view uses the
          same permission-gated actions as before.
        </p>
        <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="People and units views">
          {VIEWS.map((item) => {
            const selected = item.id === active;
            return (
              <Link
                key={item.id}
                role="tab"
                aria-selected={selected}
                href={`/usg/manage?tab=people&view=${item.id}`}
                title={item.hint}
                className={cn(
                  "pressable inline-flex min-h-10 items-center rounded-full border px-4 py-2 text-[0.875rem] font-medium",
                  selected
                    ? "border-ink/40 bg-ink/[0.06] text-ink"
                    : "border-line-strong text-body hover:border-ink/40 hover:bg-ink/[0.035]",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>

      {active === "units" ? <UmbrellaSection /> : null}
      {active === "officers" ? <OfficersPanel /> : null}
      {active === "invites" ? (
        <div id="invitations" className="scroll-mt-24">
          <InvitesPanel />
        </div>
      ) : null}
      {active === "permissions" ? <AccountsPanel /> : null}
    </section>
  );
}
