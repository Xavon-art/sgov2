"use client";

import type { ProposalStatus } from "./types";

/**
 * The four nodes the proposal lifecycle moves through. `returned` and
 * `submitted` both sit on the first node: a return sends the proposal back to
 * the start, and a resubmission lands there again until a reviewer picks it up.
 */
const NODES = ["Pending Review", "Under Review", "Responded", "Verified"] as const;

function activeIndex(status: ProposalStatus): number {
  switch (status) {
    case "submitted":
    case "returned":
      return 0;
    case "under_review":
      return 1;
    case "rejected":
    case "requirements_requested":
      return 2;
    case "approved":
    case "published":
      return 3;
  }
}

const OUTCOME_CHIP: Partial<Record<ProposalStatus, { label: string; className: string }>> = {
  rejected: { label: "Rejected", className: "bg-[#f3d9d3] text-[#a5442c]" },
  requirements_requested: {
    label: "Additional requirements",
    className: "bg-brass-soft/60 text-brass-deep",
  },
  approved: { label: "Approved", className: "bg-ink text-canvas" },
  published: { label: "Approved", className: "bg-ink text-canvas" },
};

/**
 * A compact progress bar for one proposal. The active node carries
 * `aria-current="step"` so the bar reads as a stepper rather than decoration,
 * and the outcome a status implies (rejected / needs more / approved) is shown
 * as a chip next to it -- the node alone cannot say which way a response went.
 */
export function ProgressStepper({ status }: { status: ProposalStatus }) {
  const active = activeIndex(status);
  const chip = OUTCOME_CHIP[status];

  return (
    <div className="flex flex-col gap-2">
      <ol role="list" className="flex items-center gap-1.5">
        {NODES.map((node, i) => {
          const done = i < active;
          const current = i === active;
          return (
            <li
              key={node}
              className="flex min-w-0 flex-1 items-center gap-1.5"
              aria-current={current ? "step" : undefined}
            >
              <span
                className={`grid size-6 shrink-0 place-items-center rounded-full text-[0.6875rem] font-semibold ${
                  done
                    ? "bg-ink text-canvas"
                    : current
                      ? "bg-brass text-ink-deep"
                      : "bg-canvas text-muted"
                }`}
              >
                {i + 1}
              </span>
              <span
                className={`truncate text-[0.75rem] font-medium ${
                  current ? "text-ink" : "text-muted"
                }`}
              >
                {node}
              </span>
              {i < NODES.length - 1 ? (
                <span
                  aria-hidden
                  className={`h-px min-w-2 flex-1 ${done ? "bg-ink/40" : "bg-line"}`}
                />
              ) : null}
            </li>
          );
        })}
      </ol>

      {chip ? (
        <span
          className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold tracking-[0.06em] uppercase ${chip.className}`}
        >
          {chip.label}
        </span>
      ) : null}
    </div>
  );
}