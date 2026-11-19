/**
 * The government-structure feature's shared vocabulary.
 *
 * Two rules hold across this file, and both exist because the alternative was
 * discovered the hard way by `scripts/probe-structure.mjs`:
 *
 *   1. A document is `{ committees: [...] }`, never a bare array. Committee and
 *      position order is meaningful -- it is the render order of a published
 *      chart -- so nothing here keys a committee by index into a sorted object.
 *   2. A holder's `photo` is write-only and `holder.hasPhoto` is the read side.
 *      Bytes go up in a draft; reads carry the flag and the picture is fetched
 *      separately from `/api/structures/photos/[rosterId]`. A response that
 *      embedded base64 would put every officer's face in the JSON of every read.
 *
 * The types are exported rather than redeclared per component for the same
 * reason the dashboard's are: the builder, the queue and the viewer can only
 * disagree about this shape if it is written down three times.
 */

import type { RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";

/** One officer, as the builder holds them while editing. */
export type StructureHolder = {
  email: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  /** Display name. Derived from the parts when absent. */
  fullName?: string;
  nickname?: string;
  suffix?: string;
  /** Free-text term/promise shown under the name on a node. */
  termNote?: string;
  birthdate?: string;
  course?: string;
  yearLevel?: string;
  gender?: string;
  contactNumber?: string;
  address?: string;
  /** Write-only. Stripped by the database on save and never returned. */
  photo?: string;
  /** Read-only. True when the person already has a stored photo. */
  hasPhoto?: boolean;
};

export type StructurePosition = {
  key: string;
  title: string;
  description?: string;
  holder?: StructureHolder | null;
  /**
   * Co-holders. When present, the first entry is the seated holder and is
   * mirrored onto `holder`; the rest are displayed on the chart but do not take
   * an additional seat (the seat model allows one active holder per seat).
   */
  holders?: StructureHolder[];
  /** Chart row. 0 is the top of the tree. */
  tier?: number;
  /** Left-to-right position within a tier. */
  order?: number;
  /** The seat this one reports to, by `key`. */
  parentKey?: string | null;
  /** Optional cluster label (committee, team, block). */
  group?: string | null;
  /** How many holders the chart permits on this seat. Defaults to 1. */
  maxHolders?: number;
};

export type StructureCommittee = {
  key: string;
  name: string;
  description?: string;
  /**
   * Marks this committee as the council itself. The database refuses it on any
   * committee but the first, so the builder only ever offers it there.
   */
  isUnit?: boolean;
  positions: StructurePosition[];
};

export type ChartTemplate =
  | "hierarchy"
  | "pyramid"
  | "matrix"
  | "columns"
  | "radial"
  | "compact";

export type ChartOrientation = "vertical" | "horizontal";
export type ChartTheme = "parchment" | "ink" | "brass" | "slate";
export type ChartNodeSize = "sm" | "md" | "lg";

/** Presentation only. Never affects who is seated. */
export type StructureLayout = {
  template: ChartTemplate;
  orientation: ChartOrientation;
  theme: ChartTheme;
  showPhotos: boolean;
  showTitles: boolean;
  /** Multiplier on the gap between tiers, 0.6 - 2. */
  tierSpacing: number;
  nodeSize: ChartNodeSize;
};

export const DEFAULT_LAYOUT: StructureLayout = {
  template: "hierarchy",
  orientation: "vertical",
  theme: "parchment",
  showPhotos: true,
  showTitles: true,
  tierSpacing: 1,
  nodeSize: "md",
};

export const CHART_TEMPLATES: Array<{
  key: ChartTemplate;
  label: string;
  hint: string;
}> = [
  { key: "hierarchy", label: "Hierarchy", hint: "Tiers top-down, reporting lines drawn." },
  { key: "pyramid", label: "Pyramid", hint: "Centred rows, widest at the base." },
  { key: "matrix", label: "Matrix", hint: "Committees as columns, tiers as rows." },
  { key: "columns", label: "Columns", hint: "One vertical column per committee." },
  { key: "radial", label: "Radial", hint: "Concentric rings out from the chair." },
  { key: "compact", label: "Compact", hint: "Dense chips for large councils." },
];

export type StructureDocument = {
  committees: StructureCommittee[];
  schemaVersion?: number;
  layout?: StructureLayout;
};

/** One structure as the queue and the history list render it. */
export type StructureSummary = {
  id: string;
  unitId: string;
  authorKind: "lsg" | "usg";
  status: "draft" | "submitted" | "returned" | "approved" | "rejected" | "superseded";
  revision: number;
  templateKey: string | null;
  termLabel: string;
  startsOn: string;
  endsOn: string;
  document: StructureDocument;
  note: string | null;
  submittedBy: string | null;
  submittedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionRemark: string | null;
  renewsId: string | null;
  renewsTermLabel: string | null;
  createdAt: string;
  updatedAt: string;
  /** Added by `list_structure_queue`; absent elsewhere. */
  unitName?: string;
  unitType?: string;
  reviewable?: boolean;
};

export type StructureCapability = {
  canRead: boolean;
  canEdit: boolean;
  isReviewer: boolean;
};

/** What the dashboard's Renew button needs, without reading the whole structure. */
export type StructureRenewal = {
  canRequest: boolean;
  label: string | null;
  startsOn: string | null;
  endsOn: string | null;
  daysRemaining: number | null;
  expired: boolean | null;
};

export type StructureUnit = {
  id: string;
  name: string;
  unitType: string;
  parentId: string | null;
  parentName: string | null;
  isRoot: boolean;
};

export type StructureReadPayload = RpcResult & {
  unit?: StructureUnit;
  capability?: StructureCapability;
  draft?: StructureSummary | null;
  approved?: StructureSummary | null;
  history?: StructureSummary[];
  renewal?: StructureRenewal;
};

export type StructureTemplate = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: string;
  isBuiltin: boolean;
  /**
   * The skeleton itself, holder-free. It is safe to hand back in the list
   * precisely because a template cannot contain a holder: `import_structure_template`
   * and the builtin seeding both validate with `p_allow_holders => false`, which
   * refuses any named person. See migration 03030.
   */
  document: StructureDocument;
  committees: number;
  seats: number;
};

