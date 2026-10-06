"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/Field";
import { formatDate } from "./helpers";

/**
 * The document checklist for one proposal: every submitted item, whether a document
 * is actually attached, and the ruling on it.
 *
 * A reviewer can rule on each line. An author sees the same lines read-only, which
 * is the point of `list_verifications` returning both the organisation's latest
 * opinion and this reader's own: an author who was never asked a question should be
 * able to see that nobody has asked one yet.
 *
 * `queried` is the one verdict that needs typing. The other two are one click, so
 * making them cost the same as a question would be friction with nothing behind it.
 */

export type VerificationItem = {
  submissionId: string;
  label: string;
  itemKind: string;
  submissionKind: string;
  originalName?: string | null;
  linkUrl?: string | null;
  hasDocument: boolean;
  verdict?: string | null;
  remark?: string | null;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
  myVerdict?: string | null;
  myRemark?: string | null;
  reviewerCount?: number;
};

const VERDICT_COPY: Record<string, { label: string; className: string }> = {
  verified: { label: "Verified", className: "bg-[#e6f0e6] text-[#2f5d38]" },
  queried: { label: "Query sent", className: "bg-brass-soft/50 text-brass-deep" },
  rejected: { label: "Rejected", className: "bg-[#f7e3dd] text-[#a5442c]" },
};

function VerdictBadge({ verdict }: { verdict?: string | null }) {
  if (!verdict) {
    return (
      <span className="shrink-0 rounded-full bg-canvas px-2.5 py-1 text-[0.6875rem] font-semibold text-muted">
        Not checked
      </span>
    );
  }
  const copy = VERDICT_COPY[verdict] ?? { label: verdict, className: "bg-canvas text-muted" };
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold ${copy.className}`}
    >
      {copy.label}
    </span>
  );
}

export function VerificationChecklist({
  proposalId,
  reviewer = false,
  onChanged,
}: {
  proposalId: string;
  reviewer?: boolean;
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<VerificationItem[] | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [askingOn, setAskingOn] = useState<string | null>(null);
  const [question, setQuestion] = useState("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch(`/api/verifications?proposalId=${encodeURIComponent(proposalId)}`);
      const data = (await res.json()) as
        | { ok: true; items: VerificationItem[] }
        | { ok: false; message: string };
      if (!alive) return;
      if (data.ok) {
        setItems(data.items);
        setError("");
      } else {
        setError(data.message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [proposalId]);

  /** Re-reads the checklist after a ruling, so the badges come from the database. */
  const load = async () => {
    const res = await fetch(`/api/verifications?proposalId=${encodeURIComponent(proposalId)}`);
    const data = (await res.json()) as
      | { ok: true; items: VerificationItem[] }
      | { ok: false; message: string };
    if (data.ok) {
      setItems(data.items);
      setError("");
    } else {
      setError(data.message);
    }
  };

  const rule = async (submissionId: string, verdict: string, remark: string) => {
    setError("");
    setBusyId(submissionId);
    try {
      const res = await fetch("/api/verifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId, verdict, remark }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.message ?? "We could not record that ruling.");
        return;
      }
      setAskingOn(null);
      setQuestion("");
      await load();
      onChanged?.();
    } catch {
      setError("We could not record that ruling.");
    } finally {
      setBusyId(null);
    }
  };

  if (error && !items) {
    return (
      <p role="alert" className="text-[0.8125rem] font-medium text-[#a5442c]">
        {error}
      </p>
    );
  }

  if (!items) {
    return (
      <p role="status" className="text-[0.8125rem] text-body">
        Loading the checklist…
      </p>
    );
  }

  if (items.length === 0) {
    return <p className="text-[0.8125rem] text-body">Nothing has been submitted yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((it) => {
        const busy = busyId === it.submissionId;
        const asking = askingOn === it.submissionId;
        return (
          <div key={it.submissionId} className="rounded-xl border border-line/70 bg-canvas/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[0.875rem] font-medium text-ink">{it.label}</p>
                <p className="mt-0.5 truncate text-[0.75rem] text-muted">
                  {it.submissionKind === "file"
                    ? it.hasDocument
                      ? it.originalName ?? "file"
                      : "No file attached"
                    : it.linkUrl ?? "No link given"}
                </p>
              </div>
              <VerdictBadge verdict={it.verdict} />
            </div>

            {it.verdict && it.remark ? (
              <p className="mt-2 text-[0.8125rem] leading-relaxed text-body">{it.remark}</p>
            ) : null}

            {it.verdict ? (
              <p className="mt-1 text-[0.75rem] text-muted">
                {it.verifiedBy ? `${it.verifiedBy} · ` : ""}
                {formatDate(it.verifiedAt)}
                {it.reviewerCount && it.reviewerCount > 1 ? ` · ${it.reviewerCount} rulings` : ""}
              </p>
            ) : null}

            {it.myVerdict ? (
              <p className="mt-1 text-[0.75rem] text-muted">You ruled: {it.myVerdict}</p>
            ) : null}

            {reviewer ? (
              <div className="mt-3 border-t border-line/70 pt-3">
                {asking ? (
                  <div className="flex flex-col gap-3">
                    <TextArea
                      id={`query-${it.submissionId}`}
                      label="What do you need from the unit?"
                      value={question}
                      maxLength={1000}
                      onChange={(e) => setQuestion(e.target.value)}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="brass"
                        disabled={busy || question.trim().length < 2}
                        onClick={() => rule(it.submissionId, "queried", question.trim())}
                      >
                        {busy ? "Sending…" : "Send query"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          setAskingOn(null);
                          setQuestion("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={it.myVerdict === "verified" ? "primary" : "paper"}
                      disabled={busy}
                      onClick={() => rule(it.submissionId, "verified", it.myRemark ?? "")}
                    >
                      Verified
                    </Button>
                    <Button
                      size="sm"
                      variant="paper"
                      disabled={busy}
                      onClick={() => {
                        setAskingOn(it.submissionId);
                        setQuestion(it.myRemark ?? "");
                      }}
                    >
                      {it.myVerdict === "queried" ? "Edit query" : "Ask a question"}
                    </Button>
                    <Button
                      size="sm"
                      variant="paper"
                      disabled={busy}
                      onClick={() => rule(it.submissionId, "rejected", it.myRemark ?? "")}
                    >
                      Reject
                    </Button>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        );
      })}

      {error ? (
        <p role="alert" className="text-[0.8125rem] font-medium text-[#a5442c]">
          {error}
        </p>
      ) : null}
    </div>
  );
}