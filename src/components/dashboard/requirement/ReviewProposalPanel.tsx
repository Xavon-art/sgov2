"use client";

import { useState } from "react";
import type { ProposalDetail } from "./types";
import { formatMoney, formatSize } from "./helpers";
import { Button } from "@/components/ui/Button";
import { TextArea, TextField } from "@/components/ui/Field";

type ReqRow = { label: string; detail: string };
type Verdict = "accepted" | "waived";

async function post(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
  if (!res.ok || !data.ok) {
    throw new Error(data.message ?? "That action did not go through.");
  }
  return data;
}

/**
 * The USG's side of the review: start the review, then decide. Approving with
 * no requirements seals the proposal; approving with a list opens the
 * requirements loop instead. When the unit has answered, this same panel turns
 * into the verification step, where each submitted requirement is accepted or
 * waived before the proposal can finally be approved.
 */
export function ReviewProposalPanel({
  proposal,
  onDone,
}: {
  proposal: ProposalDetail;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"reject" | "return" | "requirements" | null>(null);
  const [remark, setRemark] = useState("");
  const [rows, setRows] = useState<ReqRow[]>([{ label: "", detail: "" }]);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [verNotes, setVerNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const latest = proposal.versions[0];
  const budget = proposal.budget;
  const submittedReqs = proposal.requirements.filter((r) => r.status === "submitted");

  const run = async (fn: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try {
      await fn();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That action did not go through.");
    } finally {
      setBusy(false);
    }
  };

  const startReview = () =>
    run(async () => {
      await post(`/api/proposals/${proposal.id}/start-review`, {});
    });

  const decide = (decision: "approved" | "rejected" | "returned") =>
    run(async () => {
      if ((decision === "rejected" || decision === "returned") && remark.trim().length < 2) {
        throw new Error("A reason is required to return or reject.");
      }
      await post(`/api/proposals/${proposal.id}/review`, {
        decision,
        remark: remark.trim(),
      });
      setMode(null);
      setRemark("");
    });

  const approveWithRequirements = () =>
    run(async () => {
      const requirements = rows
        .map((r) => ({ label: r.label.trim(), detail: r.detail.trim() }))
        .filter((r) => r.label.length > 0);
      if (requirements.length < 1) {
        throw new Error("Add at least one requirement with a name.");
      }
      await post(`/api/proposals/${proposal.id}/review`, {
        decision: "approved",
        remark: remark.trim(),
        requirements,
      });
      setMode(null);
      setRemark("");
      setRows([{ label: "", detail: "" }]);
    });

  const finishVerification = () =>
    run(async () => {
      const decisions = submittedReqs.map((r) => ({
        requirementId: r.id,
        decision: verdicts[r.id],
        note: (verNotes[r.id] ?? "").trim() || undefined,
      }));
      if (decisions.some((d) => !d.decision)) {
        throw new Error("Accept or waive every submitted requirement first.");
      }
      await post(`/api/proposals/${proposal.id}/requirements/verify`, { decisions });
    });

  return (
    <section className="rounded-2xl border border-line bg-paper/70 p-6">
      <p className="eyebrow">Review</p>

      {budget ? (
        <div className="mt-4 rounded-xl border border-line/70 bg-canvas/40 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[0.875rem] font-semibold text-ink">{budget.title}</p>
            <p className="text-[0.875rem] font-semibold text-ink-deep">
              {formatMoney(budget.requestedTotal)}
            </p>
          </div>
          {budget.justification ? (
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-body">
              {budget.justification}
            </p>
          ) : null}
          <ul className="mt-3 flex flex-col gap-1.5">
            {budget.items.map((it) => (
              <li key={it.id} className="flex items-center justify-between gap-3 text-[0.8125rem]">
                <span className="truncate text-ink-soft">{it.label}</span>
                <span className="shrink-0 text-muted">
                  {it.quantity} × {formatMoney(it.unitCost)}
                </span>
                <span className="shrink-0 font-medium text-ink">{formatMoney(it.subtotal)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 text-[0.8125rem] text-muted">No budget was attached to this proposal.</p>
      )}

      {latest ? (
        <div className="mt-4">
          <p className="text-[0.75rem] font-semibold tracking-[0.08em] text-ink-soft uppercase">
            Documents on v{latest.versionNumber}
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {latest.items.map((it) => (
              <li
                key={it.itemId}
                className="flex items-center justify-between gap-3 rounded-lg border border-line/70 bg-paper/60 px-3 py-2"
              >
                <span className="truncate text-[0.8125rem] text-ink-soft">{it.label}</span>
                {it.submissionKind === "file" && it.submissionId ? (
                  <a
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
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-[0.8125rem] font-medium text-[#a5442c]">
          {error}
        </p>
      ) : null}

      {proposal.status === "submitted" ? (
        <div className="mt-4 border-t border-line/70 pt-4">
          <p className="text-[0.8125rem] leading-relaxed text-body">
            Open the review when you are ready to look through the documents above. The
            unit will see the proposal move to <em>Under review</em>.
          </p>
          <Button variant="brass" className="mt-3" disabled={busy} onClick={startReview}>
            Review proposal
          </Button>
        </div>
      ) : null}

      {proposal.status === "requirements_requested" ? (
        <div className="mt-4 border-t border-line/70 pt-4">
          <p className="text-[0.8125rem] leading-relaxed text-body">
            Waiting on the unit to answer the additional requirements. It will come back
            to you here for verification.
          </p>
        </div>
      ) : null}

      {proposal.status === "under_review" ? (
        <div className="mt-4 border-t border-line/70 pt-4">
          {submittedReqs.length > 0 ? (
            <div className="flex flex-col gap-3">
              <p className="text-[0.8125rem] leading-relaxed text-body">
                The unit answered every requirement. Accept or waive each one, then finish.
              </p>
              {submittedReqs.map((r) => (
                <div key={r.id} className="rounded-xl border border-line/70 bg-canvas/40 p-3">
                  <p className="text-[0.875rem] font-medium text-ink">{r.label}</p>
                  {r.detail ? (
                    <p className="mt-0.5 text-[0.8125rem] text-body">{r.detail}</p>
                  ) : null}
                  {r.linkUrl ? (
                    <a
                      href={r.linkUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block text-[0.75rem] font-semibold text-brass-deep underline-offset-2 hover:underline"
                    >
                      {r.linkUrl}
                    </a>
                  ) : r.originalName ? (
                    <a
                      href={`/api/files/requirement/${r.id}`}
                      className="mt-1 inline-block text-[0.75rem] font-semibold text-brass-deep underline-offset-2 hover:underline"
                    >
                      {r.originalName} · {formatSize(r.sizeBytes)}
                    </a>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {(["accepted", "waived"] as const).map((v) => (
                      <Button
                        key={v}
                        size="sm"
                        variant={verdicts[r.id] === v ? "primary" : "paper"}
                        disabled={busy}
                        onClick={() => setVerdicts((m) => ({ ...m, [r.id]: v }))}
                      >
                        {v === "accepted" ? "Accept" : "Waive"}
                      </Button>
                    ))}
                    <input
                      aria-label={`Note for ${r.label}`}
                      value={verNotes[r.id] ?? ""}
                      onChange={(e) => setVerNotes((m) => ({ ...m, [r.id]: e.target.value }))}
                      placeholder="Note (optional)"
                      className="h-10 min-w-40 flex-1 rounded-lg border border-line bg-paper/70 px-3 text-[0.8125rem] text-ink-deep outline-none focus:border-ink/25"
                    />
                  </div>
                </div>
              ))}
              <div>
                <Button variant="brass" disabled={busy} onClick={finishVerification}>
                  {busy ? "Saving…" : "Finish verification"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <TextArea
                id="review-remark"
                label={
                  mode === "reject"
                    ? "Reason (required)"
                    : mode === "return"
                      ? "What to change (required)"
                      : mode === "requirements"
                        ? "Note shown with the requirements"
                        : "Remark"
                }
                value={remark}
                maxLength={400}
                optional={mode !== "reject" && mode !== "return"}
                onChange={(e) => setRemark(e.target.value)}
              />

              {mode === "requirements" ? (
                <div className="flex flex-col gap-2">
                  <span className="text-[0.8125rem] font-medium text-ink">
                    Additional requirements
                  </span>
                  {rows.map((row, i) => (
                    <div key={i} className="flex flex-col gap-2 rounded-xl border border-line/70 bg-canvas/40 p-3 sm:flex-row sm:items-end">
                      <TextField
                        id={`req-label-${i}`}
                        label="Requirement"
                        value={row.label}
                        maxLength={140}
                        onChange={(e) =>
                          setRows((m) => m.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))
                        }
                        placeholder="Annex A: barangay clearance"
                      />
                      <TextField
                        id={`req-detail-${i}`}
                        label="Detail (optional)"
                        value={row.detail}
                        maxLength={1000}
                        onChange={(e) =>
                          setRows((m) => m.map((r, j) => (j === i ? { ...r, detail: e.target.value } : r)))
                        }
                        placeholder="Signed by the barangay captain"
                      />
                      {rows.length > 1 ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setRows((m) => m.filter((_, j) => j !== i))}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  ))}
                  <div>
                    <Button
                      size="sm"
                      variant="paper"
                      disabled={busy}
                      onClick={() => setRows((m) => [...m, { label: "", detail: "" }])}
                    >
                      Add requirement
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3">
                {mode === "requirements" ? (
                  <Button variant="brass" disabled={busy} onClick={approveWithRequirements}>
                    {busy ? "Sending…" : "Send requirements"}
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={busy}
                      onClick={() => decide("approved")}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="paper"
                      disabled={busy}
                      onClick={() => setMode("requirements")}
                    >
                      Approve + Requirements
                    </Button>
                  </>
                )}
                <Button
                  size="sm"
                  variant="paper"
                  disabled={busy}
                  onClick={() => setMode(mode === "return" ? null : "return")}
                >
                  Return
                </Button>
                <Button
                  size="sm"
                  variant="paper"
                  disabled={busy}
                  onClick={() => setMode(mode === "reject" ? null : "reject")}
                >
                  Reject
                </Button>
                {mode !== null ? (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMode(null)}>
                    Cancel
                  </Button>
                ) : null}
                {mode === "reject" || mode === "return" ? (
                  <Button
                    size="sm"
                    variant="brass"
                    disabled={busy}
                    onClick={() => decide(mode === "reject" ? "rejected" : "returned")}
                  >
                    {busy ? "Saving…" : mode === "reject" ? "Confirm rejection" : "Confirm return"}
                  </Button>
                ) : null}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}