"use client";

import { useState } from "react";
import type { ComplianceReport, CompItemResult } from "@/lib/compliance/types";
import { Button } from "@/components/ui/Button";

/**
 * The requirement check panel: one button that runs the deterministic engine over
 * a submitted version and renders the fixed-schema report.
 *
 * The wording on screen is deliberately modest — "a reading aid, not a decision" —
 * because every signal in the report is a suggestion the reviewer still rules on.
 * Nothing here writes to the database; it is a read-only analysis the caller can
 * re-run as often as they like (the route rate-limits abuse, not legitimate use).
 */

const STATUS_COPY: Record<string, { label: string; className: string }> = {
  ok: { label: "Looks complete", className: "bg-[#e6f0e6] text-[#2f5d38]" },
  suspect: { label: "Needs a look", className: "bg-brass-soft/50 text-brass-deep" },
  unreadable: { label: "Unreadable", className: "bg-[#f7e3dd] text-[#a5442c]" },
  missing: { label: "Not submitted", className: "bg-canvas text-muted" },
};

const FACT_KIND_COPY: Record<string, string> = {
  date: "Date",
  amount: "Amount",
  email: "Email",
  reference: "Ref",
};

const SIGNAL_LEVEL_CLASS: Record<string, string> = {
  info: "text-muted",
  warn: "text-brass-deep",
  block: "text-[#a5442c]",
};

function summaryLine(report: ComplianceReport): string {
  const parts: string[] = [];
  const s = report.summary;
  if (s.ok > 0) parts.push(`${s.ok} clear`);
  if (s.suspect > 0) parts.push(`${s.suspect} to look at`);
  if (s.unreadable > 0) parts.push(`${s.unreadable} unreadable`);
  if (s.missing > 0) parts.push(`${s.missing} not submitted`);
  if (parts.length === 0) parts.push("nothing submitted yet");
  return `${report.summary.items} items · ${parts.join(" · ")}`;
}

function ItemRow({ it }: { it: CompItemResult }) {
  const status = STATUS_COPY[it.status] ?? STATUS_COPY.missing;
  const diverged =
    it.match.bestItemId && it.match.bestItemId !== it.itemId && it.match.bestItemLabel
      ? it.match.bestItemLabel
      : null;

  return (
    <div className="rounded-lg border border-line/70 bg-paper/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[0.8125rem] font-medium text-ink">{it.label}</p>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold ${status.className}`}>
          {status.label}
        </span>
      </div>

      {it.recommendation ? (
        <p className="mt-1.5 text-[0.75rem] leading-relaxed text-body">{it.recommendation}</p>
      ) : null}

      {diverged ? (
        <p className="mt-1 text-[0.75rem] font-medium text-brass-deep">
          Content resembles “{diverged}” more than this item — confirm it is filed under the right
          requirement.
        </p>
      ) : null}

      {it.signals.length > 0 ? (
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {it.signals.map((sig) => (
            <li
              key={sig.code}
              className={`text-[0.75rem] leading-snug ${SIGNAL_LEVEL_CLASS[sig.level] ?? "text-muted"}`}
            >
              {sig.label}
            </li>
          ))}
        </ul>
      ) : null}

      {it.facts.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {it.facts.slice(0, 5).map((f) => (
            <span
              key={`${f.kind}-${f.value}`}
              className="rounded-full bg-canvas px-2 py-0.5 text-[0.6875rem] text-ink-soft"
            >
              {FACT_KIND_COPY[f.kind] ?? f.kind}: {f.value}
            </span>
          ))}
        </div>
      ) : null}

      {it.extracted && it.extracted.preview ? (
        <p className="mt-2 line-clamp-2 text-[0.75rem] italic leading-relaxed text-muted">
          {it.extracted.preview}
        </p>
      ) : null}
    </div>
  );
}

export function RequirementCheckPanel({
  proposalId,
  versionId,
}: {
  proposalId: string;
  versionId: string;
}) {
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    setError("");
    setBusy(true);
    try {
      const res = await fetch(`/api/compliance/${encodeURIComponent(versionId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId }),
      });
      const data = (await res.json()) as
        | { ok: true; report: ComplianceReport }
        | { ok: false; message: string };
      if (!data.ok) {
        setError(data.message || "We could not run the requirement check.");
        return;
      }
      if (!res.ok) {
        setError("We could not run the requirement check.");
        return;
      }
      setReport(data.report);
    } catch {
      setError("We could not run the requirement check.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-line/70 bg-canvas/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.875rem] font-semibold text-ink">Requirement check</p>
          <p className="mt-0.5 text-[0.75rem] leading-relaxed text-muted">
            Reads the submitted files and compares them with these requirement items — what is
            present, what is missing, and what looks inconsistent. An aid for your ruling, not the
            ruling itself.
          </p>
        </div>
        <Button size="sm" variant="paper" disabled={busy} onClick={run}>
          {busy ? "Checking…" : report ? "Run again" : "Run requirement check"}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-[0.8125rem] font-medium text-[#a5442c]">
          {error}
        </p>
      ) : null}

      {report ? (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-[0.75rem] text-muted">
            {summaryLine(report)} · {report.durationMs}ms
          </p>
          {report.items.map((it) => (
            <ItemRow key={it.itemId} it={it} />
          ))}
          <p className="text-[0.75rem] italic leading-relaxed text-muted">{report.note}</p>
        </div>
      ) : null}
    </div>
  );
}
