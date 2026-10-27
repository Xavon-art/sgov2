"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { SwapText } from "@/components/fx/SwapText";
import { emptyDocument } from "@/components/structure/document";
import { saveDraft, submitDraft, type StructureCapability } from "@/lib/structure";

type Node = {
  id: string;
  title: string;
  firstName: string;
  lastName: string;
  email: string;
  photo: string | null;
};

function newId(): string {
  return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function emptyNode(): Node {
  return { id: newId(), title: "", firstName: "", lastName: "", email: "", photo: null };
}

// Distribute n nodes into triangle rows: 1, 2, 3, ...
function rowsFor(n: number): number[] {
  const rows: number[] = [];
  let remaining = n;
  let size = 1;
  while (remaining > 0) {
    const take = Math.min(size, remaining);
    rows.push(take);
    remaining -= take;
    size += 1;
  }
  return rows;
}

export type OrgChartInitial = {
  nodes: Array<{
    title: string;
    firstName: string;
    lastName: string;
    email: string;
    photo: string | null;
  }>;
  termLabel?: string;
  startsOn?: string;
  endsOn?: string;
  structureId?: string | null;
};

export function OrgChartDragDrop({
  unitId,
  unitName,
  capability,
  initial,
}: {
  unitId: string;
  unitName: string;
  capability: StructureCapability;
  initial?: OrgChartInitial;
}) {
  const [nodes, setNodes] = useState<Node[]>(
    initial && initial.nodes.length > 0
      ? initial.nodes.map((node) => ({ id: newId(), ...node }))
      : [emptyNode()],
  );
  const [termLabel, setTermLabel] = useState(initial?.termLabel ?? "");
  const [startsOn, setStartsOn] = useState(initial?.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(initial?.endsOn ?? "");
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [structureId, setStructureId] = useState<string | null>(initial?.structureId ?? null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const canEdit = capability.canEdit;

  function handleDragStart(i: number) {
    setDragIdx(i);
  }
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }
  function handleDrop(i: number) {
    if (dragIdx === null || dragIdx === i) return;
    setNodes((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(i, 0, moved);
      return next;
    });
    setDragIdx(null);
  }

  function updateNode(i: number, patch: Partial<Node>) {
    setNodes((prev) => prev.map((n, idx) => (idx === i ? { ...n, ...patch } : n)));
  }
  function removeNode(i: number) {
    setNodes((prev) => prev.filter((_, idx) => idx !== i));
  }
  function addNode() {
    setNodes((prev) => [...prev, emptyNode()]);
  }

  function handlePhoto(i: number, file: File | null) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError("Photo must be under 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      updateNode(i, { photo: reader.result as string });
    };
    reader.readAsDataURL(file);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setNote(null);
    try {
      const doc = {
        committees: [
          {
            key: `cmt-${Date.now().toString(36)}`,
            name: unitName,
            isUnit: true,
            positions: nodes.map((n, i) => ({
              key: `pos-${n.id}`,
              title: n.title.trim() || `Position ${i + 1}`,
              holder: n.firstName.trim() || n.lastName.trim() || n.email.trim()
                ? {
                    email: n.email.trim(),
                    firstName: n.firstName.trim(),
                    lastName: n.lastName.trim(),
                    photo: n.photo ?? undefined,
                  }
                : null,
            })),
          },
        ],
      };
      const res = await saveDraft({
        unitId,
        templateKey: undefined,
        termLabel: termLabel.trim(),
        startsOn: startsOn || new Date().toISOString().slice(0, 10),
        endsOn: endsOn || new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
        document: doc,
        note: "Drag-and-drop org chart",
      });
      if (res.ok) {
        if (res.structureId) setStructureId(res.structureId);
        setNote("Saved as draft. Submit for review when ready.");
      } else {
        setError(typeof res.message === "string" ? res.message : "We could not save.");
      }
    } catch {
      setError("We could not reach the server. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  async function submit() {
    if (!structureId) {
      setError("Save the draft first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setNote(null);
    try {
      const res = await submitDraft(structureId, "Drag-and-drop org chart");
      if (res.ok) {
        setNote("Submitted for review.");
      } else {
        setError(typeof res.message === "string" ? res.message : "We could not submit.");
      }
    } catch {
      setError("We could not reach the server. Check your connection.");
    } finally {
      setSubmitting(false);
    }
  }

  const rows = rowsFor(nodes.length);
  const rowStarts = rows.reduce<number[]>((acc, r, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + rows[i - 1]);
    return acc;
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1.5 block text-[0.75rem] font-semibold tracking-[0.08em] text-ink-soft uppercase">Term label</span>
          <input className="h-11 w-full rounded-xl border border-line bg-paper px-3.5 text-[0.9375rem] text-ink-deep outline-none focus:border-line-strong" value={termLabel} onChange={(e) => setTermLabel(e.target.value)} placeholder="2025-2026" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[0.75rem] font-semibold tracking-[0.08em] text-ink-soft uppercase">Starts</span>
          <input type="date" className="h-11 w-full rounded-xl border border-line bg-paper px-3.5 text-[0.9375rem] text-ink-deep outline-none focus:border-line-strong" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[0.75rem] font-semibold tracking-[0.08em] text-ink-soft uppercase">Ends</span>
          <input type="date" className="h-11 w-full rounded-xl border border-line bg-paper px-3.5 text-[0.9375rem] text-ink-deep outline-none focus:border-line-strong" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </label>
      </div>

      <div className="flex flex-col items-center gap-6 rounded-2xl border border-line bg-paper/70 p-6">
        {rows.map((count, ri) => {
          const startIdx = rowStarts[ri];
          const rowNodes = nodes.slice(startIdx, startIdx + count);
          return (
            <div key={ri} className="flex flex-wrap justify-center gap-4">
              {rowNodes.map((node, ci) => {
                const idx = startIdx + ci;
                return (
                  <div
                    key={node.id}
                    draggable={canEdit}
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={handleDragOver}
                    onDrop={() => handleDrop(idx)}
                    className="group relative flex w-44 flex-col items-center gap-2 rounded-2xl border border-line bg-canvas p-3 shadow-sm transition hover:shadow-md"
                  >
                    <div className="relative">
                      {node.photo ? (
                        <img src={node.photo} alt="" className="h-16 w-16 rounded-full object-cover" />
                      ) : (
                        <div className="grid h-16 w-16 place-items-center rounded-full bg-ink/[0.06] text-[0.625rem] text-muted">
                          photo
                        </div>
                      )}
                      {canEdit ? (
                        <button
                          type="button"
                          onClick={() => fileRef.current?.click()}
                          className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full bg-ink text-[0.625rem] text-canvas"
                          title="Upload photo"
                        >
                          +
                        </button>
                      ) : null}
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handlePhoto(idx, e.target.files?.[0] ?? null)}
                      />
                    </div>

                    {canEdit ? (
                      <>
                        <input
                          className="h-8 w-full rounded-lg border border-line bg-paper px-2 text-center text-[0.8125rem] font-semibold text-ink-deep outline-none focus:border-line-strong"
                          placeholder="Position title"
                          value={node.title}
                          onChange={(e) => updateNode(idx, { title: e.target.value })}
                        />
                        <input
                          className="h-7 w-full rounded-lg border border-line bg-paper px-2 text-center text-[0.75rem] text-body outline-none focus:border-line-strong"
                          placeholder="First name"
                          value={node.firstName}
                          onChange={(e) => updateNode(idx, { firstName: e.target.value })}
                        />
                        <input
                          className="h-7 w-full rounded-lg border border-line bg-paper px-2 text-center text-[0.75rem] text-body outline-none focus:border-line-strong"
                          placeholder="Last name"
                          value={node.lastName}
                          onChange={(e) => updateNode(idx, { lastName: e.target.value })}
                        />
                        <input
                          className="h-7 w-full rounded-lg border border-line bg-paper px-2 text-center text-[0.6875rem] text-muted outline-none focus:border-line-strong"
                          placeholder="email@campus.edu"
                          value={node.email}
                          onChange={(e) => updateNode(idx, { email: e.target.value })}
                        />
                      </>
                    ) : (
                      <>
                        <p className="text-[0.875rem] font-semibold text-ink-deep">{node.title || "Position"}</p>
                        <p className="text-[0.75rem] text-body">
                          {[node.firstName, node.lastName].filter(Boolean).join(" ") || "—"}
                        </p>
                      </>
                    )}

                    {canEdit ? (
                      <button
                        type="button"
                        onClick={() => removeNode(idx)}
                        className="absolute -top-2 -right-2 grid h-5 w-5 place-items-center rounded-full bg-[#a5442c] text-[0.625rem] font-bold text-canvas"
                        title="Remove"
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}

        {canEdit ? (
          <button
            type="button"
            onClick={addNode}
            className="pressable rounded-full border border-dashed border-line-strong px-4 py-2 text-[0.8125rem] font-medium text-ink hover:bg-ink/[0.035]"
          >
            + Add position
          </button>
        ) : null}
      </div>

      {note ? (
        <p role="status" className="rounded-xl border border-brass/40 bg-brass-soft/25 px-3.5 py-2.5 text-[0.8125rem] font-medium text-ink">
          {note}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-xl border border-[#d9a99c] bg-[#a5442c]/[0.06] px-3.5 py-2.5 text-[0.8125rem] font-medium text-[#a5442c]">
          {error}
        </p>
      ) : null}

      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button disabled={saving} onClick={() => void save()}>
            <SwapText isPending={saving} idle="Save structure" pending="Saving…" />
          </Button>
          <Button disabled={submitting || !structureId} variant="outline" onClick={() => void submit()}>
            <SwapText isPending={submitting} idle="Submit for review" pending="Submitting…" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}