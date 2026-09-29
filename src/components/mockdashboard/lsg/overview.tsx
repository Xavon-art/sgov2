"use client";

import { useMemo } from "react";
import type { Item, MockState } from "@/lib/mockdashboard/db";
import type { ItemKind } from "@/lib/mockdashboard/types";
import { day } from "@/lib/mockdashboard/format";
import { KpiCard } from "@/components/mockdashboard/kpi-card";
import { Card } from "@/components/mockdashboard/card";

const plural: Record<ItemKind, keyof MockState> = { proposal: "proposals", event: "events", budget: "budgets" };

export function Overview({ state, council }: { state: MockState; council: string }) {

  const mine = useMemo(() => {
    const arr = ["proposal", "event", "budget"] as ItemKind[];
    const items: Item<ItemKind>[] = [];
    for (const k of arr) {
      items.push(...(state[plural[k]] as Item<ItemKind>[]).filter((i) => i.filedBy === council));
    }
    return items;
  }, [state, council]);

  const pending = mine.filter((i) => i.status === "in_review" || i.status === "pending").length;
  const approved = mine.filter((i) => i.status === "approved").length;
  const returned = mine.filter((i) => i.status === "returned").length;

  const myBudgetsApproved = mine.filter((i) => i.kind === "budget" && i.status === "approved");
  const requested = myBudgetsApproved.reduce((a, i) => a + Number((i.detail as { amount?: number }).amount ?? 0), 0);

  const nextEvent = state.events
    .filter((e) => e.status === "approved" && String(e.detail.date ?? "") >= new Date().toISOString().slice(0, 10))
    .sort((a, b) => String(a.detail.date).localeCompare(String(b.detail.date)))[0];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="In review" value={String(pending)} hint={`your pending submissions`} tone="amber" icon="⏳" />
        <KpiCard label="Approved" value={String(approved)} hint="this semester" tone="emerald" icon="✅" />
        <KpiCard label="Returned" value={String(returned)} hint="need your attention" tone="rose" icon="↩️" />
        <KpiCard label="Approved funds" value={`₱${Math.round(requested).toLocaleString("en-PH")}`} hint="approved requests" tone="indigo" icon="₱" />
      </div>

      <Card title={`${council} dashboard`} subtitle="Everything filed by your council, at a glance">
        <ul className="space-y-2">
          <li className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Submissions on file</span>
            <span className="font-semibold text-slate-900">{mine.length}</span>
          </li>
          <li className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Waiting on the USG</span>
            <span className="font-semibold text-slate-900">{pending}</span>
          </li>
          <li className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Next approved event</span>
            <span className="font-semibold text-slate-900">
              {nextEvent ? `${nextEvent.title} · ${day(String(nextEvent.detail.date))}` : "none scheduled"}
            </span>
          </li>
        </ul>
      </Card>
    </div>
  );
}