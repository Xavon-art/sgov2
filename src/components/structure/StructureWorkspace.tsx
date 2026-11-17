"use client";

import { useEffect, useState } from "react";
import {
  checkDocument,
  emptyCommittee,
  emptyDocument,
  emptyPosition,
} from "@/components/structure/document";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Reveal } from "@/components/fx/Reveal";
import { RowReorder } from "@/components/structure/RowReorder";
import { useReorder, type ReorderRow } from "@/components/structure/reorder";
import {
  MAX_PHOTO_BYTES,
  fetchMemberPhoto,
  fetchStructure,
  fetchTemplates,
  matchHolder,
  renewStructure,
  saveDraft,
  saveTemplate,
  structureError,
  submitDraft,
  type StructureCapability,
  type StructureCommittee,
  type StructureDocument,
  type StructureHolder,
  type StructurePosition,
  type StructureRenewal,
  type StructureSummary,
  type StructureTemplate,
} from "@/lib/structure";

/**
 * The officer's side of the feature: one structure under construction, edited as
 * a whole local document.
 *
 * What this component deliberately does not do:
 *
 *   1. Decide who may edit. `capability` arrives from the database and only
 *      chooses whether to render the editor; `save_structure_draft` refuses an
 *      editor-less save regardless of what this component believes.
 *   2. Publish anything. The published structure is whatever the last approved
 *      revision is; submitting hands the document to a reviewer and stops.
 *   3. Put a roster id in the document. `rosterId` is needed to fetch a stored
 *      photo, but the document is persisted verbatim into `gov_structures.document`,
 *      so an id that only matters to this session is held in `rosterByEmail` here.
 */

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; revision: number }
  | { kind: "error"; message: string };

// ---------------------------------------------------------------- primitives

const inputClass =
  "h-11 w-full rounded-xl border border-line bg-paper px-3.5 text-[0.9375rem] text-ink-deep outline-none transition-colors placeholder:text-muted focus:border-line-strong";

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <span className="mb-1.5 flex items-baseline justify-between gap-3">
      <span className="text-[0.75rem] font-semibold tracking-[0.08em] text-ink-soft uppercase">
        {children}
      </span>
      {hint ? <span className="text-[0.6875rem] text-muted">{hint}</span> : null}
    </span>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <Label hint={hint}>{label}</Label>
      <input
        className={inputClass}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-paper/70 p-5 sm:p-6">{children}</section>
  );
}

function Notice({ tone, children }: { tone: "info" | "bad" | "good"; children: React.ReactNode }) {
  const cls =
    tone === "bad"
      ? "border-[#a33a2e]/35 bg-[#a33a2e]/[0.07] text-[#8c3126]"
      : tone === "good"
        ? "border-[#2f6d4f]/35 bg-[#2f6d4f]/[0.07] text-[#255639]"
        : "border-line bg-paper/60 text-body";
  return (
    <p className={`rounded-xl border px-4 py-3 text-[0.875rem] leading-relaxed ${cls}`}>{children}</p>
  );
}

function bytes(n: number): string {
  return n < 1024 ? `${n} B` : `${Math.round(n / 1024)} KB`;
}

/** Reads a File into bare base64, which is the shape `holder.photo` takes. */
async function toBase64(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buffer.length; i++) binary += String.fromCharCode(buffer[i]);
  return btoa(binary);
}

// ------------------------------------------------------------------- holder

