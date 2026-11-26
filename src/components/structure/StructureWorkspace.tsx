"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useOptionalAccount } from "@/components/dashboard/dashboard-context";
import { useRealtimeSignals } from "@/lib/realtime";
import {
  checkDocument,
  emptyCommittee,
  emptyDocument,
  emptyPosition,
  normalizeDocument,
  normalizeLayout,
  syncDocumentHolders,
  validEmail,
  withSyncedHolders,
} from "@/components/structure/document";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Reveal } from "@/components/fx/Reveal";
import { RowReorder } from "@/components/structure/RowReorder";
import { useReorder, type ReorderRow } from "@/components/structure/reorder";
import { StructureChartEditor, withoutCommittee } from "@/components/structure/StructureChartEditor";
import { invalidateStructurePhotoCache } from "@/components/structure/StructureChart";
import { ChartViewer } from "@/components/structure/ChartViewer";
import { StructureStatusTracker } from "@/components/structure/StructureStatusTracker";
import {
  DEFAULT_LAYOUT,
  MAX_PHOTO_BYTES,
  STRUCTURE_FORMAT_LABELS,
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
  type StructureFormat,
  type StructureHolder,
  type StructureLayout,
  type StructurePosition,
  type StructureRenewal,
  type StructureScope,
  type StructureSummary,
  type StructureTemplate,
} from "@/lib/structure";

const DEFAULT_TERM_LABEL = "Current term";

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

/** The document half of the save checks, shared by drafts and templates. */
function documentProblem(doc: StructureDocument): string | null {
  if (doc.committees.length < 1 || doc.committees.length > 30) {
    return "A structure needs between 1 and 30 committees.";
  }

  const found = checkDocument(doc);
  if (found) return found.message;

  for (const committee of doc.committees) {
    const key = committee.key.trim();
    if (!key || key.length > 60) return "Every committee needs a key of 1 to 60 characters.";
    if (committee.name.trim().length < 1 || committee.name.trim().length > 120) {
      return "Every committee needs a name of 1 to 120 characters.";
    }
    if ((committee.description ?? "").length > 400) return "Keep each description to 400 characters.";
    if (committee.positions.length < 1 || committee.positions.length > 40) {
      return "Every committee needs between 1 and 40 seats.";
    }

    for (const position of committee.positions) {
      const positionKey = position.key.trim();
      if (!positionKey || positionKey.length > 60) return "Every seat needs a key of 1 to 60 characters.";
      const title = position.title.trim();
      if (title.length < 1 || title.length > 80) return "Every seat needs a title of 1 to 80 characters.";
      const tier = position.tier ?? 0;
      const order = position.order ?? 0;
      const maxHolders = position.maxHolders ?? 1;
      if (!Number.isInteger(tier) || tier < 0 || tier > 12) {
        return `${title} is on a tier the chart cannot draw.`;
      }
      if (!Number.isInteger(order) || order < 0 || order > 999) {
        return `${title} has an invalid position in its tier.`;
      }
      if (!Number.isInteger(maxHolders) || maxHolders < 0 || maxHolders > 20) {
        return `${title} cannot allow more than 20 holders.`;
      }
      if ([position.x ?? 0, position.y ?? 0].some((value) => !Number.isFinite(value))) {
        return `${title} has an invalid canvas position.`;
      }
      if ((position.group ?? "").length > 60) return `Keep the group for ${position.title} to 60 characters.`;

      const holders =
        position.holders?.length ? position.holders : position.holder ? [position.holder] : [];
      for (const holder of holders) {
        if (!validEmail(holder.email)) return `${position.title} needs a valid email address.`;
        if ((holder.fullName ?? "").length > 200 || (holder.nickname ?? "").length > 60 ||
            (holder.suffix ?? "").length > 20 || (holder.termNote ?? "").length > 120) {
          return `${position.title} has a holder field that is too long.`;
        }
        if (holder.birthdate && !/^\d{4}-\d{2}-\d{2}$/.test(holder.birthdate)) {
          return `${position.title} has a malformed birthdate.`;
        }
        if (holder.gender && !["female", "male", "other", "prefer_not_to_say"].includes(holder.gender)) {
          return `${position.title} has an unrecognised gender value.`;
        }
      }
    }
  }

  return null;
}

/**
 * The checks `save_structure_draft_v2` performs before it sees a document, plus
 * `documentProblem`. Autosave stays quiet while a row is half typed; Save and
 * Submit show the first problem here instead of spending a round trip to learn
 * the same thing.
 */
function validationProblem(
  doc: StructureDocument,
  termLabel: string,
  startsOn: string,
  endsOn: string,
): string | null {
  const label = termLabel.trim() || DEFAULT_TERM_LABEL;
  if (label.length > 80) return "Keep the term label to 80 characters or fewer.";
  if (!startsOn || !endsOn) return "A term needs both a start and an end date.";
  if (endsOn <= startsOn) return "The end date has to be after the start date.";
  return documentProblem(doc);
}

const DRAFT_STORAGE_VERSION = 2;
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PENDING_TEMPLATE_TTL_MS = 10 * 60 * 1000;

