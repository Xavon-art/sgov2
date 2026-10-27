"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "@/components/dashboard/dashboard-context";

type Org = {
  id: string;
  name: string;
  governanceModel: string;
  accent: string | null;
  themeMode: string | null;
  logoData: string | null;
  status: string;
};

/**
 * "My USG" -- the read-only card an LSG sees for its parent.
 *
 * The unit cannot edit anything here; the point is to know who it answers to,
 * recognise the mark, and have one obvious way to open a conversation. The
 * data comes from the same `/api/profile` read the rest of the dashboard uses,
 * so there is no second source of truth for the organisation's identity.
 */
export function MyUsgPanel() {
  const account = useAccount();
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/profile");
        const data = await res.json();
        if (!cancelled && res.ok && data.ok) setOrg(data.organization ?? null);
      } catch {
        // The card degrades to the account's own university name below.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p className="text-[0.875rem] text-muted">Loading your USG…</p>;

  const name = org?.name ?? account.universityName ?? "University Student Government";

  return (
    <section className="card-lift rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
      <p className="eyebrow">My USG</p>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        {org?.logoData ? (
          // The logo is stored as a data URL by the customisation panel.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={org.logoData} alt="" className="size-16 rounded-2xl border border-line object-contain p-1.5" />
        ) : (
          <div className="grid size-16 place-items-center rounded-2xl border border-line bg-canvas text-[1.25rem] font-semibold text-brass-deep">
            {name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <h2 className="text-[1.25rem] leading-tight">{name}</h2>
          <p className="mt-0.5 text-[0.8125rem] text-muted">
            {org?.governanceModel === "federated" ? "Federated student government" : "Parent student government"}
            {org?.status ? ` · ${org.status}` : ""}
          </p>
        </div>
      </div>

      <p className="mt-4 max-w-2xl text-[0.9375rem] leading-relaxed text-body">
        Your unit sits under this University Student Government. It sets university-wide direction,
        reviews your submissions, and decides on your event claims. You can message it directly.
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        <Link
          href="/lsg/messages"
          className="pressable inline-flex min-h-10 items-center rounded-full bg-ink px-4 text-[0.875rem] font-medium text-white hover:bg-ink-deep"
        >
          Message the USG
        </Link>
        <Link
          href="/lsg/manage?tab=profile"
          className="pressable inline-flex min-h-10 items-center rounded-full border border-line-strong px-4 text-[0.875rem] font-medium text-ink hover:border-ink/40 hover:bg-ink/[0.035]"
        >
          Your profile
        </Link>
      </div>
    </section>
  );
}
