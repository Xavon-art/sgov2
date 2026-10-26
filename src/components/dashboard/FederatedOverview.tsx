"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Reveal } from "@/components/fx/Reveal";
import { ButtonLink } from "@/components/ui/Button";
import { useDashboard } from "@/components/dashboard/dashboard-context";
import type { NavItem } from "@/components/dashboard/AppShell";

/**
 * The overview each workspace opens on.
 *
 * It is deliberately built from nav, not from a fixed list of cards. The two
 * workspaces (USG and LSG) share six sections but not their meaning, and the
 * cards here are simply the sections with whatever the section is waiting on.
 * Passing `nav` in means this file names no route of its own -- the same
 * arrangement that keeps `usg-nav.ts` free of LSG routes keeps this overview
 * from ever rendering a link the caller's side does not own.
 *
 * The counts come from `/api/overview`. In Phase 1 only the wire is real; the
 * Request / Events / Survey modules that will fill it land in later phases, so
 * the screen states plainly what each number means rather than dressing a zero
 * up as work.
 */

type OverviewPayload = {
  ok: boolean;
  counts?: {
    tasksOpen: number;
    tasksOverdue: number;
    requestsOpen: number;
    eventsPending: number;
    surveysOpen: number;
  };
  message?: string;
};

/** Which counter belongs to which nav section, so a card can badge itself. */
function countFor(id: string, c: NonNullable<OverviewPayload["counts"]>): number | null {
  switch (id) {
    case "request":
      return c.tasksOpen + c.requestsOpen;
    case "events":
      return c.eventsPending;
    case "survey":
      return c.surveysOpen;
    default:
      return null;
  }
}

export function FederatedOverview({
  nav,
  side,
}: {
  nav: NavItem[];
  side: "usg" | "lsg";
}) {
  const { account, meta } = useDashboard();
  const [counts, setCounts] = useState<OverviewPayload["counts"] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/overview");
        const body = (await res.json().catch(() => ({}))) as OverviewPayload;
        if (!alive) return;
        if (res.ok && body.ok) {
          setCounts(body.counts ?? null);
          setError("");
        } else {
          setError(body.message ?? "We could not load your overview.");
        }
      } catch {
        if (alive) setError("We could not load your overview.");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const roleWord = account.accountScope === "owner" ? "owner" : "officer";
  const unitName = account.campusName || account.universityName || null;

  // The heading says who is looking at it. A USG owner sees the office; an LSG
  // officer sees their own unit, because the whole point of the LSG side is
  // that it is one unit's desk rather than the university's.
  const heading =
    side === "usg"
      ? meta.organizationName || "Student government office"
      : unitName || "Your unit";

  return (
    <section className="flex flex-col gap-8">
      <Reveal className="flex flex-col gap-3">
        <p className="eyebrow">{side === "usg" ? "Office desk" : "Unit desk"}</p>
        <h1 className="text-[1.875rem] leading-tight sm:text-[2.25rem]">{heading}</h1>
        <p className="max-w-2xl text-[0.9375rem] leading-relaxed text-body">
          {side === "usg"
            ? "You oversee every unit underneath you: their tasks, their requests back up, the events they file, and the surveys you run together. Start anywhere below."
            : `What ${unitName ?? "your unit"} owes the USG, and what it has sent back. Start anywhere below.`}
        </p>
        <p className="text-[0.75rem] text-muted">
          Signed in as {account.displayName} · {roleWord}
        </p>
      </Reveal>

      {error ? (
        <p role="alert" className="text-[0.9375rem] font-medium text-[#a5442c]">
          {error}
        </p>
      ) : null}

      <Reveal delay={0.06}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {nav.map((item) => {
            const badge = counts ? countFor(item.id, counts) : null;
            return (
              <Link
                key={item.id}
                href={item.href}
                className="group flex flex-col gap-2 rounded-2xl border border-line bg-paper/70 p-5 transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lift"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-[1.0625rem] leading-snug font-medium text-ink">
                    {item.label}
                  </span>
                  {badge && badge > 0 ? (
                    <span className="shrink-0 rounded-full bg-brass-soft/50 px-2.5 py-1 text-[0.6875rem] font-semibold text-brass-deep">
                      {badge}
                    </span>
                  ) : null}
                </span>
                <span className="text-[0.8125rem] leading-relaxed text-muted">{item.hint}</span>
              </Link>
            );
          })}
        </div>
      </Reveal>

      <Reveal delay={0.1}>
        <div className="rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
          <p className="eyebrow">{side === "usg" ? "Your umbrella" : "Your standing"}</p>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-body">
            {side === "usg"
              ? "Manage holds the units under you, the invitations you send, and your own profile and look. Request is where you push a task down and read what comes back."
              : "Manage holds your own profile and government structure. Request is where the USG's tasks land, and where you send a request of your own back up."}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <ButtonLink href={nav[1]?.href ?? nav[0].href} variant="primary" size="sm">
              {side === "usg" ? "Open Manage" : "Open Manage"}
            </ButtonLink>
            <ButtonLink href={nav[2]?.href ?? nav[0].href} variant="paper" size="sm">
              Go to Request
            </ButtonLink>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
