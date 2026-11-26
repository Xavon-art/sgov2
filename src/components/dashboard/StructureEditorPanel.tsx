"use client";

import { useEffect, useState } from "react";
import { ChartViewer } from "@/components/structure/ChartViewer";
import { ReviewQueue } from "@/components/structure/ReviewQueue";
import { ButtonLink } from "@/components/ui/Button";
import { structureFormat, type StructureReadPayload, type StructureSummary } from "@/lib/structure";

/**
 * The structure panel embedded in Manage.
 *
 * It no longer embeds the legacy form builder. It shows a read-only chart
 * preview of the current draft/published structure and links to the dedicated
 * OrgChart editor page for editing.
 */
export function StructureEditorPanel({
  showQueue = false,
}: {
  showQueue?: boolean;
}) {
  const [data, setData] = useState<StructureReadPayload | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const requestedUnitId = new URLSearchParams(window.location.search).get("unitId");
    void (async () => {
      try {
        const url = requestedUnitId
          ? `/api/structures/${encodeURIComponent(requestedUnitId)}`
          : "/api/structures?view=own";
        const res = await fetch(url);
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

  if (message || !data?.ok || !data.unit || !data.capability) {
    return (
      <div className="rounded-xl border border-line bg-paper px-4 py-3">
        <p className="text-[0.875rem] font-medium text-ink">We could not load your structure</p>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">
          {message ?? "Your account is not seated in a council yet. Ask your USG officer to check your seat."}
        </p>
      </div>
    );
  }

  const { canRead, canEdit, isReviewer } = data.capability;
  const unit = data.unit;
  const managePath = unit.isRoot || unit.unitType === "usg"
    ? "/usg/manage?tab=structure"
    : "/lsg/manage?tab=structure";

  if (!canRead) {
    return (
      <div className="rounded-xl border border-line bg-paper px-4 py-3">
        <p className="text-[0.875rem] font-medium text-ink">Read-only structure</p>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">
          You do not have access to this council&apos;s structure. Access is decided by the database,
          not by this page.
        </p>
      </div>
    );
  }

  const current: StructureSummary | null = data.draft ?? data.approved ?? null;
  const doc = current?.document ?? null;

  return (
    <div data-tour="manage-structure" className="flex flex-col gap-6">
      {!canEdit ? (
        <p className="text-[0.8125rem] leading-relaxed text-muted">
          You have read-only access to this structure. Ask this council&apos;s officer to change it.
        </p>
      ) : null}

      {current ? (
        <>
          <p className="text-[0.8125rem] text-muted">
              {current.status === "draft"
              ? "Editing your saved draft."
              : current.status === "pending"
                ? "Submitted for review. Edits are locked until a reviewer decides."
                : current.status === "approved"
                ? "Editing an approved structure creates a new draft revision."
                : `Current revision: ${current.status}.`}
          </p>

          {doc && (
            <div className="mt-4 rounded-2xl border border-line bg-paper/80 p-5 shadow-lift sm:p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
                <div>
                  <p className="eyebrow">Published officer chart</p>
                  <p className="mt-1 text-[0.875rem] text-body">
                    {current.termLabel} &middot; revision {current.revision}
                  </p>
                </div>
                <ButtonLink
                  href={`/structure/editor?unitId=${encodeURIComponent(unit.id)}&returnTo=${encodeURIComponent(managePath)}`}
                  variant="brass"
                  size="sm"
                >
                  Open org chart editor
                </ButtonLink>
              </div>
              <ChartViewer
                doc={doc}
                title={`${unit.name} officers`}
                subtitle={`${current.termLabel} · revision ${current.revision}`}
                filename={`${unit.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-officers`}
                maxHeight={560}
              />
            </div>
          )}

          {!canEdit && (
            <p className="mt-3 text-[0.8125rem] text-muted">
              You have read-only access to this structure. Ask this council&apos;s officer to change it.
            </p>
          )}
        </>
      ) : (
        <div className="rounded-xl border border-line bg-paper px-4 py-3 text-center">
          <p className="text-[0.875rem] font-medium text-ink">No structure yet</p>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">
            Create your council&apos;s org chart in the editor.
          </p>
          <ButtonLink
            href={`/structure/editor?unitId=${encodeURIComponent(unit.id)}&returnTo=${encodeURIComponent(managePath)}`}
            variant="brass"
            size="sm"
          >
            Open org chart editor
          </ButtonLink>
        </div>
      )}

      {showQueue && isReviewer ? (
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