export type TemplatesPayload = RpcResult & { templates?: StructureTemplate[] };

export type QueuePayload = RpcResult & {
  isReviewer?: boolean;
  pending?: StructureSummary[];
  decided?: StructureSummary[];
  drafts?: StructureSummary[];
};

export type RosterSeat = {
  unitId: string;
  unitName: string;
  unitType: string;
  positionLabel: string;
};

export type RosterMember = {
  rosterId: string;
  fullName: string;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  birthdate: string | null;
  course: string | null;
  yearLevel: string | null;
  gender: string | null;
  contactNumber: string | null;
  address: string | null;
  email: string;
  hasPhoto: boolean;
  hasAccount: boolean;
  seats: RosterSeat[];
};

export type RosterPayload = RpcResult & {
  scope?: "organization" | "unit";
  roster?: RosterMember[];
};

export type HolderMatch = {
  rosterId: string | null;
  exists: boolean;
  inOrg?: boolean;
  hasPhoto?: boolean;
  seats?: RosterSeat[];
};

export type MemberPhoto = RpcResult & {
  mime?: string | null;
  bytes?: number;
  base64?: string | null;
};

export type SaveResult = RpcResult & {
  structureId?: string;
  status?: string;
  revision?: number;
  authorKind?: string;
  updatedAt?: string;
};

export type OrgStructurePayload = RpcResult & {
  unit?: { id: string; name: string; unitType: string; isRoot: boolean } | null;
  structure?: StructureSummary | null;
};

export type ReviewResult = RpcResult & {
  structureId?: string;
  status?: string;
  autoApproved?: boolean;
};

export type RenewResult = RpcResult & {
  structureId?: string;
  termLabel?: string;
  startsOn?: string;
  endsOn?: string;
  renewsId?: string;
  status?: string;
};

/**
 * The largest photo the database accepts, in bytes, from
 * `gov_document_valid`. The builder checks it before spending the upload so the
 * person finds out while the file is still open rather than after a round trip.
 */
export const MAX_PHOTO_BYTES = 524_288;

/** The validator's own wording is passed through only for these reasons. */
const VALIDATION_REASONS = new Set([
  "invalid_request",
  "duplicate_committee_key",
  "duplicate_position_key",
  "duplicate_holder",
  "invalid_parent",
  "too_many_holders",
]);

