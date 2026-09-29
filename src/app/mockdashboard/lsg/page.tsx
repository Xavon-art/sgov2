"use client";

import { useState } from "react";
import { DashboardShell } from "@/components/mockdashboard/dashboard-shell";
import { Button } from "@/components/mockdashboard/button";
import { LoadingState } from "@/components/mockdashboard/loading-state";
import { useStore } from "@/lib/mockdashboard/use-store";
import { Overview } from "@/components/mockdashboard/lsg/overview";
import { MySubmissions } from "@/components/mockdashboard/lsg/my-submissions";
import { FileNew } from "@/components/mockdashboard/lsg/file-new";
import { Funds } from "@/components/mockdashboard/lsg/funds";
import { Feed } from "@/components/mockdashboard/lsg/feed";
import { OrgChart } from "@/components/mockdashboard/lsg/org-chart";
import type { ItemKind } from "@/lib/mockdashboard/types";

const COUNCIL = "CCIS Student Council";
const EMAIL = "ccis.sg@univ.edu.ph";

const tabs = [
  { id: "overview", label: "Overview" },
  { id: "submissions", label: "My submissions" },
  { id: "file", label: "File new" },
  { id: "funds", label: "Budget & funds" },
  { id: "feed", label: "Announcements" },
  { id: "org", label: "Org chart" },
];

export default function LsgPage() {
  const { state, actions } = useStore();
  const [tab, setTab] = useState("overview");

  if (!state) return <LoadingState />;

  const myPending = [...state.proposals, ...state.events, ...state.budgets].filter(
    (i) => i.filedBy === COUNCIL && (i.status === "in_review" || i.status === "pending"),
  ).length;

  return (
    <DashboardShell
      role="lsg"
      heading={`${COUNCIL} — local student council`}
      right={<Button variant="secondary" onClick={actions.reset}>Reset demo</Button>}
      tabs={tabs.map((t) => (t.id === "file" ? { ...t, count: myPending } : t))}
      active={tab}
      onTab={setTab}
    >
      {tab === "overview" && <Overview state={state} council={COUNCIL} />}
      {tab === "submissions" && (
        <MySubmissions
          state={state}
          council={COUNCIL}
          actions={{
            review: (kind, id, action, comment, byLabel, byName) =>
              actions.review(kind as ItemKind, id, action, comment, byLabel, byName),
          }}
        />
      )}
      {tab === "file" && (
        <FileNew
          council={COUNCIL}
          email={EMAIL}
          onFile={(kind, input) => actions.file(kind, input)}
        />
      )}
      {tab === "funds" && <Funds state={state} council={COUNCIL} />}
      {tab === "feed" && <Feed state={state} />}
      {tab === "org" && <OrgChart state={state} />}
    </DashboardShell>
  );
}