"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAccount } from "@/components/dashboard/dashboard-context";
import { useRealtimeSignals } from "@/lib/realtime";
import {
  checkDocument,
  emptyCommittee,
  emptyDocument,
  emptyPosition,
  normalizeDocument,
  normalizeLayout,
} from "@/components/structure/document";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Reveal } from "@/components/fx/Reveal";
import { RowReorder } from "@/components/structure/RowReorder";
import { useReorder, type ReorderRow } from "@/components/structure/reorder";
import { StructureChartEditor } from "@/components/structure/StructureChartEditor";
import { invalidateStructurePhotoCache } from "@/components/structure/StructureChart";
import { ChartViewer } from "@/components/structure/ChartViewer";
import { StructureStatusTracker } from "@/components/structure/StructureStatusTracker";
import {
  DEFAULT_LAYOUT,
  MAX_PHOTO_BYTES,
  fetchHolderPhoto,
  fetchMemberPhoto,
  fetchStructure,
  fetchTemplates,
  matchHolder,
  renewStructure,
  saveDraft,
  saveTemplate,
  structureError,
  submitDraft,
  type SaveResult,
  type StructureCapability,
  type StructureCommittee,
  type StructureDocument,
  type StructureHolder,
  type StructureLayout,
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
 *   3. Put a roster id in the document. Stored photos are read by unit and email,
 *      so the document stays free of session-only roster identifiers.
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

type StoredStructureDraft = {
  document: StructureDocument;
  termLabel: string;
  startsOn: string;
  endsOn: string;
  note: string;
  templateKey: string | null;
  structureId: string | null;
  serverUpdatedAt: string | null;
  localUpdatedAt: number;
  dirty: boolean;
};

function photoDataUrl(photo?: string | null): string | null {
  if (!photo) return null;
  if (photo.startsWith("data:")) return photo;
  if (photo.startsWith("/9j/")) return `data:image/jpeg;base64,${photo}`;
  if (photo.startsWith("iVBOR")) return `data:image/png;base64,${photo}`;
  if (photo.startsWith("UklGR")) return `data:image/webp;base64,${photo}`;
  return `data:image/jpeg;base64,${photo}`;
}

type PhotoPayload = {
  ok: boolean;
  reason?: string;
  hasPhoto?: boolean;
  rosterId?: string | null;
  base64?: string | null;
  mime?: string | null;
};

const photoCachePrefix = "smartgov:structure-photo:";
const persistedPhotos = new Set<string>();

function barePhoto(photo: string): string {
  return photo.startsWith("data:") ? photo.slice(photo.indexOf(",") + 1) : photo;
}

function photoCacheKey(unitId: string, email: string): string {
  return `${photoCachePrefix}${unitId}:${email}`;
}

function readPhotoCache(unitId: string, email: string): string | null {
  try {
    return localStorage.getItem(photoCacheKey(unitId, email));
  } catch {
    return null;
  }
}

function writePhotoCache(unitId: string, email: string, url: string): void {
  try {
    localStorage.setItem(photoCacheKey(unitId, email), url);
  } catch {
    return;
  }
}

function clearPhotoCache(unitId: string, email: string): void {
  try {
    localStorage.removeItem(photoCacheKey(unitId, email));
  } catch {
    return;
  }
}

async function persistPhoto(unitId: string, email: string, photo: string): Promise<PhotoPayload | null> {
  const bare = barePhoto(photo);
  const address = email.trim().toLowerCase();
  if (!unitId || !address || !bare) return null;
  const key = `${unitId}:${address}:${bare.length}:${bare.slice(0, 48)}`;
  if (persistedPhotos.has(key)) return null;
  persistedPhotos.add(key);
  try {
    const res = await fetch("/api/structures/photos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unitId, email: address, photo: bare }),
    });
    const payload = (await res.json()) as PhotoPayload;
    if (payload.ok) invalidateStructurePhotoCache();
    return payload;
  } catch {
    persistedPhotos.delete(key);
    return null;
  }
}

async function loadStoredPhotos(
  unitId: string,
  holders: StructureHolder[],
  resolveRosterId: (email: string) => string | undefined,
): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  await Promise.all(
    holders.map(async (holder) => {
      const email = holder.email.trim().toLowerCase();
      if (!email || !holder.hasPhoto || holder.photo) return;
      try {
        const rosterId = resolveRosterId(email);
        const url = rosterId ? await fetchMemberPhoto(rosterId) : await fetchHolderPhoto(unitId, email);
        if (url) {
          found[email] = url;
          writePhotoCache(unitId, email, url);
        } else {
          clearPhotoCache(unitId, email);
        }
      } catch {
        const cached = readPhotoCache(unitId, email);
        if (cached) found[email] = cached;
      }
    }),
  );
  return found;
}

function collectHolders(doc: StructureDocument): StructureHolder[] {
  const holders: StructureHolder[] = [];
  for (const committee of doc.committees) {
    for (const position of committee.positions) {
      if (position.holder) holders.push(position.holder);
      if (position.holders) holders.push(...position.holders);
    }
  }
  return holders;
}