function HolderEditor({
  unitId,
  holder,
  rosterByEmail,
  onChange,
  onVacate,
}: {
  unitId: string;
  holder: StructureHolder;
  rosterByEmail: (email: string) => string | undefined;
  onChange: (next: StructureHolder) => void;
  onVacate: () => void;
}) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const email = holder.email.trim();
  const rosterId = email ? rosterByEmail(email) : undefined;

  // The stored photo is fetched from the photo route on demand. The document
  // itself only ever carries `hasPhoto`, so no read of a structure puts every
  // officer's face into a JSON payload.
  async function showStoredPhoto() {
    setNote("");
    const id = rosterId ?? (await matchHolder(unitId, email)).rosterId;
    if (!id) {
      setNote("No photo is on file for this person yet.");
      setPhotoUrl(null);
      return;
    }
    const url = await fetchMemberPhoto(id);
    setPhotoUrl(url);
    if (!url) setNote("That photo could not be read.");
  }

  return (
    <div className="mt-3 rounded-xl border border-line bg-canvas/40 p-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="shrink-0">
          {photoUrl ? (
            // The bytes came from our own scoped route as a data URL; there is no
            // remote, user-controlled source here to sanitize.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt="" className="size-20 rounded-xl border border-line object-cover" />
          ) : (
            <button
              type="button"
              onClick={() => void showStoredPhoto()}
              disabled={!email}
              className="flex size-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong text-[0.625rem] text-muted transition-colors hover:border-ink/40 hover:text-ink-soft disabled:cursor-not-allowed disabled:opacity-50"
            >
              {holder.hasPhoto ? "Show photo" : "No photo"}
            </button>
          )}
        </div>

        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
          <Field
            label="Email"
            value={holder.email}
            onChange={(v) => {
              setPhotoUrl(null);
              onChange({ ...holder, email: v });
            }}
            type="email"
          />
          <Field
            label="First name"
            value={holder.firstName ?? ""}
            onChange={(v) => onChange({ ...holder, firstName: v })}
          />
          <Field
            label="Last name"
            value={holder.lastName ?? ""}
            onChange={(v) => onChange({ ...holder, lastName: v })}
          />
          <Field
            label="Middle name"
            value={holder.middleName ?? ""}
            onChange={(v) => onChange({ ...holder, middleName: v })}
          />
          <Field
            label="Course"
            value={holder.course ?? ""}
            onChange={(v) => onChange({ ...holder, course: v })}
          />
          <Field
            label="Year level"
            value={holder.yearLevel ?? ""}
            onChange={(v) => onChange({ ...holder, yearLevel: v })}
          />
          <Field
            label="Contact"
            value={holder.contactNumber ?? ""}
            onChange={(v) => onChange({ ...holder, contactNumber: v })}
          />
          <Field
            label="Address"
            value={holder.address ?? ""}
            onChange={(v) => onChange({ ...holder, address: v })}
          />
          <Field
            label="Birthdate"
            value={holder.birthdate ?? ""}
            onChange={(v) => onChange({ ...holder, birthdate: v })}
            type="date"
          />

          <label className="block sm:col-span-2">
            <Label hint={`up to ${bytes(MAX_PHOTO_BYTES)}`}>Photo</Label>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="block w-full text-[0.8125rem] text-ink-soft file:mr-3 file:rounded-full file:border file:border-line file:bg-paper file:px-3 file:py-1.5 file:text-[0.8125rem] file:font-medium file:text-ink-deep"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                // Refused here while the file is still local. `gov_document_valid`
                // refuses it again on save, so this is a courtesy, not the gate.
                if (file.size > MAX_PHOTO_BYTES) {
                  setNote(
                    `That photo is ${bytes(file.size)}. The limit is ${bytes(MAX_PHOTO_BYTES)}.`,
                  );
                  return;
                }
                const base64 = await toBase64(file);
                setPhotoUrl(`data:${file.type};base64,${base64}`);
                setNote("");
                onChange({ ...holder, photo: base64, hasPhoto: true });
              }}
            />
          </label>
        </div>
      </div>

      {note ? <p className="mt-2 text-[0.8125rem] text-[#8c3126]">{note}</p> : null}

      <div className="mt-3">
        <Button type="button" variant="ghost" size="sm" onClick={onVacate}>
          Leave vacant
        </Button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- positions

