"use client";

import { StatusBadge } from "@/components/ui/StatusBadge";
import type { StructureSummary } from "@/lib/structure";
import type { Status } from "@/lib/status";

const BLURB: Record<Status, string> = {
  draft: "This structure has not been submitted yet. Save it as a draft, then send it to USG when ready.",
  pending: "This structure is waiting for USG to open it.",
  under_review: "USG has this revision. It can approve it, return it for changes, or reject it.",
  returned: "USG returned this revision for changes. Update it and send it back when ready.",
  approved: "USG approved this revision. It is the published structure for its term.",
  rejected: "USG rejected this revision. It will not be published; start a new revision when you are ready.",
  overdue: "The review deadline for this revision has passed.",
};

const DATE = new Intl.DateTimeFormat("en-PH", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function when(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return DATE.format(date);
}

function sortKey(entry: StructureSummary) {
  return entry.decidedAt ?? entry.submittedAt ?? entry.updatedAt ?? entry.createdAt ?? "";
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.6875rem] font-semibold tracking-[0.08em] text-muted uppercase">
        {label}
      </dt>
      <dd className="mt-1 text-[0.875rem] text-ink-deep">{value}</dd>
    </div>
  );
}

export function StructureStatusTracker({
  draft,
  approved,
  history,
}: {
  draft?: StructureSummary | null;
  approved?: StructureSummary | null;
  history?: StructureSummary[] | null;
}) {
  const seen = new Set<string>();
  const entries: StructureSummary[] = [];
  for (const entry of [draft, approved, ...(history ?? [])]) {
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
  }
  const latest = entries.sort((a, b) => sortKey(b).localeCompare(sortKey(a)))[0] ?? null;

  if (!latest) {
    return (
      <section className="rounded-2xl border border-line bg-paper/70 p-5 sm:p-6">
        <p className="eyebrow">Submission status</p>
        <h3 className="mt-1 text-[1.25rem] leading-tight">No structure submitted yet</h3>
        <p className="mt-2 max-w-2xl text-[0.875rem] leading-relaxed text-body">
          Build your council structure below. Once you submit it, its review status will appear
          here.
        </p>
      </section>
    );
  }

  const blurb = BLURB[latest.status] ?? BLURB.pending;
  const open = latest.status !== "approved" && latest.status !== "rejected";
  const submittedAt = latest.status === "draft" ? null : latest.submittedAt;
  const decidedAt = latest.status === "draft" ? null : latest.decidedAt;
  const reviewer = latest.status === "draft" ? null : latest.decidedBy;
  const previous = entries.filter((entry) => entry.id !== latest.id).slice(0, 6);

  return (
    <section className="rounded-2xl border border-line bg-paper/70 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">Submission status</p>
          <h3 className="mt-1 text-[1.25rem] leading-tight">{latest.termLabel}</h3>
          <p className="mt-2 max-w-2xl text-[0.875rem] leading-relaxed text-body">{blurb}</p>
        </div>
        <StatusBadge status={latest.status} />
      </div>

      <dl className="mt-5 grid gap-4 border-t border-line/70 pt-4 sm:grid-cols-2 lg:grid-cols-4">
        <Detail label="Revision" value={`#${latest.revision}`} />
        <Detail label="Submitted" value={when(submittedAt) ?? "Not yet"} />
        <Detail label="Decision" value={when(decidedAt) ?? "Pending"} />
        <Detail
          label="Reviewer"
          value={reviewer ?? (latest.status === "under_review" ? "Waiting for USG" : "Not decided")}
        />
      </dl>

      {latest.status !== "draft" && latest.submittedBy ? (
        <p className="mt-3 text-[0.8125rem] text-muted">Submitted by {latest.submittedBy}.</p>
      ) : null}

      {latest.decisionRemark ? (
        <div className="mt-4 rounded-xl border border-[#a3702a]/35 bg-[#a3702a]/[0.07] px-3.5 py-3">
          <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-[#8a5f22] uppercase">
            Reviewer remark
          </p>
          <p className="mt-1 text-[0.875rem] leading-relaxed text-[#6f4d1c]">
            {latest.decisionRemark}
          </p>
        </div>
      ) : null}

      {open && approved && approved.id !== latest.id ? (
        <p className="mt-4 rounded-xl border border-line bg-canvas/40 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-body">
          {approved.termLabel} remains published until this revision is approved.
        </p>
      ) : null}

      {previous.length ? (
        <div className="mt-5 border-t border-line/70 pt-4">
          <p className="text-[0.75rem] font-semibold tracking-[0.08em] text-ink-soft uppercase">
            Earlier revisions
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {previous.map((entry) => (
              <li
                key={entry.id}
                className="rounded-xl border border-line bg-canvas/40 px-3.5 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[0.8125rem] font-medium text-ink-deep">
                    {entry.termLabel} &middot; revision {entry.revision}
                  </p>
                  <StatusBadge status={entry.status} />
                </div>
                <p className="mt-1 text-[0.75rem] text-muted">
                  {when(entry.decidedAt) ?? when(entry.submittedAt) ?? when(entry.updatedAt) ?? "No date"}
                </p>
                {entry.decisionRemark ? (
                  <p className="mt-1 text-[0.8125rem] leading-relaxed text-body">
                    {entry.decisionRemark}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
