"use client";

import { useState } from "react";
import { DashboardShell } from "@/components/mockdashboard/dashboard-shell";
import { Button } from "@/components/mockdashboard/button";
import { LoadingState } from "@/components/mockdashboard/loading-state";
import { useStore } from "@/lib/mockdashboard/use-store";
import { Overview } from "@/components/mockdashboard/usg/overview";
import { Reviews } from "@/components/mockdashboard/usg/reviews";
import { Ledger } from "@/components/mockdashboard/usg/ledger";
import { Calendar } from "@/components/mockdashboard/usg/calendar";
import { Announcements } from "@/components/mockdashboard/usg/announcements";
import { Units } from "@/components/mockdashboard/usg/units";

const tabs = [
  { id: "overview", label: "Overview" },
  { id: "reviews", label: "Reviews" },
  { id: "ledger", label: "Budget ledger" },
  { id: "calendar", label: "Events" },
  { id: "units", label: "Units & councils" },
  { id: "announcements", label: "Announcements" },
];

export default function UsgPage() {
  const { state, actions } = useStore();
  const [tab, setTab] = useState("overview");

  if (!state) return <LoadingState />;

  const inReview = [...state.proposals, ...state.events, ...state.budgets].filter((i) => i.status === "in_review").length;

  return (
    <DashboardShell
      role="usg"
      heading="University Student Government"
      right={<Button variant="secondary" onClick={actions.reset}>Reset demo</Button>}
      tabs={tabs.map((t) => (t.id === "reviews" ? { ...t, count: inReview } : t))}
      active={tab}
      onTab={setTab}
    >
      {tab === "overview" && <Overview state={state} />}
      {tab === "reviews" && <Reviews state={state} actions={actions} />}
      {tab === "ledger" && <Ledger state={state} />}
      {tab === "calendar" && <Calendar state={state} />}
      {tab === "units" && <Units state={state} actions={actions} />}
      {tab === "announcements" && <Announcements state={state} actions={actions} />}
    </DashboardShell>
  );
}