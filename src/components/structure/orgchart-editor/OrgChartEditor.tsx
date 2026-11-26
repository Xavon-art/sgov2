// @ts-nocheck
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, ButtonLink } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import {
  fetchStructure,
  saveDraft,
  submitDraft,
  fetchHolderPhoto,
  structureError,
  type StructureDocument,
} from "@/lib/structure";
import {
  OrgChartCanvas,
} from "@/components/structure/orgchart-editor/OrgChartCanvas";
import { SeatInspector } from "@/components/structure/orgchart-editor/SeatInspector";
import {
  ROOT_ID,
  POS_PREFIX,
  emptyOrgDocument,
  buildHolder,
  newPosition,
  positionChildrenCount,
  removePositionFromDoc,
  addPositionToDoc,
  updatePositionByKey,
  flattenPositions,
  toOrgData,
} from "@/components/structure/orgchart-editor/orgchart-adapter";

type OrgChartEditorProps = {
  unitId: string;
  unitName: string;
  canEdit: boolean;
  returnTo?: string;
};

function autoTermDates(): { startsOn: string; endsOn: string } {
  const now = new Date();
  const year = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  const start = new Date(year, 7, 1);
  const end = new Date(year + 1, 6, 31);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { startsOn: fmt(start), endsOn: fmt(end) };
}

function firstPositionKey(doc: StructureDocument): string | null {
  const positions = flattenPositions(doc);
  return positions.length ? positions[0].key : null;
}

function positionByKey(doc: StructureDocument, key: string) {
  return flattenPositions(doc).find((p) => p.key === key);
}

