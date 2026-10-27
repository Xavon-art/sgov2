"use client";

import { useEffect, useState } from "react";
import { OrgChartDragDrop, type OrgChartInitial } from "@/components/structure/OrgChartDragDrop";
import { StructureWorkspace } from "@/components/structure/StructureWorkspace";
import { ReviewQueue } from "@/components/structure/ReviewQueue";
import type { StructureReadPayload, StructureSummary } from "@/lib/structure";

/**
 * The structure editor, embedded in Manage.
 *
 * The first version embedded `/usg/structure` in an iframe. That looked right
 * and was wrong twice over: the iframe is a fresh browsing context, so
 * `SessionGuard` saw no boot flag and tore the session down, and the editor
 * inside started from a blank chart rather than the saved one. This component
 * reads the caller's own unit from `/api/structures?view=own` and hands the
 * saved document to the editor as its initial state, so "edit" actually edits.
 *
 * `variant` picks the editor: USG gets the triangle drag-and-drop chart the
 * mission asks for, an LSG gets the fuller committee workspace.
 */
export function StructureEditorPanel({
  variant,
  showQueue = false,
}: {
  variant: "chart" | "workspace";
  showQueue?: boolean;
}) {
  const [data, setData] = useState<StructureReadPayload | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/structures?view=own");
        const payload = (await res.json()) as StructureReadPayload & { message?: string };
        if (cancelled) return;
        if (!res.ok || !payload.ok) {
          setMessage(payload.message ?? "We could not load your structure.");
          return;
        }
        setData(payload);
      } catch {
        if (!cancelled) setMessage("We could not reach the server. Check your connection.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <p className="text-[0.875rem] text-muted">Loading your structure…</p>;
  }

  if (message || !data?.ok || !data.unit || !data.capability?.canRead) {
    return (
      <div className="rounded-xl border border-line bg-paper px-4 py-3">
        <p className="text-[0.875rem] font-medium text-ink">We could not load your structure</p>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">
          {message ?? "Your account is not seated in a council yet. Ask your USG officer to check your seat."}
        </p>
      </div>
    );
  }

  const current: StructureSummary | null = data.draft ?? data.approved ?? null;
  const initial = toInitial(current);

  return (
    <div className="flex flex-col gap-6">
      {current ? (
        <p className="text-[0.8125rem] text-muted">
          {current.status === "draft"
            ? "Editing your saved draft."
            : current.status === "approved"
              ? "Editing an approved structure creates a new draft revision."
              : `Current revision: ${current.status}.`}
        </p>
      ) : null}

      {variant === "chart" ? (
        <OrgChartDragDrop
          unitId={data.unit.id}
          unitName={data.unit.name}
          capability={data.capability}
          initial={initial}
        />
      ) : (
        <StructureWorkspace
          unitId={data.unit.id}
          unitName={data.unit.name}
          capability={data.capability}
        />
      )}

      {showQueue && data.capability.isReviewer ? (
        <div className="border-t border-line pt-8">
          <p className="eyebrow">Review queue</p>
          <h3 className="mt-1 text-[1.25rem] leading-tight">Council structures</h3>
          <p className="mt-2 max-w-2xl text-[0.875rem] leading-relaxed text-body">
            Approve a structure and it is published; send it back and the author keeps working on it.
          </p>
          <div className="mt-5">
            <ReviewQueue />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The triangle editor speaks in flat nodes, not committees. A saved structure
 * keeps its unit committee first; the positions in that committee are the
 * officers drawn in the triangle.
 */
function toInitial(summary: StructureSummary | null): OrgChartInitial | undefined {
  if (!summary) return undefined;
  const committee =
    summary.document.committees.find((entry) => entry.isUnit) ?? summary.document.committees[0];
  if (!committee) return undefined;

  return {
    nodes: committee.positions.map((position) => ({
      title: position.title ?? "",
      firstName: position.holder?.firstName ?? "",
      lastName: position.holder?.lastName ?? "",
      email: position.holder?.email ?? "",
      // Photos are write-only in the database; they are re-attached on the next
      // save rather than round-tripped through the browser.
      photo: null,
    })),
    termLabel: summary.termLabel,
    startsOn: summary.startsOn,
    endsOn: summary.endsOn,
    structureId: summary.id,
  };
}
