"use client";

import type { ProposalDetail } from "./types";
import { formatDate } from "./helpers";

function nodeDot(kind: string) {
  const map = {
    created: "bg-ink",
    approved: "bg-brass",
    returned: "bg-brass-soft",
    rejected: "bg-ink-muted",
  } as Record<string, string>;
  return `mt-1 size-2.5 shrink-0 rounded-full ${map[kind] ?? "bg-line"}`;
}

type Step = {
  label: string;
  at: string;
  kind: string;
  remark?: string | null;
  version?: number;
  by?: string;
};

/**
 * The approval history of one proposal, oldest first: the initial submission
 * plus every review decision on top.
 */
export function Timeline({ proposal }: { proposal: ProposalDetail }) {
  const steps: Step[] = [
    { label: "Submitted", at: proposal.createdAt, kind: "created" },
    ...proposal.reviews.map((r): Step => ({
      label:
        r.decision === "approved"
          ? "Approved"
          : r.decision === "returned"
            ? "Returned"
            : "Rejected",
      at: r.createdAt,
      kind: r.decision,
      remark: r.remark,
      version: r.versionNumber,
      by: r.decidedBy,
    })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  if (steps.length === 0) return null;

  return (
    <ol className="mt-4 flex flex-col gap-3">
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-3">
          <span aria-hidden className={nodeDot(s.kind)} />
          <div>
            <p className="text-[0.875rem] font-semibold text-ink">
              {s.version ? `v${s.version} · ` : ""}
              {s.label}
            </p>
            {s.remark ? (
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-body">{s.remark}</p>
            ) : null}
            <p className="mt-0.5 text-[0.6875rem] text-muted">
              {formatDate(s.at)} {s.by ? `· ${s.by}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}