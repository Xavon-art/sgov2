"use client";

import { Reveal } from "@/components/fx/Reveal";
import { useDashboard } from "@/components/dashboard/dashboard-context";

/** Sign-in details, as a plain definition list. */
export function AccountSection() {
  const { account, meta } = useDashboard();

  const isOwner = account.accountScope === "owner";

  const rows: Array<[string, string]> = [
    ["Account", account.email],
    ["Signed in as", account.displayName],
    ["Role", isOwner ? "Account owner" : "Invited member"],
    [
      "Scope",
      account.accountKind === "central" ? "Central office" : "University student government",
    ],
    ["University", account.universityName || "—"],
    ["Campus", account.campusName || "—"],
    ["Charter", meta.charterNumber || "—"],
    ["Academic year", meta.academicYear || "—"],
  ];

  return (
    <section id="account" className="scroll-mt-24">
      <Reveal>
        <div className="rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
          <p className="eyebrow">Account</p>
          <dl className="mt-4 flex flex-col">
            {rows.map(([label, value]) => (
              <div
                key={label}
                className="flex items-baseline justify-between gap-6 border-b border-line/70 py-2.5 last:border-b-0"
              >
                <dt className="text-[0.75rem] font-medium tracking-[0.06em] text-muted uppercase">
                  {label}
                </dt>
                <dd className="truncate text-[0.875rem] text-ink-deep">{value || "—"}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Reveal>
    </section>
  );
}