function withStoredPhoto(holder: StructureHolder, found: Record<string, string>): StructureHolder {
  const url = found[holder.email.trim().toLowerCase()];
  return url && !holder.photo ? { ...holder, photo: barePhoto(url) } : holder;
}

function withStoredPhotos(doc: StructureDocument, found: Record<string, string>): StructureDocument {
  return {
    ...doc,
    committees: doc.committees.map((committee) => ({
      ...committee,
      positions: committee.positions.map((position) => ({
        ...position,
        holder: position.holder ? withStoredPhoto(position.holder, found) : position.holder,
        holders: position.holders?.map((holder) => withStoredPhoto(holder, found)),
      })),
    })),
  };
}

function queuePhotoPersists(prev: StructureDocument, next: StructureDocument, unitId: string): void {
  const before = new Map<string, string>();
  for (const holder of collectHolders(prev)) {
    const email = holder.email.trim().toLowerCase();
    if (holder.photo && email) before.set(email, barePhoto(holder.photo));
  }
  const seen = new Set<string>();
  for (const holder of collectHolders(next)) {
    const email = holder.email.trim().toLowerCase();
    if (!email || !holder.photo || seen.has(email)) continue;
    seen.add(email);
    const photo = barePhoto(holder.photo);
    if (photo && before.get(email) !== photo) void persistPhoto(unitId, email, photo);
  }
}

function readStructureDraft(unitId: string): StoredStructureDraft | null {
  try {
    const raw = localStorage.getItem(`smartgov:structure-draft:${unitId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredStructureDraft;
    if (!parsed || !parsed.document || !Array.isArray(parsed.document.committees)) return null;
    return parsed;
  } catch {
    return null;
  }
}

type PendingTemplate = {
  templateKey: string;
  document: StructureDocument;
  appliedAt: number;
};

function pendingTemplateKey(unitId: string): string {
  return `smartgov:pending-template:${unitId}`;
}

function readPendingTemplate(unitId: string): PendingTemplate | null {
  try {
    const raw = localStorage.getItem(pendingTemplateKey(unitId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingTemplate>;
    if (
      typeof parsed.templateKey !== "string" ||
      !parsed.document ||
      !Array.isArray(parsed.document.committees)
    ) {
      return null;
    }
    return parsed as PendingTemplate;
  } catch {
    return null;
  }
}

function clearPendingTemplate(unitId: string): void {
  try {
    localStorage.removeItem(pendingTemplateKey(unitId));
  } catch {
    return;
  }
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
  onChange,
  onVacate,
}: {
  unitId: string;
  holder: StructureHolder;
  onChange: (next: StructureHolder) => void;
  onVacate: () => void;
}) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const email = holder.email.trim();
  const visiblePhoto = photoDataUrl(holder.photo) ?? photoUrl;

  // The stored photo is fetched from the photo route on demand. The document
  // itself only ever carries `hasPhoto`, so no read of a structure puts every
  // officer's face into a JSON payload.
  async function showStoredPhoto() {
    setNote("");
    if (!email) return;
    try {
      const url = await fetchHolderPhoto(unitId, email);
      setPhotoUrl(url);
      if (!url) setNote("No photo is on file for this person yet.");
    } catch (e) {
      setPhotoUrl(null);
      setNote(e instanceof Error && e.message.trim() ? e.message : "That photo could not be read.");
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-line bg-canvas/40 p-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="shrink-0">
          {visiblePhoto ? (
            // The bytes came from our own scoped route as a data URL; there is no
            // remote, user-controlled source here to sanitize.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={visiblePhoto} alt="" className="size-20 rounded-xl border border-line object-cover" />
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
                void persistPhoto(unitId, holder.email, base64);
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

// ---------------------------------------------------------------- NEUST samples

type SampleOfficer = {
  first: string;
  last: string;
  course?: string;
  yearLevel?: string;
};

function sampleSeat(
  key: string,
  title: string,
  tier: number,
  order: number,
  officer: SampleOfficer,
  parentKey: string | null = null,
): StructurePosition {
  const emailBase = `${officer.first}.${officer.last}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]+/g, ".")
    .replace(/^\.|\.$/g, "");
  const holder: StructureHolder = {
    email: `${emailBase}@neust.edu.ph`,
    firstName: officer.first,
    lastName: officer.last,
    fullName: `${officer.first} ${officer.last}`,
    course: officer.course,
    yearLevel: officer.yearLevel,
  };
  return {
    key,
    title,
    tier,
    order,
    parentKey,
    maxHolders: 1,
    holder,
    holders: [holder],
  };
}