type StoredStructureDraft = {
  version: number;
  document: StructureDocument;
  termLabel: string;
  startsOn: string;
  endsOn: string;
  note: string;
  templateKey: string | null;
  structureId: string | null;
  serverUpdatedAt: string | null;
  localUpdatedAt: number;
  expiresAt: number;
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

function draftStorageKey(unitId: string): string {
  return `smartgov:structure-draft:${unitId}`;
}

function clearStructureDraft(unitId: string): void {
  try {
    localStorage.removeItem(draftStorageKey(unitId));
  } catch {
    return;
  }
}

function readStructureDraft(unitId: string): StoredStructureDraft | null {
  const key = draftStorageKey(unitId);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredStructureDraft>;
    const valid =
      parsed.version === DRAFT_STORAGE_VERSION &&
      typeof parsed.expiresAt === "number" &&
      Number.isFinite(parsed.expiresAt) &&
      parsed.expiresAt > Date.now() &&
      typeof parsed.dirty === "boolean" &&
      typeof parsed.localUpdatedAt === "number" &&
      Number.isFinite(parsed.localUpdatedAt) &&
      (parsed.structureId === null || typeof parsed.structureId === "string") &&
      !!parsed.document &&
      Array.isArray(parsed.document.committees);
    if (!valid) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed as StoredStructureDraft;
  } catch {
    return null;
  }
}

type PendingTemplate = {
  templateKey: string;
  scope: StructureScope;
  /** Kept for the handoff audit trail; the editor re-reads the target unit anyway. */
  format?: StructureFormat;
  category?: string;
  document: StructureDocument;
  appliedAt: number;
  /** Optional forward compatibility for a preview page that stamps the nonce itself. */
  nonce?: string;
};

type PendingNonce = {
  nonce: string;
  createdAt: number;
};

function pendingTemplateKey(unitId: string): string {
  return `smartgov:pending-template:${unitId}`;
}

function pendingNonceKey(unitId: string): string {
  return `smartgov:pending-template-nonce:${unitId}`;
}

