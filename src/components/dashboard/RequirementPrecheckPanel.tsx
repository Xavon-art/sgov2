"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  extractForPrecheck,
  runPrecheck,
  type PrecheckFilePayload,
} from "@/lib/compliance/precheck-client";
import type { PrecheckItem, PrecheckRequest } from "@/lib/compliance/precheck-request";
import type { ProposalsContext, PreflightReport } from "@/lib/compliance/types";

type PanelItem = {
  itemId: string;
  label: string;
  itemKind: "file" | "link";
  file: File | null;
  linkUrl: string;
};

type Props = {
  proposalId?: string;
  programId?: string;
  context: ProposalsContext;
  items: PanelItem[];
  onBlockedChange?: (blocked: boolean) => void;
  disabled?: boolean;
};

const BLOCKING = new Set(["missing", "unreadable", "suspect"]);

export function RequirementPrecheckPanel(props: Props) {
  const signature = props.items
    .map((item) =>
      [
        item.itemId,
        item.itemKind,
        item.linkUrl,
        item.file?.name ?? "",
        item.file?.size ?? "",
        item.file?.lastModified ?? "",
      ].join(":"),
    )
    .join("|");

  return <RequirementPrecheckPanelInner key={signature} {...props} />;
}

function RequirementPrecheckPanelInner({
  proposalId,
  programId,
  context,
  items,
  onBlockedChange,
  disabled,
}: Props) {
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [advice, setAdvice] = useState<string | null>(null);
  const [fixes, setFixes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const blockedCallback = useRef(onBlockedChange);

  useEffect(() => {
    blockedCallback.current = onBlockedChange;
  });

  useEffect(() => {
    return () => blockedCallback.current?.(false);
  }, []);

  const blocked = !!report && report.items.some((item) => BLOCKING.has(item.status));

  const check = async () => {
    setBusy(true);
    setError(null);
    setConfirmed(false);
    try {
      if (!context.title.trim()) {
        throw new Error("Add a title before checking the files.");
      }

      const requestItems: PrecheckItem[] = [];
      for (const item of items) {
        if (item.itemKind === "link") {
          if (item.linkUrl.trim()) {
            requestItems.push({
              itemId: item.itemId,
              itemKind: "link",
              linkUrl: item.linkUrl.trim(),
            });
          }
          continue;
        }

        if (!item.file) {
          requestItems.push({ itemId: item.itemId, itemKind: "file" });
          continue;
        }

        const payload: PrecheckFilePayload = await extractForPrecheck(item.file);
        requestItems.push({
          itemId: item.itemId,
          itemKind: "file",
          ...payload,
        });
      }

      if (requestItems.length === 0) {
        throw new Error("Add a file or a link before checking.");
      }

      const body: PrecheckRequest = {
        ...(proposalId ? { proposalId } : {}),
        ...(programId ? { programId } : {}),
        context: {
          title: context.title,
          ...(context.eventDate ? { eventDate: context.eventDate } : {}),
          ...(context.venue ? { venue: context.venue } : {}),
          ...(context.unitName ? { unitName: context.unitName } : {}),
          ...(context.programName ? { programName: context.programName } : {}),
        },
        items: requestItems,
      };

      const response = await runPrecheck(body);
      if (!response.ok) throw new Error(response.message);

      setReport(response.report);
      setAdvice(response.advice);
      setFixes(response.fixes);
      const nextBlocked = response.report.items.some((item) =>
        BLOCKING.has(item.status),
      );
      onBlockedChange?.(nextBlocked);
      if (!nextBlocked) setConfirmed(true);
    } catch (checkError) {
      setError(
        checkError instanceof Error && checkError.message
          ? checkError.message
          : "The requirement check could not be completed.",
      );
      setReport(null);
      onBlockedChange?.(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-line bg-canvas/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">Pre-check files</div>
          <p className="text-xs text-muted">
            Reviews your files and suggests fixes before you submit. Nothing is stored here.
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={disabled || busy} onClick={() => void check()}>
          {busy ? "Checking..." : "Check files"}
        </Button>
      </div>

      {error && (
        <p className="mt-2 rounded-lg border border-[#d9a99c] bg-[#a5442c]/[0.06] px-3 py-2 text-xs text-[#a5442c]">
          {error}
        </p>
      )}

      {report && (
        <div className="mt-3 grid gap-2">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-line bg-paper px-2 py-1">
              {report.summary.items} items
            </span>
            <span className="rounded-full border border-[#8bb39a] bg-[#8bb39a]/10 px-2 py-1 text-[#3d6b4d]">
              {report.summary.ok} ready
            </span>
            <span className="rounded-full border border-[#d8c18f] bg-[#d8c18f]/10 px-2 py-1 text-[#7d6428]">
              {report.summary.suspect + report.summary.missing + report.summary.unreadable} need attention
            </span>
          </div>

          {report.items.map((item) => (
            <div key={item.itemId} className="rounded-lg border border-line bg-paper p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">{item.label}</div>
                <span className="text-xs uppercase text-muted">{item.status}</span>
              </div>
              <p className="mt-1 text-xs text-muted">{item.recommendation}</p>
              {item.itemKind === "link" && (
                <p className="mt-1 text-xs text-muted">Not inspected — open the link to verify.</p>
              )}
            </div>
          ))}

          {advice && (
            <div className="rounded-lg border border-line bg-paper p-3">
              <div className="text-xs font-medium">Advice</div>
              <p className="mt-1 text-sm text-muted">{advice}</p>
              {fixes.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-xs text-muted">
                  {fixes.map((fix, index) => (
                    <li key={`${index}-${fix}`}>{fix}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {blocked && !confirmed && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#d8c18f] bg-[#d8c18f]/10 p-3">
              <p className="text-xs text-[#7d6428]">
                Some files need attention. Send anyway only after reviewing them.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setConfirmed(true);
                  onBlockedChange?.(false);
                }}
              >
                Send anyway
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
