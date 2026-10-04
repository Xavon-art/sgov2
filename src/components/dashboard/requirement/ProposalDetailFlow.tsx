"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProposalDetail, ProposalsListRow } from "./types";
import { formatDate, formatSize, statusLabel } from "./helpers";
import { ActivityIcon } from "./ActivityIcon";
import { Timeline } from "./Timeline";
import { ProposalForm } from "./ProposalForm";
import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/Field";

/**
 * One proposal, fully open: the timeline, every version's documents, and either
 * the reviewer decision controls or the author's resubmit path.
 */
export function ProposalDetailFlow({
  row,
  reviewer = false,
  onChanged,
  onClose,
}: {
  row: ProposalsListRow;
  reviewer?: boolean;
  onChanged?: () => void;
  onClose?: () => void;
}) {
  const [detail, setDetail] = useState<ProposalDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState<"" | "approved" | "returned" | "rejected">("");
  const [remark, setRemark] = useState("");
  const [resubmitting, setResubmitting] = useState(false);

  const fetchDetail = useCallback(async () => {
    const res = await fetch(`/api/proposals/${row.id}`);
    const data = (await res.json()) as
      | { ok: true; proposal: ProposalDetail }
      | { ok: false; message: string };
    return data;
  }, [row.id]);

  const apply = (data: { ok: boolean; message?: string; proposal?: ProposalDetail }) => {
    if (data.ok && data.proposal) setDetail(data.proposal);
    else setError(data.message ?? "We could not load that proposal.");
  };

  useEffect(() => {
    let alive = true;
    void (async () => {
      const data = await fetchDetail();
      if (alive) apply(data);
    })();
    return () => {
      alive = false;
    };
  }, [fetchDetail]);

  if (error && !detail) {
    return (
      <section className="rounded-2xl border border-line bg-paper/70 p-6">
        <p role="alert" className="text-[0.875rem] font-medium text-[#a5442c]">
          {error}
        </p>
        {onClose ? (
          <Button variant="ghost" className="mt-4" onClick={onClose}>
            Close
          </Button>
        ) : null}
      </section>
    );
  }

  if (!detail) {
    return (
      <section className="rounded-2xl border border-line bg-paper/70 p-6">
        <p role="status" className="text-[0.875rem] text-body">
          Loading the proposal…
        </p>
      </section>
    );
  }

  const latest = detail.versions[0];
  const needsReview = reviewer && (detail.status === "submitted" || detail.status === "returned");
  const canResubmit = !reviewer && detail.status === "returned";
  const template = latest
    ? latest.items.map((it) => ({ itemId: it.itemId, label: it.label, itemKind: it.itemKind }))
    : [];

  const submitReview = async (d: "approved" | "returned" | "rejected") => {
    setError("");
    if ((d === "returned" || d === "rejected") && remark.trim().length < 2) {
      setError("Returning or rejecting needs a reason.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/proposals/${detail.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: d, remark: remark.trim() }),
      });
      const reviewData = await res.json();
      if (!res.ok || !reviewData.ok) {
        setError(reviewData.message ?? "We could not record that decision.");
        return;
      }
      setDecision("");
      setRemark("");
      onChanged?.();
      const data = await fetchDetail();
      apply(data);
    } catch {
      setError("We could not record that decision.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-paper/70 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brass-soft/40">
              <ActivityIcon type={detail.activityType} className="h-4 w-4 text-brass-deep" />
            </span>
            <p className="text-[1.0625rem] font-semibold text-ink">{detail.title}</p>
            <span className="rounded-full bg-brass-soft/45 px-2.5 py-1 text-[0.6875rem] font-semibold tracking-[0.06em] text-brass-deep uppercase">
              {statusLabel(detail.status)}
            </span>
          </div>
          <p className="mt-2 text-[0.8125rem] leading-relaxed text-body">
            {detail.description}
          </p>
          <p className="mt-1 text-[0.75rem] text-muted">
            {[detail.unitName, detail.programName ?? "Standalone", formatDate(detail.eventDate)]
              .filter(Boolean)
              .join(" · ")}
            {detail.venue ? ` · ${detail.venue}` : ""}
          </p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-[0.8125rem] font-semibold text-ink-soft hover:text-ink"
          >
            Close
          </button>
        ) : null}
      </div>

      <div className="mt-6">
        <p className="text-[0.8125rem] font-semibold tracking-[0.08em] text-ink-soft uppercase">
          Approval history
        </p>
        <Timeline proposal={detail} />
      </div>

      <div className="mt-6 flex flex-col gap-4">
        {detail.versions.map((v) => (
          <div key={v.id} className="rounded-xl border border-line/70 bg-canvas/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[0.875rem] font-semibold text-ink">v{v.versionNumber}</p>
              <p className="text-[0.6875rem] text-muted">
                {formatDate(v.submittedAt)} · {v.submittedBy}
              </p>
            </div>
            {v.submissionNote ? (
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-body">{v.submissionNote}</p>
            ) : null}
            <ul className="mt-3 flex flex-col gap-2">
              {v.items.map((it) => (
                <li
                  key={it.itemId}
                  className="flex items-center justify-between gap-3 rounded-lg border border-line/70 bg-paper/60 px-3 py-2"
                >
                  <span className="truncate text-[0.8125rem] text-ink-soft">{it.label}</span>
                  {it.submissionKind === "file" && it.submissionId ? (
                    <a
                      key={it.submissionId}
                      href={`/api/files/${it.submissionId}`}
                      className="shrink-0 text-[0.75rem] font-semibold text-brass-deep underline-offset-2 hover:underline"
                    >
                      {it.originalName ?? "file"} · {formatSize(it.sizeBytes)}
                    </a>
                  ) : it.submissionKind === "link" && it.linkUrl ? (
                    <a
                      href={it.linkUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 truncate text-[0.75rem] font-semibold text-brass-deep underline-offset-2 hover:underline"
                    >
                      {it.linkUrl.length > 40 ? `${it.linkUrl.slice(0, 40)}…` : it.linkUrl}
                    </a>
                  ) : (
                    <span className="shrink-0 text-[0.75rem] text-muted">—</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {needsReview ? (
        <div className="mt-6 border-t border-line/70 pt-5">
          <p className="text-[0.8125rem] font-semibold tracking-[0.08em] text-ink-soft uppercase">
            Decide
          </p>
          <TextArea
            id="review-remark"
            label={
              decision === "returned" || decision === "rejected"
                ? "Reason (required for a return or rejection)"
                : "Remark"
            }
            value={remark}
            maxLength={400}
            optional={decision === "approved"}
            onChange={(e) => setRemark(e.target.value)}
          />
          {error ? (
            <p role="alert" className="mt-2 text-[0.8125rem] font-medium text-[#a5442c]">
              {error}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-3">
            {(["approved", "returned", "rejected"] as const).map((d) => (
              <Button
                key={d}
                size="sm"
                variant={d === "approved" ? "primary" : "paper"}
                disabled={busy}
                onClick={() => submitReview(d)}
              >
                {d === "approved" ? "Approve" : d === "returned" ? "Return" : "Reject"}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {canResubmit && !resubmitting ? (
        <div className="mt-6 border-t border-line/70 pt-5">
          <Button variant="brass" onClick={() => setResubmitting(true)}>
            Resubmit revision
          </Button>
        </div>
      ) : null}

      {canResubmit && resubmitting ? (
        <div className="mt-6">
          <ProposalForm
            template={template}
            proposalId={detail.id}
            initialVersion={latest?.versionNumber ?? 1}
            heading={`Revision ${(latest?.versionNumber ?? 1) + 1} of ${detail.title}`}
            onDone={() => {
              setResubmitting(false);
              onChanged?.();
              void (async () => {
                const data = await fetchDetail();
                apply(data);
              })();
            }}
          />
        </div>
      ) : null}
    </section>
  );
}