function newPendingNonce(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * The gallery arms a one-time nonce before opening the preview. The handoff is
 * only honoured if that marker is still present and fresh, so an old payload in
 * localStorage cannot reappear as a new edit days later.
 */
function armPendingTemplate(unitId: string): void {
  try {
    const next: PendingNonce = { nonce: newPendingNonce(), createdAt: Date.now() };
    sessionStorage.setItem(pendingNonceKey(unitId), JSON.stringify(next));
  } catch {
    return;
  }
}

function readPendingNonce(unitId: string): string | null {
  try {
    const raw = sessionStorage.getItem(pendingNonceKey(unitId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingNonce>;
    if (
      typeof parsed.nonce !== "string" ||
      typeof parsed.createdAt !== "number" ||
      !Number.isFinite(parsed.createdAt) ||
      Date.now() - parsed.createdAt > PENDING_TEMPLATE_TTL_MS ||
      parsed.createdAt > Date.now() + 60_000
    ) {
      sessionStorage.removeItem(pendingNonceKey(unitId));
      return null;
    }
    return parsed.nonce;
  } catch {
    return null;
  }
}

function readPendingTemplate(unitId: string, expectedScope: StructureScope): PendingTemplate | null {
  const key = pendingTemplateKey(unitId);
  const nonce = readPendingNonce(unitId);
  try {
    const raw = localStorage.getItem(key);
    if (!raw || !nonce) return null;
    const parsed = JSON.parse(raw) as Partial<PendingTemplate>;
    if (
      typeof parsed.templateKey !== "string" ||
      (parsed.scope !== "usg" && parsed.scope !== "lsg") ||
      typeof parsed.appliedAt !== "number" ||
      !Number.isFinite(parsed.appliedAt) ||
      Date.now() - parsed.appliedAt > PENDING_TEMPLATE_TTL_MS ||
      parsed.appliedAt > Date.now() + 60_000 ||
      (typeof parsed.nonce === "string" && parsed.nonce !== nonce) ||
      !parsed.document ||
      !Array.isArray(parsed.document.committees)
    ) {
      clearPendingTemplate(unitId);
      return null;
    }
    if (parsed.scope !== expectedScope) {
      clearPendingTemplate(unitId);
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
  try {
    sessionStorage.removeItem(pendingNonceKey(unitId));
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
                invalidateStructurePhotoCache();
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
            onChange={(v) => onChange(withSyncedHolders({ ...position, title: v }))}
            placeholder="President"
          />
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={holder ? "ghost" : "paper"}
            size="sm"
            onClick={() =>
              onChange(
                withSyncedHolders(
                  position,
                  holder ? null : { email: "", firstName: "", lastName: "", hasPhoto: false },
                ),
              )
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
          onChange={(next) =>
            onChange(withSyncedHolders(position, [next, ...(position.holders?.slice(1) ?? [])]))
          }
          onVacate={() => onChange(withSyncedHolders(position, null))}
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
  scope: StructureScope,
  format: StructureFormat,
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
    scope,
    format,
    document,
    committees: committees.length,
    seats: committees.reduce((sum, committee) => sum + committee.positions.length, 0),
  };
}

type LsgSampleSpec = {
  prefix: string;
  unitName: string;
  presidentTitle: string;
  viceTitle: string;
  board: string[];
  committeeName: string;
  committees: string[];
  repsName: string;
  reps: string[];
};

const LSG_SAMPLE_OFFICERS: SampleOfficer[] = [
  { first: "Gabriel A.", last: "Reyes", course: "BS Electrical Engineering", yearLevel: "4th Year" },
  { first: "Princess B.", last: "Ocampo", course: "BS Nursing", yearLevel: "3rd Year" },
  { first: "Joshua C.", last: "Mendoza", course: "BS Computer Science", yearLevel: "3rd Year" },
  { first: "Alyssa D.", last: "Garcia", course: "BS Accountancy", yearLevel: "2nd Year" },
  { first: "Marcus E.", last: "Flores", course: "BS Civil Engineering", yearLevel: "3rd Year" },
  { first: "Stephanie F.", last: "Lopez", course: "BA Communication", yearLevel: "2nd Year" },
  { first: "Rowena G.", last: "Cruz", course: "BSEd Mathematics", yearLevel: "4th Year" },
  { first: "Nathan H.", last: "Santos", course: "BS Tourism", yearLevel: "3rd Year" },
  { first: "Jasmine I.", last: "Ramos", course: "BS Social Work", yearLevel: "3rd Year" },
  { first: "Kevin J.", last: "Torres", course: "BS Business Administration", yearLevel: "2nd Year" },
  { first: "Bea K.", last: "Villanueva", course: "BS Architecture", yearLevel: "1st Year" },
  { first: "Cyril L.", last: "Dela Cruz", course: "BS Information Technology", yearLevel: "2nd Year" },
  { first: "Dana M.", last: "Bautista", course: "BS Biology", yearLevel: "3rd Year" },
  { first: "Ethan N.", last: "Ocampo", course: "BS Mechanical Engineering", yearLevel: "4th Year" },
  { first: "Farrah O.", last: "Santos", course: "BS Psychology", yearLevel: "3rd Year" },
  { first: "Gil P.", last: "Mendoza", course: "BS Economics", yearLevel: "4th Year" },
];

/**
 * Every non-USG unit is its own council: a campus, college or department sits
 * under the USG but files its own document. These variants give each shape of
 * council a seat format without ever mixing in USG-only positions.
 */
function lsgSampleCommittees(spec: LsgSampleSpec): StructureCommittee[] {
  const officer = (index: number) => LSG_SAMPLE_OFFICERS[index % LSG_SAMPLE_OFFICERS.length];
  const committeeStart = 2 + spec.board.length;
  const repStart = committeeStart + spec.committees.length;
  const presidentKey = `${spec.prefix}-president`;
  const viceKey = `${spec.prefix}-vice`;

  return [
    {
      key: `${spec.prefix}-board`,
      isUnit: true,
      name: spec.unitName,
      positions: [
        sampleSeat(presidentKey, spec.presidentTitle, 0, 0, officer(0)),
        sampleSeat(viceKey, spec.viceTitle, 1, 0, officer(1), presidentKey),
        ...spec.board.map((title, index) =>
          sampleSeat(
            `${spec.prefix}-board-${index}`,
            title,
            1,
            index + 1,
            officer(index + 2),
            presidentKey,
          ),
        ),
      ],
    },
    {
      key: `${spec.prefix}-committees`,
      name: spec.committeeName,
      positions: spec.committees.map((title, index) =>
        sampleSeat(
          `${spec.prefix}-committee-${index}`,
          title,
          2,
          index,
          officer(committeeStart + index),
          viceKey,
        ),
      ),
    },
    {
      key: `${spec.prefix}-reps`,
      name: spec.repsName,
      positions: spec.reps.map((title, index) =>
        sampleSeat(
          `${spec.prefix}-rep-${index}`,
          title,
          2,
          spec.committees.length + index,
          officer(repStart + index),
          viceKey,
        ),
      ),
    },
  ];
}

/**
 * These samples are deliberately not database templates. Saved templates are
 * holder-free by design: one council's officers must never ship to another.
 * A NEUST sample is a local, labelled preview that becomes an ordinary editable
 * document when someone clicks "Use this template".
 */
export const NEUST_SAMPLES: StructureTemplate[] = [
  sampleTemplate(
    "usg",
    "usg",
    "neust-usg-sample",
    "NEUST University Student Government",
    "A university-level USG sample with executive officers and standing committees only.",
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
        key: "neust-usg-committees",
        name: "Standing Committees",
        positions: [
          sampleSeat("neust-committee-academic", "Academic Affairs Chair", 2, 0, {
            first: "Kevin M.",
            last: "Tan",
            course: "BS Mathematics",
            yearLevel: "3rd Year",
          }, "neust-usg-vp-external"),
          sampleSeat("neust-committee-welfare", "Student Welfare Chair", 2, 1, {
            first: "Lorraine N.",
            last: "Ocampo",
            course: "BS Psychology",
            yearLevel: "3rd Year",
          }, "neust-usg-vp-external"),
          sampleSeat("neust-committee-finance", "Finance and Audit Chair", 2, 2, {
            first: "Miguel O.",
            last: "Bautista",
            course: "BS Economics",
            yearLevel: "4th Year",
          }, "neust-usg-vp-external"),
          sampleSeat("neust-committee-comms", "Communications Chair", 2, 3, {
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
    "lsg",
    "lsg",
    "neust-lsg-sample",
    "NEUST Local Student Government",
    "A college-level LSG sample with council officers, committees and year-level representatives only.",
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
  sampleTemplate(
    "lsg",
    "campus",
    "neust-campus-lsg-sample",
    "NEUST Campus Student Government",
    "A campus-level LSG sample with campus officers, committees and college representatives.",
    lsgSampleCommittees({
      prefix: "neust-campus",
      unitName: "Campus Student Council",
      presidentTitle: "Campus Student Council President",
      viceTitle: "Vice President for Campus Affairs",
      board: ["Secretary", "Treasurer", "Auditor", "Public Information Officer"],
      committeeName: "Campus Committees",
      committees: ["Academic Affairs Chair", "Student Welfare Chair", "Events Chair", "Finance Chair"],
      repsName: "College Representatives",
      reps: [
        "College of Arts Representative",
        "College of Engineering Representative",
        "College of Business Representative",
        "College of Education Representative",
      ],
    }),
  ),
  sampleTemplate(
    "lsg",
    "college",
    "neust-college-lsg-sample",
    "NEUST College Student Government",
    "A college-level LSG sample with college officers, committees and year-level representatives.",
    lsgSampleCommittees({
      prefix: "neust-college",
      unitName: "College Student Council",
      presidentTitle: "College Student Council President",
      viceTitle: "Vice President for College Affairs",
      board: ["Secretary", "Treasurer", "Auditor", "Public Information Officer"],
      committeeName: "College Committees",
      committees: ["Academic Affairs Chair", "Events Chair", "Student Welfare Chair", "Finance Chair"],
      repsName: "Year-Level Representatives",
      reps: [
        "First Year Representative",
        "Second Year Representative",
        "Third Year Representative",
        "Fourth Year Representative",
      ],
    }),
  ),
  sampleTemplate(
    "lsg",
    "department",
    "neust-department-lsg-sample",
    "NEUST Department Student Government",
    "A department-level LSG sample with department officers, committees and year-level representatives.",
    lsgSampleCommittees({
      prefix: "neust-department",
      unitName: "Department Student Council",
      presidentTitle: "Department Student Council President",
      viceTitle: "Vice President for Department Affairs",
      board: ["Secretary", "Treasurer", "Public Information Officer"],
      committeeName: "Department Committees",
      committees: ["Academic Affairs Chair", "Research Chair", "Student Welfare Chair"],
      repsName: "Year-Level Representatives",
      reps: [
        "First Year Representative",
        "Second Year Representative",
        "Third Year Representative",
        "Fourth Year Representative",
      ],
    }),
  ),
];

/** The preview page edits its own copy; the shipped sample stays pristine. */
export function cloneSampleDocument(sample: StructureTemplate): StructureDocument {
  return JSON.parse(JSON.stringify(sample.document)) as StructureDocument;
}

/**
 * A deliberate blank option. It is not stored in the database: the document is
 * made here, in the browser, from `emptyDocument()`, so it carries no officer
 * from any other council. The scope and format come from the unit being edited,
 * never from the gallery card, so a college cannot accidentally receive the
 * USG or plain-LSG label.
 */
export const CUSTOM_TEMPLATE_KEYS: Record<StructureScope, string> = {
  usg: "custom-usg",
  lsg: "custom-lsg",
};

export function customTemplate(scope: StructureScope, format: StructureFormat): StructureTemplate {
  return {
    id: CUSTOM_TEMPLATE_KEYS[scope],
    key: CUSTOM_TEMPLATE_KEYS[scope],
    name: "Custom / Start from scratch",
    description: "A blank chart with no officers. Name the council and add your own seats.",
    category: "Custom",
    isBuiltin: false,
    scope,
    format,
    document: emptyDocument(),
    committees: 0,
    seats: 0,
  };
}

/** Used by the preview page, where the URL is untrusted and the unit is authoritative. */
export function findStructureTemplate(
  key: string | null,
  scope: StructureScope | null,
  format: StructureFormat | null,
): StructureTemplate | null {
  if (!key) return null;
  if (key === CUSTOM_TEMPLATE_KEYS.usg || key === CUSTOM_TEMPLATE_KEYS.lsg) {
    if (!scope || key !== CUSTOM_TEMPLATE_KEYS[scope]) return null;
    return customTemplate(scope, format ?? (scope === "usg" ? "usg" : "lsg"));
  }
  const candidates = scope ? NEUST_SAMPLES.filter((sample) => sample.scope === scope) : NEUST_SAMPLES;
  return candidates.find((sample) => sample.key === key) ?? null;
}

// ------------------------------------------------------------------- gallery

function TemplateGallery({
  canSaveTemplates,
  unitId,
  scope,
  format,
  returnTo,
  onApply,
  onSaveCurrent,
  busy,
}: {
  canSaveTemplates: boolean;
  unitId: string;
  scope: StructureScope;
  format: StructureFormat;
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

  // All LSG formats stay selectable: a campus, college or department is its
  // own council and may choose the seat format that fits it. Its own format
  // simply comes first in the gallery.
  const visibleSamples = NEUST_SAMPLES.filter((sample) => sample.scope === scope).sort((a, b) => {
    const aMatch = a.format === format ? 0 : 1;
    const bMatch = b.format === format ? 0 : 1;
    return aMatch - bMatch;
  });
  const scopeLabel = scope === "usg" ? "USG" : "LSG";
  const formatLabel = STRUCTURE_FORMAT_LABELS[format];
  const custom = customTemplate(scope, format);
  const customParams = new URLSearchParams({
    template: custom.key,
    unitId,
    scope: custom.scope ?? scope,
    format: custom.format ?? format,
    returnTo,
  });

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
          <Label>NEUST {scopeLabel} sample charts</Label>
          <span className="rounded-full border border-[#8a6d31]/35 bg-[#8a6d31]/[0.08] px-2.5 py-1 text-[0.625rem] font-semibold tracking-[0.08em] text-[#6b5121] uppercase">
            {scopeLabel} positions only &middot; {formatLabel} first
          </span>
        </div>
        <p className="text-[0.8125rem] leading-relaxed text-muted">
          Only {scopeLabel} charts appear here. Every unit keeps its own structure; {scope === "usg"
            ? "this is the umbrella chart."
            : "campus, college, department and local council formats are all available."} Your own
          format opens first. Preview the full chart, then apply it to this unit&rsquo;s live draft.
          Names and NEUST emails are sample values — replace them before saving.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <article
            data-template={custom.key}
            className="rounded-xl border border-line-strong bg-canvas/60 p-4"
          >
            <p className="text-[0.9375rem] font-medium text-ink-deep">{custom.name}</p>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">{custom.description}</p>
            <p className="mt-2 text-[0.6875rem] tracking-[0.08em] text-muted uppercase">
              {formatLabel} &middot; blank chart &middot; no holders
            </p>
            <p className="mt-1 text-[0.6875rem] font-semibold tracking-[0.08em] text-brass-deep uppercase">
              No sample names or emails
            </p>
            <div className="mt-3">
              <ButtonLink
                href={`/structure/preview?${customParams.toString()}`}
                variant="paper"
                size="sm"
                onClick={() => armPendingTemplate(unitId)}
              >
                Preview full structure
              </ButtonLink>
            </div>
          </article>
          {visibleSamples.map((sample) => {
            const params = new URLSearchParams({
              template: sample.key,
              unitId,
              scope: sample.scope ?? scope,
              format: sample.format ?? format,
              returnTo,
            });
            return (
              <article key={sample.key} className="rounded-xl border border-line bg-canvas/40 p-4">
                <p className="text-[0.9375rem] font-medium text-ink-deep">{sample.name}</p>
                <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">{sample.description}</p>
                <p className="mt-2 text-[0.6875rem] tracking-[0.08em] text-muted uppercase">
                  {STRUCTURE_FORMAT_LABELS[sample.format ?? format]} &middot; {sample.committees} branches &middot; {sample.seats} seats
                </p>
                {sample.format === format ? (
                  <p className="mt-1 text-[0.6875rem] font-semibold tracking-[0.08em] text-brass-deep uppercase">
                    Suggested for this unit
                  </p>
                ) : null}
                <div className="mt-3">
                  <ButtonLink
                    href={`/structure/preview?${params.toString()}`}
                    variant="paper"
                    size="sm"
                    onClick={() => armPendingTemplate(unitId)}
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
  scope,
  format,
  capability,
}: {
  unitId: string;
  unitName: string;
  scope: StructureScope;
  format: StructureFormat;
  capability: StructureCapability;
}) {
  const pathname = usePathname();
  const account = useOptionalAccount();
  const returnTo = pathname.includes("manage") ? `${pathname}?tab=structure` : pathname;
  const [doc, setDoc] = useState<StructureDocument>(emptyDocument);
  const [structureId, setStructureId] = useState<string | null>(null);
  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<StructureSummary | null>(null);
  const [approved, setApproved] = useState<StructureSummary | null>(null);
  const [history, setHistory] = useState<StructureSummary[]>([]);
  const [renewal, setRenewal] = useState<StructureRenewal | null>(null);
  const [termLabel, setTermLabel] = useState("");
  const effectiveTermLabel = termLabel.trim() || DEFAULT_TERM_LABEL;
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [note, setNote] = useState("");
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [problem, setProblem] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  // Incremented on every local edit. A save that started at version N may not
  // clear dirty or publish its token if the officer has typed version N+1.
  const [saveVersion, setSaveVersion] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [readyUnitId, setReadyUnitId] = useState<string | null>(null);
  const draftKey = draftStorageKey(unitId);

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
  const saveTailRef = useRef<Promise<void>>(Promise.resolve());
  const autosaveCancelledRef = useRef(false);
  const hydratedPhotos = useRef(new Set<string>());
  const dirtyRef = useRef(dirty);
  const conflictRef = useRef(conflict);
  const updatedAtRef = useRef(updatedAt);
  const saveVersionRef = useRef(saveVersion);
  const serverEpochRef = useRef(0);
  dirtyRef.current = dirty;
  conflictRef.current = conflict;
  updatedAtRef.current = updatedAt;
  const rosterIds = useRef(new Map<string, string>());
  const rosterByEmail = useCallback((email: string): string | undefined => {
    return rosterIds.current.get(email.trim().toLowerCase());
  }, []);

  const layout = useMemo(() => normalizeLayout(doc.layout), [doc.layout]);

  function bumpVersion(): number {
    const next = saveVersionRef.current + 1;
    saveVersionRef.current = next;
    setSaveVersion(next);
    return next;
  }

  function withSaveLock<T>(work: () => Promise<T>): Promise<T> {
    const run = saveTailRef.current.then(async () => {
      savingRef.current = true;
      try {
        return await work();
      } finally {
        savingRef.current = false;
      }
    });
    saveTailRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function markDirty() {
    bumpVersion();
    setDirty(true);
    setSave({ kind: "idle" });
    setConflict(null);
  }

  /**
   * One hydration path for renew, submit, realtime and conflict reloads. Every
   * server field the next save needs is copied back, not just the document.
   */
  function applyServerSummary(summary: StructureSummary | null | undefined, fallbackDoc?: StructureDocument) {
    bumpVersion();
    serverEpochRef.current += 1;
    setStructureId(summary?.id ?? null);
    setDoc(syncDocumentHolders(normalizeDocument(summary?.document ?? fallbackDoc ?? emptyDocument())));
    setTemplateKey(summary?.templateKey ?? null);
    setTermLabel(summary?.termLabel ?? "");
    setStartsOn(summary?.startsOn ?? "");
    setEndsOn(summary?.endsOn ?? "");
    setNote(summary?.note ?? "");
    setUpdatedAt(summary?.updatedAt ?? null);
    setDraft(summary ?? null);
    setDirty(false);
    setPast([]);
    setFuture([]);
    setAutosave("idle");
    setSelected(null);
    setConflict(null);
  }

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
      console.error("[structure:init]", JSON.stringify({ unitId, ok: res.ok, draft: res.draft?.id ?? null, approved: res.approved?.id ?? null, renewal: res.renewal }));
      const open = res.draft ?? null;
      const stored = readStructureDraft(unitId);
      const pending = readPendingTemplate(unitId, scope);
      if (pending) {
        // A preview page handed us an applied document. Consume it once, then
        // let the normal editing path take over: edit() queues photo uploads and
        // the draft effect writes the local draft under this unit.
        clearPendingTemplate(unitId);
        edit(syncDocumentHolders(normalizeDocument(pending.document)));
        setStructureId(stored?.structureId ?? open?.id ?? null);
        setTemplateKey(pending.templateKey);
        // A published chart is a template for the next structure, not a term to
        // carry forward; only a local edit or an open draft may supply a label.
        setTermLabel(stored?.termLabel ?? open?.termLabel ?? "");
        setStartsOn(stored?.startsOn ?? open?.startsOn ?? res.approved?.startsOn ?? "");
        setEndsOn(stored?.endsOn ?? open?.endsOn ?? res.approved?.endsOn ?? "");
        setNote(stored?.note ?? open?.note ?? "");
        setUpdatedAt(stored?.serverUpdatedAt ?? open?.updatedAt ?? null);
        setAutosave("off");
        setSelected(null);
        const isCustom =
          pending.category === "Custom" || pending.templateKey.startsWith("custom-");
        setStatus(
          isCustom
            ? "Blank structure started. Name the council and its seats before saving."
            : "NEUST sample applied. Replace the sample names and emails before saving.",
        );
        setReadyUnitId(unitId);
        return;
      }
      const serverTime = open?.updatedAt ? Date.parse(open.updatedAt) : 0;
      // Only a dirty draft with the same server id as the open revision may
      // come back from localStorage. An id mismatch means the draft was saved,
      // submitted or replaced in another tab, so the server copy wins.
      const restore =
        stored !== null &&
        stored.dirty === true &&
        stored.structureId === (open?.id ?? null) &&
        stored.localUpdatedAt >= (Number.isFinite(serverTime) ? serverTime : 0);
      setDraft(open);
      if (restore && stored) {
        bumpVersion();
        setStructureId(stored.structureId);
        setDoc(syncDocumentHolders(normalizeDocument(stored.document)));
        setTemplateKey(stored.templateKey ?? null);
        setTermLabel(stored.termLabel ?? "");
        setStartsOn(stored.startsOn ?? "");
        setEndsOn(stored.endsOn ?? "");
        setNote(stored.note ?? "");
        setUpdatedAt(stored.serverUpdatedAt);
        setDirty(true);
        setPast([]);
        setFuture([]);
        setAutosave("off");
        setSelected(null);
      } else {
        if (stored) clearStructureDraft(unitId);
        if (open) {
          applyServerSummary(open);
        } else if (res.approved) {
          // Nothing under this officer yet but something is published: start the
          // next term from the live chart, but ask for a fresh term label.
          bumpVersion();
          setDoc(syncDocumentHolders(normalizeDocument(res.approved.document)));
          setTemplateKey(res.approved.templateKey ?? null);
          setTermLabel("");
          setStartsOn(res.approved.startsOn);
          setEndsOn(res.approved.endsOn);
          setNote(res.approved.note ?? "");
          setUpdatedAt(null);
          setDirty(false);
          setPast([]);
          setFuture([]);
          setAutosave("idle");
        }
      }
      setReadyUnitId(unitId);
    })();
    return () => {
      cancelled = true;
    };
  }, [unitId, scope]);

  // Realtime carries only "a structure changed". Reload through the normal API,
  // and never overwrite edits the officer is still making in this tab.
  useRealtimeSignals(account?.id ?? null, ["structure"], () => {
    if (dirtyRef.current || conflictRef.current || savingRef.current) return;
    void (async () => {
      try {
        const res = await fetchStructure(unitId);
        if (!res.ok) return;
        const open = res.draft ?? null;
        setApproved(res.approved ?? null);
        setRenewal(res.renewal ?? null);
        setHistory(res.history ?? []);
        if (!open || open.updatedAt === updatedAtRef.current) return;
        applyServerSummary(open);
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
        version: DRAFT_STORAGE_VERSION,
        document: syncDocumentHolders(next),
        termLabel: effectiveTermLabel,
        startsOn,
        endsOn,
        note,
        templateKey,
        structureId,
        serverUpdatedAt: updatedAt,
        localUpdatedAt: Date.now(),
        expiresAt: Date.now() + DRAFT_TTL_MS,
        dirty: markDirty,
      };
      try {
        localStorage.setItem(draftKey, JSON.stringify(stored));
      } catch {
        return;
      }
    },
    [draftKey, readyUnitId, unitId, effectiveTermLabel, startsOn, endsOn, note, templateKey, structureId, updatedAt],
  );

  useEffect(() => {
    persistDraft(doc, dirty);
  }, [doc, dirty, persistDraft]);

  function edit(next: StructureDocument) {
    const synced = syncDocumentHolders(normalizeDocument(next));
    queuePhotoPersists(doc, synced, unitId);
    setPast((prev) => [...prev.slice(-39), doc]);
    setFuture([]);
    setDoc(synced);
    markDirty();
    persistDraft(synced, true);
  }

  function undo() {
    if (!past.length) return;
    const restored = past[past.length - 1];
    setPast(past.slice(0, -1));
    setFuture([doc, ...future].slice(0, 40));
    setDoc(restored);
    markDirty();
    setSelected(null);
  }

  function redo() {
    if (!future.length) return;
    const [restored, ...later] = future;
    setFuture(later);
    setPast([...past.slice(-39), doc]);
    setDoc(restored);
    markDirty();
    setSelected(null);
  }

  type DraftSnapshot = {
    doc: StructureDocument;
    termLabel: string;
    startsOn: string;
    endsOn: string;
    note: string;
    templateKey: string | null;
  };

  function rememberSavedDraft(res: SaveResult, saved: DraftSnapshot) {
    const id = res.structureId;
    if (!id) return;
    const nextStatus = (res.status as StructureSummary["status"] | undefined) ?? "draft";
    setDraft((previous) => ({
      id,
      unitId,
      authorKind: previous?.authorKind ?? (capability.isReviewer ? "usg" : "lsg"),
      status: nextStatus,
      revision: res.revision ?? previous?.revision ?? 1,
      templateKey: saved.templateKey ?? previous?.templateKey ?? null,
      termLabel: saved.termLabel,
      startsOn: saved.startsOn || previous?.startsOn || "",
      endsOn: saved.endsOn || previous?.endsOn || "",
      document: saved.doc,
      note: saved.note.trim() || null,
      submittedBy: previous?.submittedBy ?? null,
      submittedAt:
        nextStatus === "pending"
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
   * Autosave. It only runs once the draft is publishable-shaped (dates set and
   * the document passes the same checks the database will run), so a half-typed
   * seat never produces a validation error the author did not ask for. The term
   * label is optional; a blank label is saved as "Current term".
   */
  useEffect(() => {
    if (!dirty || conflict || !capability.canEdit || autosave === "saving") return;
    if (validationProblem(doc, effectiveTermLabel, startsOn, endsOn)) return;

    const timer = window.setTimeout(() => {
      void withSaveLock(async () => {
        if (autosaveCancelledRef.current || !dirtyRef.current || conflictRef.current || !capability.canEdit) return;
        const version = saveVersionRef.current;
        const epoch = serverEpochRef.current;
        const saved: DraftSnapshot = {
          doc: syncDocumentHolders(doc),
          termLabel: effectiveTermLabel,
          startsOn,
          endsOn,
          note,
          templateKey,
        };
        setAutosave("saving");
        try {
          const res = await saveDraft({
            unitId,
            templateKey: saved.templateKey ?? undefined,
            termLabel: saved.termLabel.trim() || DEFAULT_TERM_LABEL,
            startsOn: saved.startsOn,
            endsOn: saved.endsOn,
            document: saved.doc,
            note: saved.note.trim() || undefined,
            expectedUpdatedAt: updatedAtRef.current ?? undefined,
          });
          if (!res.ok) {
            if (epoch !== serverEpochRef.current) return;
            if (res.reason === "conflict") {
              setConflict({ updatedAt: typeof res.updatedAt === "string" ? res.updatedAt : "" });
            }
            setAutosave("off");
            return;
          }
          if (epoch !== serverEpochRef.current) return;
          if (res.structureId) setStructureId(res.structureId);
          if (res.updatedAt) setUpdatedAt(res.updatedAt);
          if (version !== saveVersionRef.current) {
            // The server has this save, but the officer typed newer changes
            // while it was in flight. Keep dirty and schedule them next.
            setAutosave("idle");
            setStatus("Saved an earlier revision; your newest changes are still unsaved.");
            return;
          }
          rememberSavedDraft(res, saved);
          setDirty(false);
          setAutosave("saved");
          setSave({ kind: "saved", revision: res.revision ?? 0 });
        } catch {
          if (epoch === serverEpochRef.current) setAutosave("off");
        }
      });
    }, 1600);

    return () => window.clearTimeout(timer);
    // `updatedAt` is deliberately not a dependency: applying the token this save
    // returns would reschedule the identical save. `saveVersion` and `autosave`
    // re-arm the timer only after a newer edit or a completed in-flight save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, dirty, conflict, autosave, saveVersion, effectiveTermLabel, startsOn, endsOn, note, templateKey, unitId, capability.canEdit]);

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
    autosaveCancelledRef.current = true;
    return withSaveLock(async () => {
      try {
      const found = validationProblem(doc, effectiveTermLabel, startsOn, endsOn);
      setProblem(found);
      if (found) return null;

      const version = saveVersionRef.current;
      const epoch = serverEpochRef.current;
      const saved: DraftSnapshot = {
        doc: syncDocumentHolders(doc),
        termLabel: effectiveTermLabel,
        startsOn,
        endsOn,
        note,
        templateKey,
      };
      setSave({ kind: "saving" });
      const res = await saveDraft({
        unitId,
        templateKey: saved.templateKey ?? undefined,
        termLabel: saved.termLabel,
        startsOn: saved.startsOn,
        endsOn: saved.endsOn,
        document: saved.doc,
        note: saved.note.trim() || undefined,
        expectedUpdatedAt: updatedAtRef.current ?? undefined,
      });

      // A renew, submit or conflict reload replaced the server view while this
      // request was in flight. Its answer no longer describes what is on screen.
      if (epoch !== serverEpochRef.current) return null;

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
      if (version !== saveVersionRef.current) {
        // The save reached the server, but newer local edits were typed while it
        // was in flight. Do not let the submit that called this send old bytes.
        setSave({ kind: "idle" });
        setAutosave("idle");
        setStatus("Saved an earlier revision; your newest changes are still unsaved.");
        return null;
      }
      rememberSavedDraft(res, saved);
      setConflict(null);
      setAutosave("saved");
      setSave({ kind: "saved", revision: res.revision ?? 0 });
      setDirty(false);
      setStatus(null);
      return res.structureId ?? structureId;
      } catch (e) {
        setSave({ kind: "error", message: e instanceof Error ? e.message : "We could not save that." });
        return null;
      } finally {
        autosaveCancelledRef.current = false;
      }
    });
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

      applyServerSummary(after.draft ?? null);
      setApproved(after.approved ?? null);
      setRenewal(after.renewal ?? null);
      setHistory(after.history ?? []);
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
      applyServerSummary(after.draft ?? null, doc);
      setApproved(after.approved ?? null);
      setRenewal(after.renewal ?? null);
      setHistory(after.history ?? []);
      setStatus(
        after.draft?.status === "pending"
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
          scope={scope}
          format={format}
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
              // A template is a skeleton: it must pass the same document checks
              // as a draft, but it never carries this council's officers.
              const templateDoc = syncDocumentHolders(doc, []);
              const found = documentProblem(templateDoc);
              if (found) {
                setProblem(found);
                return;
              }
              const rawName = window.prompt("Template name", `${unitName} structure`);
              if (!rawName) return;
              const name = rawName.trim();
              const key = name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "")
                .slice(0, 60);
              // `import_structure_template` checks 2..80 for the name and 2..60
              // for the key after trimming; catch both before the round trip.
              if (name.length < 2 || name.length > 80 || key.length < 2) {
                setProblem(
                  "Use a template name of 2 to 80 characters with at least two letters or numbers for its key.",
                );
                return;
              }
              const res = await saveTemplate({
                key,
                name,
                category: "custom",
                document: templateDoc,
              });
              setProblem(res.ok ? `Saved as "${name}".` : structureError(res));
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
                markDirty();
              }}
              placeholder="A.Y. 2026-2027"
            />
            <Field
              label="Starts"
              type="date"
              value={startsOn}
              onChange={(v) => {
                setStartsOn(v);
                markDirty();
              }}
            />
            <Field
              label="Ends"
              type="date"
              value={endsOn}
              onChange={(v) => {
                setEndsOn(v);
                markDirty();
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
                    if (!after.ok) {
                      setProblem(structureError(after));
                      return;
                    }
                    applyServerSummary(after.draft ?? null, after.approved?.document);
                    setApproved(after.approved ?? null);
                    setRenewal(after.renewal ?? null);
                    setHistory(after.history ?? []);
                    setStatus("Loaded the saved version. Your local edits were discarded.");
                  }}
                >
                  Reload theirs
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    bumpVersion();
                    setConflict(null);
                    setAutosave("idle");
                    setSave({ kind: "idle" });
                    // The next save deliberately sends no expected timestamp; the
                    // officer has seen the conflict and chosen their draft.
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
                onRemove={() => edit(withoutCommittee(doc, c.key))}
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
              markDirty();
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
