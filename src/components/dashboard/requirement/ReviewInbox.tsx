"use client";

import { useState } from "react";
import type { ProposalsListRow } from "./types";
import { formatDate } from "./helpers";
import { ActivityIcon } from "./ActivityIcon";
import { ProposalDetailFlow } from "./ProposalDetailFlow";
import { Button } from "@/components/ui/Button";

function StatusBadge({ status }: { status: ProposalsListRow["status"] }) {
  if (status === "approved") {
    return (
      <span className="inline-flex items-center rounded-full bg-ink px-2.5 py-1 text-[0.6875rem] font-semibold tracking-[0.06em] text-canvas uppercase">
        Approved
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span className="inline-flex items-center rounded-full border border-line px-2.5 py-1 text-[0.6875rem] font-semibold tracking-[0.06em] text-ink-soft uppercase">
        Rejected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-brass-soft/45 px-2.5 py-1 text-[0.6875rem] font-semibold tracking-[0.06em] text-brass-deep uppercase">
      {status === "published" ? "Published" : "Returned"}
    </span>
  );
}

/**
 * The USG board's review inbox. Rows needing attention -- submitted or returned
 * proposals -- open the detail flow, which carries the decision actions.
 */
export function ReviewInbox({
  proposals,
  onChanged,
}: {
  proposals: ProposalsListRow[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState<ProposalsListRow | null>(null);
  const awaiting = proposals.filter(
    (x) => x.status === "submitted" || x.status === "returned",
  );

  if (open) {
    return (
      <ProposalDetailFlow
        row={open}
        reviewer
        onChanged={onChanged}
        onClose={() => setOpen(null)}
      />
    );
  }

  return (
    <section className="rounded-2xl border border-line bg-paper/70 p-6">
      <div className="flex items-center justify-between">
        <p className="eyebrow">Review inbox</p>
        <span className="text-[0.75rem] text-muted">{awaiting.length} waiting</span>
      </div>

      {awaiting.length === 0 ? (
        <p className="mt-4 text-[0.875rem] text-body">
          Nothing waiting. New LSG submissions land here.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {awaiting.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-line/70 bg-canvas/40 px-4 py-3"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brass-soft/40">
                <ActivityIcon type={p.activityType} className="h-4 w-4 text-brass-deep" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.9375rem] font-medium text-ink">{p.title}</p>
                <p className="mt-0.5 truncate text-[0.75rem] text-muted">
                  {[p.unitName, p.programName ?? "Standalone"].filter(Boolean).join(" · ")}
                  {p.latestRemark ? ` — ${p.latestRemark}` : ""}
                </p>
              </div>
              <span className="text-[0.75rem] text-muted">v{p.version}</span>
              <span className="hidden text-[0.75rem] text-muted sm:inline">
                {formatDate(p.createdAt)}
              </span>
              <StatusBadge status={p.status} />
              <Button size="sm" variant="paper" onClick={() => setOpen(p)}>
                Review
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}