export function OrgChartEditor({ unitId, unitName, canEdit, returnTo }: OrgChartEditorProps) {
  const [searchParams] = useSearchParams();
  const backTo = returnTo ?? searchParams.get("returnTo") ?? "/";
  const [doc, setDoc] = useState<StructureDocument>(emptyOrgDocument(unitName));
  const [termDates, setTermDates] = useState(autoTermDates());
  const [structureId, setStructureId] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");
  const mountedRef = useRef(false);

  const locked =
    !canEdit ||
    draftStatus === "pending" ||
    (draftStatus === "approved" && !!structureId);

  const selectedPosition = useMemo(() => positionByKey(doc, selectedKey || ""), [
    doc,
    selectedKey,
  ]);

  const selectedOrgNode = useMemo(() => {
    if (!selectedKey) return null;
    const roots = toOrgData(doc, unitName, photoUrls);
    const stack = [...roots];
    while (stack.length) {
      const node = stack.pop();
      if (!node) continue;
      if (node.id === `${POS_PREFIX}${selectedKey}`) return node;
      stack.push(...(node.children || []));
    }
    return null;
  }, [doc, unitName, selectedKey, photoUrls]);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    const key = firstPositionKey(doc);
    if (key && selectedKey !== key && !selectedKey) setSelectedKey(key);
    if (selectedKey && !positionByKey(doc, selectedKey)) setSelectedKey(null);
  }, [doc, selectedKey, setSelectedKey]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setError("");
      const res = await fetchStructure(unitId);
      if (cancelled) return;
      if (!res.ok) {
        setError(structureError(res) || "We could not load this structure.");
        return;
      }
      const draft = res.draft ?? null;
      const approved = res.approved ?? null;
      const dates = autoTermDates();

      if (draft) {
        setDoc(draft.document);
        setStructureId(draft.id);
        setUpdatedAt(draft.updatedAt);
        setDraftStatus(draft.status);
        setTermDates({
          startsOn: draft.startsOn || dates.startsOn,
          endsOn: draft.endsOn || dates.endsOn,
        });
      } else if (approved) {
        setDoc(JSON.parse(JSON.stringify(approved.document)));
        setStructureId(null);
        setUpdatedAt(approved.updatedAt);
        setDraftStatus("draft");
        setTermDates({
          startsOn: approved.startsOn || dates.startsOn,
          endsOn: approved.endsOn || dates.endsOn,
        });
      } else {
        setDoc(emptyOrgDocument(unitName));
        setStructureId(null);
        setUpdatedAt(null);
        setDraftStatus(null);
        setTermDates(dates);
      }
      setSelectedKey(firstPositionKey(doc));
      await hydratePhotos(doc);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [unitId, unitName]);

  async function hydratePhotos(currentDoc: StructureDocument) {
    const holders = flattenPositions(currentDoc).flatMap((p) => [
      p.holder,
      ...(p.holders || []),
    ].filter(Boolean));
    for (const holder of holders) {
      if (holder.hasPhoto && !holder.photo && holder.email) {
        try {
          const url = await fetchHolderPhoto(unitId, holder.email);
          if (url) {
            const key = holder.email.trim().toLowerCase();
            setPhotoUrls((prev) => ({ ...prev, [key]: url }));
          }
        } catch {
          // Stored photos are optional; initials are the fallback.
        }
      }
    }
  }

  const validateDoc = useCallback((currentDoc: StructureDocument): string[] => {
    const problems: string[] = [];
    for (const position of flattenPositions(currentDoc)) {
      if (!position.title || !position.title.trim()) {
        problems.push(`Position ${position.key} needs a title.`);
      }
      const holder = position.holder || (position.holders?.[0] ?? null);
      if (!holder) continue;
      const name = (holder.fullName || "").trim();
      if (name && name !== "Vacant") {
        if (!holder.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(holder.email)) {
          problems.push(`"${name}" needs a valid email address.`);
        }
        if (!holder.course) problems.push(`"${name}" needs a course.`);
        if (!holder.yearLevel) problems.push(`"${name}" needs a year level.`);
        if (!holder.section) problems.push(`"${name}" needs a section.`);
      }
    }
    return problems;
  }, []);

  const handleNodeUpdate = useCallback(
    (updates: Partial<{ title: string; name: string; course: string | null; yearLevel: string | null; section: string | null; email: string | null; photo: string | null }>) => {
      if (!selectedKey) return;
      setDoc((prev) =>
        updatePositionByKey(prev, selectedKey, (position) => {
          const existing = position.holder || (position.holders?.[0] ?? null);
          const holder = buildHolder({
            name: updates.name ?? (existing?.fullName ?? ""),
            email: updates.email ?? (existing?.email ?? ""),
            photo: updates.photo ?? null,
          });
          if (updates.course !== undefined) holder.course = updates.course;
          if (updates.yearLevel !== undefined) holder.yearLevel = updates.yearLevel;
          if (updates.section !== undefined) holder.section = updates.section;
          const filled =
            holder.fullName &&
            holder.fullName !== "Vacant" &&
            holder.fullName.trim().length > 0;
          return {
            ...position,
            title: updates.title ?? position.title,
            holder: filled ? holder : null,
            holders: filled ? [holder] : [],
          };
        }),
      );
      setError("");
    },
    [selectedKey],
  );

  const handleAddSeat = useCallback(
    (parentKey: string | null) => {
      setDoc((prev) => {
        const result = addPositionToDoc(prev, parentKey, unitName);
        setSelectedKey(`pos:${result.position.key}`);
        return result.doc;
      });
      setError("");
    },
    [unitName],
  );

  const handleRemoveSeat = useCallback(() => {
    if (!selectedKey) return;
    setDoc((prev) => removePositionFromDoc(prev, selectedKey));
    setSelectedKey(null);
    setError("");
  }, [selectedKey]);

  const handleSave = useCallback(async () => {
    const problems = validateDoc(doc);
    if (problems.length) {
      setError(problems.join(" "));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await saveDraft({
        unitId,
        templateKey: undefined,
        termLabel: "Current term",
        startsOn: termDates.startsOn,
        endsOn: termDates.endsOn,
        document: doc,
        note: "Org chart updated",
        expectedUpdatedAt: updatedAt ?? undefined,
      });
      if (!res.ok) {
        setError(structureError(res) || "Save was refused.");
        setSaving(false);
        return;
      }
      setStructureId(res.structureId ?? structureId);
      setUpdatedAt(res.updatedAt ?? updatedAt);
      setDraftStatus(res.status ?? "draft");
      setStatusMessage("Saved.");
    } catch {
      setError("We could not save that.");
    } finally {
      setSaving(false);
    }
  }, [doc, unitId, termDates, updatedAt, structureId]);

  const handleSubmit = useCallback(async () => {
    if (!structureId) {
      await handleSave();
      if (!structureId) return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await submitDraft(structureId, "Submitted for review.");
      if (!res.ok) {
        setError(structureError(res) || "Submit was refused.");
        setSaving(false);
        return;
      }
      const after = await fetchStructure(unitId);
      if (!after.ok) {
        setError(structureError(after) || "We could not reload after submit.");
        setSaving(false);
        return;
      }
      setDraftStatus(after.draft?.status ?? res.status);
      setStatusMessage(
        res.autoApproved ? "Published." : "Sent for review.",
      );
    } catch {
      setError("We could not submit that.");
    } finally {
      setSaving(false);
    }
  }, [structureId, unitId, handleSave]);

  const handleBack = () => {
    window.location.href = backTo;
  };

  const isVacant = (holder: any) =>
    !holder || (holder.fullName && holder.fullName.trim() === "Vacant");

  return (
    <div className="flex flex-col h-full">
      <header className="border-b border-line bg-canvas/70 backdrop-blur-xl px-5 py-4 sm:px-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="eyebrow text-[0.8125rem] text-ink-soft">Org chart editor</p>
          <h1 className="text-[1.5rem] leading-tight text-ink-deep">{unitName}</h1>
          {draftStatus && (
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-body">
              {draftStatus === "submitted"
                ? "Submitted for review."
                : draftStatus === "approved"
                ? "Published."
                : "Draft."}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {statusMessage ? (
            <p className="text-[0.8125rem] font-medium text-ink">{statusMessage}</p>
          ) : null}
          {error ? (
            <p className="text-[0.8125rem] font-medium text-[#a5442c]">{error}</p>
          ) : null}
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={handleSave}
              disabled={saving || locked || !canEdit}
            >
              {saving ? "Saving…" : "Save draft"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSubmit}
              disabled={saving || locked || !canEdit || !structureId}
            >
              {saving ? "Submitting…" : "Save and submit"}
            </Button>
            <ButtonLink
              variant="ghost"
              size="sm"
              href={backTo}
            >
              Back
            </ButtonLink>
          </div>
        </div>
      </header>
      <main className="flex-1 flex overflow-hidden">
        <div
          className="flex-1 min-w-0 orgchart-wrap"
          style={{ opacity: locked ? 0.6 : 1 }}
        >
          <OrgChartCanvas
            doc={doc}
            unitName={unitName}
            canEdit={canEdit && !locked}
            selectedKey={selectedKey ? `${POS_PREFIX}${selectedKey}` : null}
            onSelect={setSelectedKey}
            onChange={(nextDoc) => {
              setDoc(nextDoc);
              setError("");
            }}
            photoUrls={photoUrls}
          />
        </div>
        <aside className="w-full md:w-[420px] border-l border-line bg-paper/50 flex flex-col">
          <SeatInspector
            node={selectedOrgNode}
            canEdit={canEdit && !locked && !!selectedKey}
            onUpdate={handleNodeUpdate}
            onAddChild={() => handleAddSeat(selectedKey ? selectedKey : null)}
            onAddSibling={() => {
              const pos = positionByKey(doc, selectedKey || "");
              handleAddSeat(pos ? pos.parentKey : null);
            }}
            onRemove={handleRemoveSeat}
            photoUploading={saving}
          />
        </aside>
      </main>
    </div>
  );
}