function sampleTemplate(
  key: string,
  name: string,
  description: string,
  committees: StructureCommittee[],
): StructureTemplate {
  const document: StructureDocument = {
    schemaVersion: 2,
    // A smaller node keeps the whole NEUST chart readable inside a preview.
    layout: { ...DEFAULT_LAYOUT, nodeSize: "sm", tierSpacing: 0.85 },
    committees,
  };
  return {
    id: key,
    key,
    name,
    description,
    category: "NEUST sample",
    isBuiltin: false,
    document,
    committees: committees.length,
    seats: committees.reduce((sum, committee) => sum + committee.positions.length, 0),
  };
}

/**
 * These samples are deliberately not database templates. Saved templates are
 * holder-free by design: one council's officers must never ship to another.
 * A NEUST sample is a local, labelled preview that becomes an ordinary editable
 * document when someone clicks "Use this template".
 */
export const NEUST_SAMPLES: StructureTemplate[] = [
  sampleTemplate(
    "neust-usg-sample",
    "NEUST University Student Government",
    "A USG sample with sample officers, college representatives and standing committees.",
    [
      {
        key: "neust-usg-board",
        isUnit: true,
        name: "University Student Government",
        positions: [
          sampleSeat("neust-usg-president", "USG President", 0, 0, {
            first: "Juan A.",
            last: "Dela Cruz",
            course: "BS Civil Engineering",
            yearLevel: "4th Year",
          }),
          sampleSeat("neust-usg-vp-internal", "Vice President for Internal Affairs", 1, 0, {
            first: "Maria B.",
            last: "Santos",
            course: "BS Accountancy",
            yearLevel: "4th Year",
          }, "neust-usg-president"),
          sampleSeat("neust-usg-vp-external", "Vice President for External Affairs", 1, 1, {
            first: "Andrea C.",
            last: "Reyes",
            course: "BA Communication",
            yearLevel: "3rd Year",
          }, "neust-usg-president"),
          sampleSeat("neust-usg-secretary", "Secretary General", 1, 2, {
            first: "Micah D.",
            last: "Lopez",
            course: "BS Information Technology",
            yearLevel: "3rd Year",
          }, "neust-usg-president"),
          sampleSeat("neust-usg-treasurer", "Treasurer", 1, 3, {
            first: "Francis E.",
            last: "Garcia",
            course: "BS Business Administration",
            yearLevel: "4th Year",
          }, "neust-usg-president"),
          sampleSeat("neust-usg-auditor", "Auditor", 1, 4, {
            first: "Rica F.",
            last: "Mendoza",
            course: "BS Accounting Technology",
            yearLevel: "3rd Year",
          }, "neust-usg-president"),
          sampleSeat("neust-usg-pio", "Public Information Officer", 1, 5, {
            first: "Paolo G.",
            last: "Torres",
            course: "BS Journalism",
            yearLevel: "3rd Year",
          }, "neust-usg-president"),
        ],
      },
      {
        key: "neust-usg-colleges",
        name: "College Councils",
        positions: [
          sampleSeat("neust-college-engineering", "College of Engineering", 2, 0, {
            first: "Alex H.",
            last: "Rivera",
            course: "BS Mechanical Engineering",
            yearLevel: "3rd Year",
          }, "neust-usg-vp-internal"),
          sampleSeat("neust-college-business", "College of Business Administration", 2, 1, {
            first: "Bianca I.",
            last: "Cruz",
            course: "BS Marketing",
            yearLevel: "3rd Year",
          }, "neust-usg-vp-internal"),
          sampleSeat("neust-college-education", "College of Education", 2, 2, {
            first: "Camille J.",
            last: "Flores",
            course: "BSEd English",
            yearLevel: "4th Year",
          }, "neust-usg-vp-internal"),
          sampleSeat("neust-college-arts", "College of Arts and Sciences", 2, 3, {
            first: "Dennis K.",
            last: "Ramos",
            course: "BS Biology",
            yearLevel: "3rd Year",
          }, "neust-usg-vp-internal"),
          sampleSeat("neust-college-technology", "College of Technology", 2, 4, {
            first: "Erica L.",
            last: "Silva",
            course: "BS Industrial Technology",
            yearLevel: "2nd Year",
          }, "neust-usg-vp-internal"),
        ],
      },
      {
        key: "neust-usg-committees",
        name: "Standing Committees",
        positions: [
          sampleSeat("neust-committee-academic", "Academic Affairs Chair", 2, 5, {
            first: "Kevin M.",
            last: "Tan",
            course: "BS Mathematics",
            yearLevel: "3rd Year",
          }, "neust-usg-vp-external"),
          sampleSeat("neust-committee-welfare", "Student Welfare Chair", 2, 6, {
            first: "Lorraine N.",
            last: "Ocampo",
            course: "BS Psychology",
            yearLevel: "3rd Year",
          }, "neust-usg-vp-external"),
          sampleSeat("neust-committee-finance", "Finance and Audit Chair", 2, 7, {
            first: "Miguel O.",
            last: "Bautista",
            course: "BS Economics",
            yearLevel: "4th Year",
          }, "neust-usg-vp-external"),
          sampleSeat("neust-committee-comms", "Communications Chair", 2, 8, {
            first: "Nina P.",
            last: "Villanueva",
            course: "BA Broadcasting",
            yearLevel: "2nd Year",
          }, "neust-usg-vp-external"),
        ],
      },
    ],
  ),
  sampleTemplate(
    "neust-lsg-sample",
    "NEUST Local Student Government",
    "A college-level LSG sample with officers, committees and year-level representatives.",
    [
      {
        key: "neust-lsg-board",
        isUnit: true,
        name: "College Student Council",
        positions: [
          sampleSeat("neust-lsg-president", "Student Council President", 0, 0, {
            first: "Gabriel A.",
            last: "Reyes",
            course: "BS Electrical Engineering",
            yearLevel: "4th Year",
          }),
          sampleSeat("neust-lsg-vp", "Vice President", 1, 0, {
            first: "Princess B.",
            last: "Ocampo",
            course: "BS Nursing",
            yearLevel: "3rd Year",
          }, "neust-lsg-president"),
          sampleSeat("neust-lsg-secretary", "Secretary", 1, 1, {
            first: "Joshua C.",
            last: "Mendoza",
            course: "BS Computer Science",
            yearLevel: "3rd Year",
          }, "neust-lsg-president"),
          sampleSeat("neust-lsg-treasurer", "Treasurer", 1, 2, {
            first: "Alyssa D.",
            last: "Garcia",
            course: "BS Accountancy",
            yearLevel: "2nd Year",
          }, "neust-lsg-president"),
          sampleSeat("neust-lsg-auditor", "Auditor", 1, 3, {
            first: "Marcus E.",
            last: "Flores",
            course: "BS Civil Engineering",
            yearLevel: "3rd Year",
          }, "neust-lsg-president"),
          sampleSeat("neust-lsg-pio", "Public Information Officer", 1, 4, {
            first: "Stephanie F.",
            last: "Lopez",
            course: "BA Communication",
            yearLevel: "2nd Year",
          }, "neust-lsg-president"),
        ],
      },
      {
        key: "neust-lsg-committees",
        name: "Committees",
        positions: [
          sampleSeat("neust-lsg-academic", "Academic Affairs Chair", 2, 0, {
            first: "Rowena G.",
            last: "Cruz",
            course: "BSEd Mathematics",
            yearLevel: "4th Year",
          }, "neust-lsg-vp"),
          sampleSeat("neust-lsg-events", "Events Chair", 2, 1, {
            first: "Nathan H.",
            last: "Santos",
            course: "BS Tourism",
            yearLevel: "3rd Year",
          }, "neust-lsg-vp"),
          sampleSeat("neust-lsg-welfare", "Student Welfare Chair", 2, 2, {
            first: "Jasmine I.",
            last: "Ramos",
            course: "BS Social Work",
            yearLevel: "3rd Year",
          }, "neust-lsg-vp"),
          sampleSeat("neust-lsg-finance", "Finance Chair", 2, 3, {
            first: "Kevin J.",
            last: "Torres",
            course: "BS Business Administration",
            yearLevel: "2nd Year",
          }, "neust-lsg-vp"),
        ],
      },
      {
        key: "neust-lsg-reps",
        name: "Year-Level Representatives",
        positions: [
          sampleSeat("neust-lsg-year-1", "First Year Representative", 2, 4, {
            first: "Bea K.",
            last: "Villanueva",
            course: "BS Architecture",
            yearLevel: "1st Year",
          }, "neust-lsg-vp"),
          sampleSeat("neust-lsg-year-2", "Second Year Representative", 2, 5, {
            first: "Cyril L.",
            last: "Dela Cruz",
            course: "BS Information Technology",
            yearLevel: "2nd Year",
          }, "neust-lsg-vp"),
          sampleSeat("neust-lsg-year-3", "Third Year Representative", 2, 6, {
            first: "Dana M.",
            last: "Bautista",
            course: "BS Biology",
            yearLevel: "3rd Year",
          }, "neust-lsg-vp"),
          sampleSeat("neust-lsg-year-4", "Fourth Year Representative", 2, 7, {
            first: "Ethan N.",
            last: "Ocampo",
            course: "BS Mechanical Engineering",
            yearLevel: "4th Year",
          }, "neust-lsg-vp"),
        ],
      },
    ],
  ),
];