/**
 * Turns an RPC answer into the line to put under a form.
 *
 * `detail` is written by `gov_document_valid` itself, naming the committee at
 * fault, so it is far more useful than "something went wrong" -- but it is only
 * trusted for the reasons that produce one. Every other `reason` falls back to
 * the shared `messageFor` map, which is the whole reason that map exists.
 */
export function structureError(payload: RpcResult): string {
  const reason = payload.reason;
  const detail = typeof payload.detail === "string" ? payload.detail : "";
  if (detail && reason && VALIDATION_REASONS.has(reason)) return detail;
  return messageFor(reason);
}

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/structures", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof payload.message === "string" ? payload.message : `Structure request failed (${res.status}).`);
  return payload as T;
}

export async function fetchTemplates(): Promise<TemplatesPayload> {
  const res = await fetch("/api/structures?view=templates");
  return (await res.json()) as TemplatesPayload;
}

export async function fetchQueue(): Promise<QueuePayload> {
  const res = await fetch("/api/structures?view=queue");
  return (await res.json()) as QueuePayload;
}

/** The organization's published root structure, for any member. */
export async function fetchOrgStructure(): Promise<OrgStructurePayload> {
  const res = await fetch("/api/structures?view=org");
  return (await res.json()) as OrgStructurePayload;
}

export async function fetchStructure(unitId: string): Promise<StructureReadPayload> {
  const res = await fetch(`/api/structures/${encodeURIComponent(unitId)}`);
  return (await res.json()) as StructureReadPayload;
}

export async function fetchRoster(unitId: string): Promise<RosterPayload> {
  const res = await fetch(`/api/structures/${encodeURIComponent(unitId)}?view=roster`);
  return (await res.json()) as RosterPayload;
}

export async function matchHolder(unitId: string, email: string): Promise<HolderMatch> {
  const res = await fetch(
    `/api/structures/${encodeURIComponent(unitId)}?view=holder&email=${encodeURIComponent(email)}`,
  );
  return (await res.json()) as HolderMatch;
}

/**
 * Fetches one person's photo as a data URL.
 *
 * A miss is not an error: `get_member_photo` answers `ok: true` with a null
 * `base64` for somebody who has none, and an officer with no picture should show
 * initials rather than a broken image.
 */
export async function fetchMemberPhoto(rosterId: string): Promise<string | null> {
  const res = await fetch(`/api/structures/photos/${encodeURIComponent(rosterId)}`);
  const payload = (await res.json()) as MemberPhoto;
  if (!payload.ok || !payload.base64 || !payload.mime) return null;
  return `data:${payload.mime};base64,${payload.base64}`;
}

export function saveDraft(input: {
  unitId: string;
  templateKey?: string;
  termLabel: string;
  startsOn: string;
  endsOn: string;
  document: StructureDocument;
  note?: string;
  /**
   * The `updatedAt` the browser built this edit on. The database answers
   * `conflict` instead of overwriting a newer draft.
   */
  expectedUpdatedAt?: string | null;
}): Promise<SaveResult> {
  return post<SaveResult>({ action: "save", ...input });
}

export function submitDraft(structureId: string, note?: string): Promise<ReviewResult> {
  return post<ReviewResult>({ action: "submit", structureId, note });
}

export function reviewStructure(
  structureId: string,
  decision: "approved" | "returned" | "rejected",
  remark?: string,
): Promise<ReviewResult> {
  return post<ReviewResult>({ action: "review", structureId, decision, remark });
}

export function renewStructure(input: {
  unitId: string;
  termLabel?: string;
  startsOn?: string;
  endsOn?: string;
}): Promise<RenewResult> {
  return post<RenewResult>({ action: "renew", ...input });
}

export type TemplateResult = RpcResult & { key?: string; name?: string };

/**
 * Saves the current shape as a reusable template.
 *
 * Named for the SQL function it calls, which is misleading on both sides:
 * `import_structure_template` is an upsert *into* the gallery and never returns a
 * document, and reading a template is `fetchTemplates`. It is USG-side only, so
 * the builder hides the button from anyone the database would refuse.
 */
export function saveTemplate(input: {
  key: string;
  name: string;
  description?: string;
  category: string;
  document: StructureDocument;
}): Promise<TemplateResult> {
  return post<TemplateResult>({ action: "template", ...input });
}