function PositionRow({
  unitId,
  position,
  index,
  total,
  onChange,
  onRemove,
  canRemove,
  canMoveUp,
  canMoveDown,
  onNudge,
  drag,
  rosterByEmail,
}: {
  unitId: string;
  position: StructurePosition;
  index: number;
  total: number;
  onChange: (next: StructurePosition) => void;
  onRemove: () => void;
  canRemove: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onNudge: (delta: number) => void;
  drag: ReorderRow;
  rosterByEmail: (email: string) => string | undefined;
}) {
  const holder = position.holder ?? null;

  return (
    <li
      className="rounded-xl border border-line bg-canvas/30 p-4 transition-shadow"
      data-dragging={drag["data-dragging"] || undefined}
      data-drop={drag["data-drop"] || undefined}
      onDragOver={drag.onDragOver}
      onDrop={drag.onDrop}
    >
      <div className="flex flex-wrap items-end gap-3">
        <RowReorder
          label={position.title.trim() || `Position ${index + 1}`}
          movable={total > 1}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          onDragStart={drag.onDragStart}
          onDragEnd={drag.onDragEnd}
          onNudge={onNudge}
        />
        <div className="min-w-[12rem] flex-1">
          <Field
            label="Position"
            value={position.title}
            onChange={(v) => onChange({ ...position, title: v })}
            placeholder="President"
          />
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={holder ? "ghost" : "paper"}
            size="sm"
            onClick={() =>
              onChange({
                ...position,
                holder: holder ? null : { email: "", firstName: "", lastName: "", hasPhoto: false },
              })
            }
          >
            {holder ? "Remove holder" : "Assign holder"}
          </Button>
          {canRemove ? (
            <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
              Remove
            </Button>
          ) : null}
        </div>
      </div>

      {holder ? (
        <HolderEditor
          unitId={unitId}
          holder={holder}
          rosterByEmail={rosterByEmail}
          onChange={(next) => onChange({ ...position, holder: next })}
          onVacate={() => onChange({ ...position, holder: null })}
        />
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------- committees

function CommitteeEditor({
  unitId,
  committee,
  index,
  total,
  drag,
  onChange,
  onRemove,
  onAddPosition,
  onMovePosition,
  onNudge,
  rosterByEmail,
}: {
  unitId: string;
  committee: StructureCommittee;
  index: number;
  total: number;
  drag: ReorderRow;
  onChange: (next: StructureCommittee) => void;
  onRemove: () => void;
  onAddPosition: () => void;
  onMovePosition: (from: number, to: number) => void;
  onNudge: (delta: number) => void;
  rosterByEmail: (email: string) => string | undefined;
}) {
  const [descriptionOpen, setDescriptionOpen] = useState(committee.description !== undefined);
  const isFirst = index === 0;

  const { rowProps, nudge } = useReorder(
    committee.positions.map((p) => p.key),
    onMovePosition,
  );

  return (
    <article
      className="rounded-2xl border border-line-strong bg-paper/80 p-5 transition-shadow sm:p-6"
      data-dragging={drag["data-dragging"] || undefined}
      data-drop={drag["data-drop"] || undefined}
      onDragOver={drag.onDragOver}
      onDrop={drag.onDrop}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <RowReorder
          label={committee.name.trim() || (isFirst ? "Council" : "Committee")}
          movable={!isFirst}
          canMoveUp={!isFirst && index > 1}
          canMoveDown={index < total - 1}
          onDragStart={drag.onDragStart}
          onDragEnd={drag.onDragEnd}
          onNudge={onNudge}
        />
        <div className="min-w-[14rem] flex-1">
          <Field
            label={isFirst ? "Council" : "Committee"}
            value={committee.name}
            onChange={(v) => onChange({ ...committee, name: v })}
            placeholder={isFirst ? "College of Engineering Student Council" : "Committee on Academics"}
          />
        </div>
        {isFirst ? null : (
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
            Remove committee
          </Button>
        )}
      </div>

      <p className="mt-2 text-[0.8125rem] text-muted">
        {isFirst
          ? "This is the council itself, so it is always first and cannot be removed. Its seats belong to this unit."
          : "A committee inside the council."}
      </p>

      {descriptionOpen || committee.description ? (
        <div className="mt-3">
          <Field
            label="Description"
            value={committee.description ?? ""}
            onChange={(v) => onChange({ ...committee, description: v })}
          />
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2"
          onClick={() => {
            setDescriptionOpen(true);
            onChange({ ...committee, description: "" });
          }}
        >
          Add description
        </Button>
      )}

      <div className="mt-5">
        <Label>Positions</Label>
        <ul className="flex flex-col gap-3">
          {committee.positions.map((p, pi) => {
            const row = rowProps(p.key, pi);
            return (
              <PositionRow
                key={p.key}
                unitId={unitId}
                position={p}
                index={pi}
                total={committee.positions.length}
                canRemove={committee.positions.length > 1}
                drag={row}
                rosterByEmail={rosterByEmail}
                canMoveUp={pi > 0}
                canMoveDown={pi < committee.positions.length - 1}
                onNudge={(delta) => nudge(p.key, delta)}
                onChange={(next) =>
                  onChange({
                    ...committee,
                    positions: committee.positions.map((x, i) => (i === pi ? next : x)),
                  })
                }
                onRemove={() =>
                  onChange({
                    ...committee,
                    // The row goes; the key is not recycled, so a later position
                    // cannot inherit an identity a history already used.
                    positions: committee.positions.filter((_, i) => i !== pi),
                  })
                }
              />
            );
          })}
        </ul>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="paper" size="sm" onClick={onAddPosition}>
            Add position
          </Button>
        </div>
      </div>
    </article>
  );
}

// ------------------------------------------------------------------- gallery

function TemplateGallery({
  canSaveTemplates,
  onApply,
  onSaveCurrent,
  busy,
}: {
  canSaveTemplates: boolean;
  onApply: (template: StructureTemplate) => void;
  onSaveCurrent: () => void;
  busy: boolean;
}) {
  const [templates, setTemplates] = useState<StructureTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setError(null);
    const res = await fetchTemplates();
    if (!res.ok) {
      setError(structureError(res));
      return;
    }
    setTemplates(res.templates ?? []);
  }

  return (
    <Panel>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Label>Templates</Label>
          <p className="text-[0.875rem] text-muted">
            Start from a skeleton. A template can never carry a person&apos;s name.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="paper" size="sm" onClick={() => void open()} disabled={busy}>
            {templates ? "Refresh" : "Browse templates"}
          </Button>
          {canSaveTemplates ? (
            <Button type="button" variant="ghost" size="sm" onClick={onSaveCurrent} disabled={busy}>
              Save current as template
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="mt-3 text-[0.8125rem] text-[#8c3126]">{error}</p>
      ) : null}

      {templates ? (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {templates.map((t) => (
            <li key={t.key} className="rounded-xl border border-line bg-canvas/40 p-4">
              <p className="text-[0.9375rem] font-medium text-ink-deep">{t.name}</p>
              {t.description ? (
                <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">{t.description}</p>
              ) : null}
              <p className="mt-2 text-[0.6875rem] tracking-[0.08em] text-muted uppercase">
                {t.category} &middot; {t.committees} committees &middot; {t.seats} positions
                {t.isBuiltin ? " &middot; built-in" : ""}
              </p>
              <div className="mt-3">
                <Button type="button" variant="paper" size="sm" disabled={busy} onClick={() => onApply(t)}>
                  Use this
                </Button>
              </div>
            </li>
          ))}
          {templates.length === 0 ? (
            <li className="text-[0.875rem] text-muted">No templates are available yet.</li>
          ) : null}
        </ul>
      ) : null}
    </Panel>
  );
}

// ------------------------------------------------------------------- viewers

function holderName(holder: StructureHolder | null | undefined): string {
  if (!holder) return "Vacant";
  const name = [holder.firstName, holder.lastName].filter(Boolean).join(" ").trim();
  return name || holder.email;
}

export function ApprovedViewer({ approved }: { approved: StructureSummary | null | undefined }) {
  const [open, setOpen] = useState<string | null>(null);

  if (!approved) {
    return (
      <Panel>
        <Label>Published structure</Label>
        <p className="text-[0.875rem] text-muted">
          Nothing has been approved for this council yet.
        </p>
      </Panel>
    );
  }

  return (
    <Panel>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <Label>Published structure</Label>
          <p className="text-[0.875rem] text-body">
            {approved.termLabel} &middot; revision {approved.revision}
          </p>
        </div>
        <span className="rounded-full border border-[#2f6d4f]/35 bg-[#2f6d4f]/[0.08] px-2.5 py-1 text-[0.625rem] font-semibold tracking-[0.12em] text-[#255639] uppercase">
          Approved
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {approved.document.committees.map((c) => (
          <div key={c.key} className="rounded-xl border border-line bg-canvas/40">
            <button
              type="button"
              className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left"
              aria-expanded={open === c.key}
              onClick={() => setOpen(open === c.key ? null : c.key)}
            >
              <span className="text-[0.9375rem] font-medium text-ink-deep">{c.name}</span>
              <span className="text-[0.75rem] text-muted">{c.positions.length} positions</span>
            </button>
            {open === c.key ? (
              <ul className="border-t border-line px-4 py-2">
                {c.positions.map((p) => (
                  <li
                    key={p.key}
                    className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line/60 py-2 last:border-b-0"
                  >
                    <span className="text-[0.875rem] text-ink">{p.title}</span>
                    <span className="text-[0.8125rem] text-muted">{holderName(p.holder)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ----------------------------------------------------------------- workspace

export function StructureWorkspace({
  unitId,
  unitName,
  capability,
}: {
  unitId: string;
  unitName: string;
  capability: StructureCapability;
}) {
  const [doc, setDoc] = useState<StructureDocument>(emptyDocument);
  const [structureId, setStructureId] = useState<string | null>(null);
  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const [approved, setApproved] = useState<StructureSummary | null>(null);
  const [renewal, setRenewal] = useState<StructureRenewal | null>(null);
  const [termLabel, setTermLabel] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [note, setNote] = useState("");
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [problem, setProblem] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // email -> rosterId, for the photo route. Never part of the document.
  const [rosterByEmail, setRosterByEmail] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetchStructure(unitId);
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) {
        setProblem(structureError(res));
        return;
      }
      setApproved(res.approved ?? null);
      setRenewal(res.renewal ?? null);
      const draft = res.draft ?? null;
      if (draft) {
        setStructureId(draft.id);
        setDoc(draft.document);
        setTemplateKey(draft.templateKey);
        setTermLabel(draft.termLabel);
        setStartsOn(draft.startsOn);
        setEndsOn(draft.endsOn);
        setNote(draft.note ?? "");
        setStatus(
          draft.status === "returned"
            ? `Returned by your reviewer${draft.decisionRemark ? `: ${draft.decisionRemark}` : "."}`
            : `Revision ${draft.revision}, ${draft.status}.`,
        );
      } else if (res.approved) {
        // Nothing under this officer yet but something is published: start the
        // next term from what is live rather than from a blank page.
        setDoc(res.approved.document);
        setTermLabel(res.approved.termLabel);
        setStartsOn(res.approved.startsOn);
        setEndsOn(res.approved.endsOn);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unitId]);

  /**
   * Resolves the roster ids a document already implies.
   *
   * A holder saved earlier is on the organization roll but not in this payload,
   * so the ids are looked up once here instead of being carried in the document.
   * Failures are ignored on purpose: a missing photo is a cosmetic miss, and a
   * failed lookup must not stop the structure from loading.
   */
  useEffect(() => {
    const emails = new Set<string>();
    for (const c of doc.committees) {
      for (const p of c.positions) {
        const e = p.holder?.email?.trim().toLowerCase();
        if (e) emails.add(e);
      }
    }
    if (!emails.size) return;
    let cancelled = false;
    void (async () => {
      const found: Record<string, string> = {};
      for (const email of emails) {
        if (cancelled) return;
        const match = await matchHolder(unitId, email);
        if (match.rosterId) found[email] = match.rosterId;
      }
      if (!cancelled) setRosterByEmail((prev) => ({ ...prev, ...found }));
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, unitId]);

  function edit(next: StructureDocument) {
    setDoc(next);
    setDirty(true);
    setSave({ kind: "idle" });
  }

  function patchCommittee(index: number, next: StructureCommittee) {
    edit({ committees: doc.committees.map((c, i) => (i === index ? next : c)) });
  }

  function moveCommittee(from: number, to: number) {
    const next = doc.committees.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    edit({ committees: next });
  }

  // Committee order is part of the published document, so it is reordered the same
  // way position order is -- with the council locked to the front, because
  // `gov_document_valid` accepts `isUnit` on the first committee and nowhere else.
  const committeeReorder = useReorder(
    doc.committees.map((c) => c.key),
    moveCommittee,
    true,
  );

  async function persist(): Promise<string | null> {
    try {
      const found = checkDocument(doc);
      setProblem(found ? found.message : null);
      if (found) return null;

      if (!termLabel.trim()) {
        setProblem("Give the term a label, such as A.Y. 2026-2027.");
        return null;
      }
      if (!startsOn || !endsOn) {
        setProblem("A term needs both a start and an end date.");
        return null;
      }

      setSave({ kind: "saving" });
      const res = await saveDraft({
        unitId,
        templateKey: templateKey ?? undefined,
        termLabel: termLabel.trim(),
        startsOn,
        endsOn,
        document: doc,
        note: note.trim() || undefined,
      });

      if (!res.ok) {
        setSave({ kind: "error", message: structureError(res) });
        return null;
      }

      if (res.structureId) setStructureId(res.structureId);
      setSave({ kind: "saved", revision: res.revision ?? 0 });
      setDirty(false);
      setStatus(null);
      return res.structureId ?? structureId;
    } catch (e) {
      setSave({ kind: "error", message: e instanceof Error ? e.message : "We could not save that." });
      return null;
    }
  }

  async function onRenew() {
    try {
      setSave({ kind: "saving" });
      setProblem(null);

      const res = await renewStructure({ unitId });
      if (!res.ok) {
        setSave({ kind: "error", message: structureError(res) });
        return;
      }

      const after = await fetchStructure(unitId);
      setSave({ kind: "idle" });
      if (!after.ok) {
        setSave({ kind: "error", message: structureError(after) });
        return;
      }

      setStructureId(after.draft?.id ?? null);
      setDoc(after.draft?.document ?? emptyDocument);
      setTemplateKey(after.draft?.templateKey ?? null);
      setTermLabel(after.draft?.termLabel ?? "");
      setStartsOn(after.draft?.startsOn ?? "");
      setEndsOn(after.draft?.endsOn ?? "");
      setNote("");
      setApproved(after.approved ?? null);
      setRenewal(after.renewal ?? null);
      setDirty(false);
      setStatus("Renewed. The next term is open as a draft, carried forward from what was live.");
    } catch (e) {
      setSave({ kind: "error", message: e instanceof Error ? e.message : "We could not renew that." });
    }
  }

  async function onSubmit() {
    try {
      const id = await persist();
      if (!id) return;
      setSave({ kind: "saving" });
      const res = await submitDraft(id, note.trim() || undefined);
      if (!res.ok) {
        setSave({ kind: "error", message: structureError(res) });
        return;
      }
      const after = await fetchStructure(unitId);
      setSave({ kind: "idle" });
      if (!after.ok) {
        setSave({ kind: "error", message: structureError(after) });
        return;
      }
      setStructureId(after.draft?.id ?? null);
      setDoc(after.draft?.document ?? doc);
      setApproved(after.approved ?? null);
      setRenewal(after.renewal ?? null);
      setStatus(
        after.draft?.status === "submitted"
          ? "Sent for review. You can keep editing until a reviewer decides."
          : "Approved and published.",
      );
    } catch (e) {
      setSave({ kind: "error", message: e instanceof Error ? e.message : "We could not submit that." });
    }
  }

  if (!capability.canRead) {
    return (
      <Panel>
        <Notice tone="info">
          You do not have access to this council&apos;s structure. Access is decided by the
          database, not by this page.
        </Notice>
      </Panel>
    );
  }

  if (loading) {
    return (
      <Panel>
        <p className="text-[0.875rem] text-muted">Loading {unitName}&apos;s structure&hellip;</p>
      </Panel>
    );
  }

  if (!capability.canEdit) {
    return <ApprovedViewer approved={approved} />;
  }

  const busy = save.kind === "saving";

  return (
    <div className="flex flex-col gap-6">
      <Reveal>
        <TemplateGallery
          canSaveTemplates={capability.isReviewer}
          busy={busy}
          onApply={(t) => {
            // The template's own keys are kept: they are stable slugs, and two
            // structures using the same ones is fine because uniqueness is per
            // document, not per unit.
            setTemplateKey(t.key);
            edit(t.document);
            setProblem(null);
          }}
          onSaveCurrent={async () => {
            try {
              const found = checkDocument(doc);
              if (found) {
                setProblem(found.message);
                return;
              }
              const name = window.prompt("Template name", `${unitName} structure`);
              if (!name) return;
              const res = await saveTemplate({
                key: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60),
                name: name.trim(),
                category: "custom",
                document: doc,
              });
              setProblem(res.ok ? `Saved as "${name.trim()}".` : structureError(res));
            } catch (e) {
              setProblem(e instanceof Error ? e.message : "We could not save that template.");
            }
          }}
        />
      </Reveal>

      {status ? <Notice tone="info">{status}</Notice> : null}
      {renewal?.canRequest ? (
        <Panel>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <Label>Renew the structure</Label>
              <p className="text-[0.875rem] leading-relaxed text-body">
                {renewal.label ?? "The current term"} is live
                {renewal.endsOn ? ` until ${renewal.endsOn}` : ""}
                {renewal.daysRemaining === null
                  ? "."
                  : renewal.daysRemaining < 0
                    ? ` — it ended ${Math.abs(renewal.daysRemaining)} days ago.`
                    : renewal.daysRemaining === 0
                      ? " — it ends today."
                      : ` — ${renewal.daysRemaining} days left.`}
              </p>
              <p className="mt-1 text-[0.8125rem] text-muted">
                Renewing opens the next term as a draft, carrying the current officers
                forward. Nothing is published until you submit it.
              </p>
            </div>
            <Button type="button" onClick={() => void onRenew()} disabled={busy}>
              Renew
            </Button>
          </div>
        </Panel>
      ) : null}

      <Reveal delay={0.04}>
        <Panel>
          <Label>Term</Label>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              label="Label"
              value={termLabel}
              onChange={(v) => {
                setTermLabel(v);
                setDirty(true);
              }}
              placeholder="A.Y. 2026-2027"
            />
            <Field
              label="Starts"
              type="date"
              value={startsOn}
              onChange={(v) => {
                setStartsOn(v);
                setDirty(true);
              }}
            />
            <Field
              label="Ends"
              type="date"
              value={endsOn}
              onChange={(v) => {
                setEndsOn(v);
                setDirty(true);
              }}
            />
          </div>
        </Panel>
      </Reveal>

      <div className="flex flex-col gap-4">
        {doc.committees.map((c, ci) => (
          <CommitteeEditor
            key={c.key}
            unitId={unitId}
            committee={c}
            index={ci}
            total={doc.committees.length}
            drag={committeeReorder.rowProps(c.key, ci)}
            rosterByEmail={(email) => rosterByEmail[email]}
            onChange={(next) => patchCommittee(ci, next)}
            onRemove={() => edit({ committees: doc.committees.filter((_, i) => i !== ci) })}
            onAddPosition={() => patchCommittee(ci, { ...c, positions: [...c.positions, emptyPosition()] })}
            onMovePosition={(from, to) => {
              const next = c.positions.slice();
              const [moved] = next.splice(from, 1);
              next.splice(to, 0, moved);
              patchCommittee(ci, { ...c, positions: next });
            }}
            onNudge={(delta) => committeeReorder.nudge(c.key, delta)}
          />
        ))}
      </div>

      <Reveal delay={0.06}>
        <Panel>
          <Button
            type="button"
            variant="paper"
            size="sm"
            onClick={() => edit({ committees: [...doc.committees, emptyCommittee()] })}
          >
            Add committee
          </Button>
        </Panel>
      </Reveal>

      <Reveal delay={0.08}>
        <Panel>
          <Field
            label="Note to the reviewer"
            value={note}
            onChange={(v) => {
              setNote(v);
              setDirty(true);
            }}
          />

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button type="button" onClick={() => void persist()} disabled={busy}>
              Save draft
            </Button>
            <Button type="button" variant="outline" onClick={() => void onSubmit()} disabled={busy}>
              Save and submit for review
            </Button>
            <ButtonLink href="/my-council" variant="ghost" size="md">
              Back to council
            </ButtonLink>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            {problem ? <Notice tone="bad">{problem}</Notice> : null}
            {save.kind === "saved" ? (
              <Notice tone="good">Saved as revision {save.revision}.</Notice>
            ) : null}
            {save.kind === "error" ? <Notice tone="bad">{save.message}</Notice> : null}
            {save.kind === "idle" && !problem && dirty ? (
              <Notice tone="info">Unsaved changes.</Notice>
            ) : null}
          </div>
        </Panel>
      </Reveal>
    </div>
  );
}