/** The preview page edits its own copy; the shipped sample stays pristine. */
export function cloneSampleDocument(sample: StructureTemplate): StructureDocument {
  return JSON.parse(JSON.stringify(sample.document)) as StructureDocument;
}

// ------------------------------------------------------------------- gallery

function TemplateGallery({
  canSaveTemplates,
  unitId,
  returnTo,
  onApply,
  onSaveCurrent,
  busy,
}: {
  canSaveTemplates: boolean;
  unitId: string;
  returnTo: string;
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
            Preview a NEUST sample, or start from a holder-free skeleton. Samples become editable
            seats when applied; saved templates never carry a person&apos;s name.
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

      <div data-tour="structure-samples" className="mt-4 border-t border-line pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Label>NEUST sample charts</Label>
          <span className="rounded-full border border-[#8a6d31]/35 bg-[#8a6d31]/[0.08] px-2.5 py-1 text-[0.625rem] font-semibold tracking-[0.08em] text-[#6b5121] uppercase">
            Sample names only
          </span>
        </div>
        <p className="text-[0.8125rem] leading-relaxed text-muted">
          Open the full structure to preview it, add officer photos, or apply it to your live draft.
          Names and NEUST emails are placeholders — replace them before saving or submitting.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {NEUST_SAMPLES.map((sample) => {
            const params = new URLSearchParams({
              template: sample.key,
              unitId,
              returnTo,
            });
            return (
              <article key={sample.key} className="rounded-xl border border-line bg-canvas/40 p-4">
                <p className="text-[0.9375rem] font-medium text-ink-deep">{sample.name}</p>
                <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">{sample.description}</p>
                <p className="mt-2 text-[0.6875rem] tracking-[0.08em] text-muted uppercase">
                  {sample.committees} branches &middot; {sample.seats} seats &middot; editable after use
                </p>
                <div className="mt-3">
                  <ButtonLink
                    href={`/structure/preview?${params.toString()}`}
                    variant="paper"
                    size="sm"
                  >
                    Preview full structure
                  </ButtonLink>
                </div>
              </article>
            );
          })}
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
                  Use this template
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

export function ApprovedViewer({
  approved,
  unitName,
}: {
  approved: StructureSummary | null | undefined;
  unitName?: string;
}) {
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

      <div className="mt-4">
        <ChartViewer
          doc={approved.document}
          title={unitName ? `${unitName} officers` : undefined}
          subtitle={`${approved.termLabel} · revision ${approved.revision}`}
          filename={`${(unitName ?? "structure").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-officers`}
          maxHeight={560}
        />
      </div>

      <div className="mt-5 flex flex-col gap-2">
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
                {c.positions.map((p) => {
                  const holders = p.holders?.length ? p.holders : p.holder ? [p.holder] : [];
                  return (
                    <li
                      key={p.key}
                      className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line/60 py-2 last:border-b-0"
                    >
                      <span className="text-[0.875rem] text-ink">{p.title}</span>
                      <span className="text-[0.8125rem] text-muted">
                        {holders.length > 1
                          ? `${holderName(holders[0])} +${holders.length - 1} co-holder${holders.length > 2 ? "s" : ""}`
                          : holderName(holders[0])}
                      </span>
                    </li>
                  );
                })}
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
  const pathname = usePathname();
  const account = useAccount();
  const returnTo = pathname.includes("manage") ? `${pathname}?tab=structure` : pathname;
  const [doc, setDoc] = useState<StructureDocument>(emptyDocument);
  const [structureId, setStructureId] = useState<string | null>(null);
  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<StructureSummary | null>(null);
  const [approved, setApproved] = useState<StructureSummary | null>(null);
  const [history, setHistory] = useState<StructureSummary[]>([]);
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
  const [readyUnitId, setReadyUnitId] = useState<string | null>(null);
  const draftKey = `smartgov:structure-draft:${unitId}`;

  // Chart builder state. The document stays the source of truth; `selected` is
  // only which seat the inspector shows.
  const [mode, setMode] = useState<"chart" | "form">("chart");
  const [selected, setSelected] = useState<string | null>(null);
  const [past, setPast] = useState<StructureDocument[]>([]);
  const [future, setFuture] = useState<StructureDocument[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ updatedAt: string } | null>(null);
  const [autosave, setAutosave] = useState<"idle" | "saving" | "saved" | "off">("idle");
  const savingRef = useRef(false);
  const hydratedPhotos = useRef(new Set<string>());
  const dirtyRef = useRef(dirty);
  const conflictRef = useRef(conflict);
  const updatedAtRef = useRef(updatedAt);
  dirtyRef.current = dirty;
  conflictRef.current = conflict;
  updatedAtRef.current = updatedAt;
  const rosterIds = useRef(new Map<string, string>());
  const rosterByEmail = useCallback((email: string): string | undefined => {
    return rosterIds.current.get(email.trim().toLowerCase());
  }, []);

  const layout = useMemo(() => normalizeLayout(doc.layout), [doc.layout]);

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
      setHistory(res.history ?? []);
      const open = res.draft ?? null;
      const stored = readStructureDraft(unitId);
      const pending = readPendingTemplate(unitId);
      if (pending) {
        // A preview page handed us an applied document. Consume it once, then
        // let the normal editing path take over: edit() queues photo uploads and
        // the draft effect writes the local draft under this unit.
        clearPendingTemplate(unitId);
        edit(normalizeDocument(pending.document));
        setStructureId(stored?.structureId ?? open?.id ?? null);
        setTemplateKey(pending.templateKey);
        setTermLabel(stored?.termLabel ?? open?.termLabel ?? "");
        setStartsOn(stored?.startsOn ?? open?.startsOn ?? "");
        setEndsOn(stored?.endsOn ?? open?.endsOn ?? "");
        setNote(stored?.note ?? open?.note ?? "");
        setUpdatedAt(stored?.serverUpdatedAt ?? open?.updatedAt ?? null);
        setAutosave("off");
        setSelected(null);
        setStatus("NEUST sample applied. Replace the sample names and emails before saving.");
        setReadyUnitId(unitId);
        return;
      }
      const serverTime = open?.updatedAt ? Date.parse(open.updatedAt) : 0;
      const restore =
        stored !== null &&
        (stored.dirty ||
          (!open && stored.document.committees.length > 0) ||
          stored.localUpdatedAt > (Number.isFinite(serverTime) ? serverTime : 0));
      setDraft(open);
      if (restore && stored) {
        setStructureId(stored.structureId);
        setDoc(normalizeDocument(stored.document));
        setTemplateKey(stored.templateKey ?? null);
        setTermLabel(stored.termLabel ?? "");
        setStartsOn(stored.startsOn ?? "");
        setEndsOn(stored.endsOn ?? "");
        setNote(stored.note ?? "");
        setUpdatedAt(stored.serverUpdatedAt);
        setDirty(stored.dirty);
        setPast([]);
        setFuture([]);
        setAutosave(stored.dirty ? "off" : "idle");
        setSelected(null);
      } else if (open) {
        setStructureId(open.id);
        setDoc(open.document);
        setTemplateKey(open.templateKey);
        setTermLabel(open.termLabel);
        setStartsOn(open.startsOn);
        setEndsOn(open.endsOn);
        setNote(open.note ?? "");
        setUpdatedAt(open.updatedAt ?? null);
        setAutosave("idle");
      } else if (res.approved) {
        // Nothing under this officer yet but something is published: start the
        // next term from what is live rather than from a blank page.
        setDoc(res.approved.document);
        setTermLabel(res.approved.termLabel);
        setStartsOn(res.approved.startsOn);
        setEndsOn(res.approved.endsOn);
      }
      setReadyUnitId(unitId);
    })();
    return () => {
      cancelled = true;
    };
  }, [unitId]);

  // Realtime carries only "a structure changed". Reload through the normal API,
  // and never overwrite edits the officer is still making in this tab.
  useRealtimeSignals(account.id, ["structure"], () => {
    if (dirtyRef.current || conflictRef.current || savingRef.current) return;
    void (async () => {
      try {
        const res = await fetchStructure(unitId);
        const open = res.draft ?? null;
        if (!open || open.updatedAt === updatedAtRef.current) return;
        setDraft(open);
        setDoc(normalizeDocument(open.document));
        setStructureId(open.id);
        setTemplateKey(open.templateKey);
        setTermLabel(open.termLabel);
        setStartsOn(open.startsOn);
        setEndsOn(open.endsOn);
        setNote(open.note ?? "");
        setUpdatedAt(open.updatedAt ?? null);
        setDirty(false);
        setPast([]);
        setFuture([]);
        setAutosave("saved");
        setStatus("Synced with the live structure.");
      } catch {
        // A failed refresh leaves the last good view untouched.
      }
    })();
  });

  useEffect(() => {
    if (!readyUnitId || readyUnitId !== unitId) return;
    const emails = new Set<string>();
    for (const holder of collectHolders(doc)) {
      const email = holder.email.trim().toLowerCase();
      if (email && holder.hasPhoto) emails.add(email);
    }
    if (!emails.size) return;
    let cancelled = false;
    void (async () => {
      for (const email of emails) {
        if (cancelled || rosterByEmail(email)) continue;
        try {
          const match = await matchHolder(unitId, email);
          if (!cancelled && match.rosterId) rosterIds.current.set(email, match.rosterId);
        } catch {
          continue;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, readyUnitId, rosterByEmail, unitId]);

  useEffect(() => {
    if (!readyUnitId || readyUnitId !== unitId) return;
    const hydrated = hydratedPhotos.current;
    const targets: StructureHolder[] = [];
    const seen = new Set<string>();
    for (const holder of collectHolders(doc)) {
      const email = holder.email.trim().toLowerCase();
      if (!email || !holder.hasPhoto || holder.photo || seen.has(email)) continue;
      const key = `${unitId}:${email}`;
      if (hydrated.has(key)) continue;
      hydrated.add(key);
      seen.add(email);
      targets.push(holder);
    }
    if (!targets.length) return;
    let cancelled = false;
    let settled = false;
    void (async () => {
      const found = await loadStoredPhotos(unitId, targets, rosterByEmail);
      settled = true;
      if (cancelled || !Object.keys(found).length) return;
      setDoc((prev) => withStoredPhotos(prev, found));
    })();
    return () => {
      cancelled = true;
      if (settled) return;
      for (const holder of targets) {
        hydrated.delete(`${unitId}:${holder.email.trim().toLowerCase()}`);
      }
    };
  }, [doc, readyUnitId, rosterByEmail, unitId]);

  const persistDraft = useCallback(
    (next: StructureDocument, markDirty: boolean) => {
      if (readyUnitId !== unitId) return;
      const stored: StoredStructureDraft = {
        document: next,
        termLabel,
        startsOn,
        endsOn,
        note,
        templateKey,
        structureId,
        serverUpdatedAt: updatedAt,
        localUpdatedAt: Date.now(),
        dirty: markDirty,
      };
      try {
        localStorage.setItem(draftKey, JSON.stringify(stored));
      } catch {
        return;
      }
    },
    [draftKey, readyUnitId, unitId, termLabel, startsOn, endsOn, note, templateKey, structureId, updatedAt],
  );

  useEffect(() => {
    persistDraft(doc, dirty);
  }, [doc, dirty, persistDraft]);

  function edit(next: StructureDocument) {
    queuePhotoPersists(doc, next, unitId);
    setPast((prev) => [...prev.slice(-39), doc]);
    setFuture([]);
    setDoc(next);
    setDirty(true);
    setSave({ kind: "idle" });
    setConflict(null);
    persistDraft(next, true);
  }

  function undo() {
    if (!past.length) return;
    const restored = past[past.length - 1];
    setPast(past.slice(0, -1));
    setFuture([doc, ...future].slice(0, 40));
    setDoc(restored);
    setDirty(true);
    setSave({ kind: "idle" });
    setSelected(null);
  }

  function redo() {
    if (!future.length) return;
    const [restored, ...later] = future;
    setFuture(later);
    setPast([...past.slice(-39), doc]);
    setDoc(restored);
    setDirty(true);
    setSave({ kind: "idle" });
    setSelected(null);
  }

  function rememberSavedDraft(res: SaveResult) {
    const id = res.structureId;
    if (!id) return;
    const nextStatus = (res.status as StructureSummary["status"] | undefined) ?? "draft";
    setDraft((previous) => ({
      id,
      unitId,
      authorKind: previous?.authorKind ?? (capability.isReviewer ? "usg" : "lsg"),
      status: nextStatus,
      revision: res.revision ?? previous?.revision ?? 1,
      templateKey: templateKey ?? previous?.templateKey ?? null,
      termLabel: termLabel.trim() || previous?.termLabel || "",
      startsOn: startsOn || previous?.startsOn || "",
      endsOn: endsOn || previous?.endsOn || "",
      document: doc,
      note: note.trim() || null,
      submittedBy: previous?.submittedBy ?? null,
      submittedAt:
        nextStatus === "submitted"
          ? previous?.submittedAt ?? new Date().toISOString()
          : previous?.submittedAt ?? null,
      decidedBy: previous?.decidedBy ?? null,
      decidedAt: previous?.decidedAt ?? null,
      decisionRemark: previous?.decisionRemark ?? null,
      renewsId: previous?.renewsId ?? null,
      renewsTermLabel: previous?.renewsTermLabel ?? null,
      createdAt: previous?.createdAt ?? new Date().toISOString(),
      updatedAt: res.updatedAt ?? new Date().toISOString(),
    }));
  }

  /**
   * Autosave. It only runs once the draft is publishable-shaped (term set and
   * the document passes the same checks the database will run), so a half-typed
   * seat never produces a validation error the author did not ask for.
   */
  useEffect(() => {
    if (!dirty || conflict || !capability.canEdit) return;
    if (!termLabel.trim() || !startsOn || !endsOn) return;
    if (checkDocument(doc)) return;

    const timer = window.setTimeout(() => {
      void (async () => {
        if (savingRef.current) return;
        savingRef.current = true;
        setAutosave("saving");
        try {
          const res = await saveDraft({
            unitId,
            templateKey: templateKey ?? undefined,
            termLabel: termLabel.trim(),
            startsOn,
            endsOn,
            document: doc,
            note: note.trim() || undefined,
            expectedUpdatedAt: updatedAt ?? undefined,
          });
          if (!res.ok) {
            if (res.reason === "conflict") {
              setConflict({ updatedAt: typeof res.updatedAt === "string" ? res.updatedAt : "" });
            }
            setAutosave("off");
            return;
          }
          if (res.structureId) setStructureId(res.structureId);
          if (res.updatedAt) setUpdatedAt(res.updatedAt);
          rememberSavedDraft(res);
          setDirty(false);
          setAutosave("saved");
          setSave({ kind: "saved", revision: res.revision ?? 0 });
        } catch {
          setAutosave("off");
        } finally {
          savingRef.current = false;
        }
      })();
    }, 1600);

    return () => window.clearTimeout(timer);
    // `updatedAt` is intentionally not a dependency: a save that lands updates it,
    // and re-running on that change would schedule an identical save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, dirty, conflict, termLabel, startsOn, endsOn, note, templateKey, unitId, capability.canEdit]);

  // Ctrl/Cmd+Z and Ctrl/Cmd+Y, except while typing in a field.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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
        expectedUpdatedAt: updatedAt ?? undefined,
      });

      if (!res.ok) {
        if (res.reason === "conflict") {
          setConflict({ updatedAt: typeof res.updatedAt === "string" ? res.updatedAt : "" });
          setSave({ kind: "idle" });
          setAutosave("off");
          return null;
        }
        setSave({ kind: "error", message: structureError(res) });
        return null;
      }

      if (res.structureId) setStructureId(res.structureId);
      if (res.updatedAt) setUpdatedAt(res.updatedAt);
      rememberSavedDraft(res);
      setConflict(null);
      setAutosave("saved");
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
      setHistory(after.history ?? []);
      setDraft(after.draft ?? null);
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
      setHistory(after.history ?? []);
      setDraft(after.draft ?? null);
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
    return (
      <div className="flex flex-col gap-6">
        <StructureStatusTracker draft={draft} approved={approved} history={history} />
        <ApprovedViewer approved={approved} unitName={unitName} />
      </div>
    );
  }

  const busy = save.kind === "saving";

  return (
    <div className="flex flex-col gap-6">
      <StructureStatusTracker draft={draft} approved={approved} history={history} />

      <Reveal>
        <TemplateGallery
          canSaveTemplates={capability.isReviewer}
          unitId={unitId}
          returnTo={returnTo}
          busy={busy}
          onApply={(t) => {
            // The template's own keys are kept: they are stable slugs, and two
            // structures using the same ones is fine because uniqueness is per
            // document, not per unit.
            setTemplateKey(t.key);
            edit(t.document);
            setProblem(null);
            setStatus(
              t.category === "NEUST sample"
                ? "NEUST sample applied. Replace the sample names and emails before saving."
                : null,
            );
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

      <Reveal delay={0.05}>
        <Panel>
          <div data-tour="structure-mode" className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-full border border-line bg-paper p-1">
              {(["chart", "form"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  className={`rounded-full px-3.5 py-1.5 text-[0.75rem] font-medium transition-colors ${
                    mode === value ? "bg-ink text-white" : "text-ink-soft hover:text-ink"
                  }`}
                >
                  {value === "chart" ? "Chart builder" : "Classic form"}
                </button>
              ))}
            </div>
            <span className="text-[0.75rem] text-muted" aria-live="polite">
              {conflict
                ? "A newer version exists."
                : autosave === "saving"
                  ? "Saving…"
                  : autosave === "saved"
                    ? "Draft saved."
                    : autosave === "off"
                      ? "Autosave paused."
                      : dirty
                        ? "Unsaved changes."
                        : "All changes saved."}
            </span>
          </div>

          {conflict ? (
            <div className="mt-3 rounded-xl border border-[#a33a2e]/35 bg-[#a33a2e]/[0.07] px-4 py-3">
              <p className="text-[0.875rem] leading-relaxed text-[#8c3126]">
                Someone saved this structure after you opened it. Reload their version,
                or keep yours and overwrite it.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="paper"
                  size="sm"
                  onClick={async () => {
                    const after = await fetchStructure(unitId);
                    setHistory(after.history ?? []);
                    setDraft(after.draft ?? null);
                    if (after.draft) {
                      setDoc(after.draft.document);
                      setUpdatedAt(after.draft.updatedAt ?? null);
                      setTermLabel(after.draft.termLabel);
                      setStartsOn(after.draft.startsOn);
                      setEndsOn(after.draft.endsOn);
                      setNote(after.draft.note ?? "");
                      setStructureId(after.draft.id);
                      setApproved(after.approved ?? null);
                    }
                    setConflict(null);
                    setDirty(false);
                    setPast([]);
                    setFuture([]);
                    setAutosave("idle");
                    setSelected(null);
                  }}
                >
                  Reload theirs
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setConflict(null);
                    setAutosave("idle");
                    setUpdatedAt(null);
                  }}
                >
                  Keep mine
                </Button>
              </div>
            </div>
          ) : null}
        </Panel>
      </Reveal>

      {mode === "chart" ? (
        <Reveal delay={0.06}>
          <div data-tour="structure-chart" className="contents">
          <StructureChartEditor
            doc={doc}
            onChange={edit}
            layout={layout}
            onLayout={(next: StructureLayout) => edit({ ...doc, layout: next })}
            selectedKey={selected}
            onSelect={setSelected}
            canUndo={past.length > 0}
            canRedo={future.length > 0}
            onUndo={undo}
            onRedo={redo}
            busy={busy}
          />
          </div>
        </Reveal>
      ) : (
        <>
          <div className="flex flex-col gap-4">
            {doc.committees.map((c, ci) => (
              <CommitteeEditor
                key={c.key}
                unitId={unitId}
                committee={c}
                index={ci}
                total={doc.committees.length}
                drag={committeeReorder.rowProps(c.key, ci)}
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
        </>
      )}

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
