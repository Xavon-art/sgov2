"use client";

/**
 * Editing a structure document in the browser.
 *
 * The document is edited locally and only ever sent whole, because the database
 * validates it as a whole: it is the same `{ committees: [...] }` the SQL reads,
 * with the same rules, and nothing is persisted row-by-row while a person types.
 *
 * Two invariants are enforced here rather than left to the round trip, because
 * both are cheap to keep and expensive to discover late:
 *
 *   1. `keys` are generated once per committee and position and never reused when
 *      a row is deleted, so a committee cannot be deleted and recreated into the
 *      same key and quietly merge two histories.
 *   2. At most one committee carries `isUnit`, and only the first may. The
 *      database refuses anything else, so the UI never offers it.
 */

import {
  DEFAULT_LAYOUT,
  type StructureCommittee,
  type StructureDocument,
  type StructureHolder,
  type StructureLayout,
  type StructurePosition,
} from "@/lib/structure";

/**
 * `crypto.randomUUID` is not on `http:` origins, and the app is served over
 * plain http on a LAN address during development. A key only has to be unique
 * within one document, so a counter seeded from the clock is enough -- but the
 * prefix keeps it from colliding with anything hand-typed into a template.
 */
export function nextKey(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

export function emptyPosition(tier = 0, order = 0): StructurePosition {
  return { key: nextKey("pos"), title: "", holder: null, tier, order, maxHolders: 1 };
}

export function emptyCommittee(): StructureCommittee {
  return { key: nextKey("cmt"), name: "", positions: [emptyPosition()] };
}

export function emptyDocument(): StructureDocument {
  return {
    schemaVersion: 2,
    layout: { ...DEFAULT_LAYOUT },
    committees: [emptyCommittee()],
  };
}

/**
 * The one writer of the paired holder fields. The classic form, the chart
 * builder, hydration and templates all come through here, so `holder` is always
 * `holders[0]` (or null on a vacant seat). Pass no list to derive it from the
 * position; pass `[]` to make a holder-free copy.
 */
export function withSyncedHolders(
  position: StructurePosition,
  holders?: StructureHolder[] | StructureHolder | null,
): StructurePosition {
  const list =
    holders === undefined
      ? position.holders?.length
        ? position.holders.slice()
        : position.holder
          ? [position.holder]
          : []
      : Array.isArray(holders)
        ? holders.slice()
        : holders
          ? [holders]
          : [];
  return { ...position, holder: list[0] ?? null, holders: list };
}

/** Applies the holder sync to every seat in a document. */
export function syncDocumentHolders(
  doc: StructureDocument,
  holders?: StructureHolder[] | StructureHolder | null,
): StructureDocument {
  return {
    ...doc,
    committees: doc.committees.map((committee) => ({
      ...committee,
      positions: committee.positions.map((position) => withSyncedHolders(position, holders)),
    })),
  };
}

/** Mirrors the server's email check so an obviously bad address never autosaves. */
export function validEmail(value: string): boolean {
  const email = value.trim();
  return email.length > 0 && email.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(email);
}

/** Unknown or partial layouts fall back field by field, never wholesale. */
export function normalizeLayout(raw?: Partial<StructureLayout> | null): StructureLayout {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_LAYOUT };
  const templates = ["hierarchy", "pyramid", "matrix", "columns", "radial", "compact"];
  const themes = ["parchment", "ink", "brass", "slate"];
  const sizes = ["sm", "md", "lg"];
  return {
    template: templates.includes(raw.template as string)
      ? (raw.template as StructureLayout["template"])
      : DEFAULT_LAYOUT.template,
    orientation: raw.orientation === "horizontal" ? "horizontal" : "vertical",
    theme: themes.includes(raw.theme as string)
      ? (raw.theme as StructureLayout["theme"])
      : DEFAULT_LAYOUT.theme,
    showPhotos: raw.showPhotos !== false,
    showTitles: raw.showTitles !== false,
    tierSpacing:
      typeof raw.tierSpacing === "number" && Number.isFinite(raw.tierSpacing)
        ? Math.min(2, Math.max(0.6, raw.tierSpacing))
        : DEFAULT_LAYOUT.tierSpacing,
    nodeSize: sizes.includes(raw.nodeSize as string)
      ? (raw.nodeSize as StructureLayout["nodeSize"])
      : DEFAULT_LAYOUT.nodeSize,
  };
}

export function holderName(holder: StructureHolder | null | undefined): string {
  if (!holder) return "";
  const flag = holder.firstName || holder.lastName
    ? [holder.firstName, holder.middleName, holder.lastName]
        .map((part) => part?.trim())
        .filter(Boolean)
        .join(" ")
    : "";
  return (holder.fullName?.trim() || flag || holder.email).trim();
}

/**
 * The same upgrade the database performs on read, rewritten for the builder.
 *
 * It is deliberately total: a document from before the chart existed (or one
 * whose layout keys are half written) comes out renderable, and nothing is
 * dropped. The database is still the authority on validity; this only makes the
 * fields the renderer needs exist.
 */
export function normalizeDocument(
  doc: StructureDocument | null | undefined,
): StructureDocument {
  const committees = Array.isArray(doc?.committees) ? doc!.committees : [];
  const seen = new Set<string>();

  const next: StructureCommittee[] = committees.map((committee) => {
    const positions = Array.isArray(committee.positions) ? committee.positions : [];
    return {
      ...committee,
      positions: positions.map((position, pi) => {
        const raw = position as StructurePosition;
        const rawHolders = Array.isArray(raw.holders) && raw.holders.length
          ? raw.holders
          : raw.holder && typeof raw.holder === "object" && Object.keys(raw.holder).length
            ? [raw.holder]
            : [];
        const synced = withSyncedHolders(raw, rawHolders);
        const key = raw.key || nextKey("pos");
        // A duplicated key would make two nodes unaddressable; re-key the later
        // one so the builder can still point at it.
        const uniqueKey = seen.has(key) ? nextKey("pos") : key;
        seen.add(uniqueKey);
        return {
          ...raw,
          key: uniqueKey,
          title: raw.title ?? "",
          tier: Number.isFinite(raw.tier) ? Math.max(0, Math.min(12, raw.tier!)) : committee.isUnit ? 0 : 1,
          order: Number.isFinite(raw.order) ? Math.max(0, Math.min(999, raw.order!)) : pi,
          maxHolders: Number.isFinite(raw.maxHolders)
            ? Math.max(0, Math.min(20, raw.maxHolders!))
            : 1,
          holder: synced.holder,
          holders: synced.holders,
        };
      }),
    };
  });

  return {
    ...doc,
    schemaVersion: 2,
    layout: normalizeLayout(doc?.layout),
    committees: next,
  };
}

/** Every position in the document, flattened, in document order. */
export function allPositions(
  doc: StructureDocument,
): Array<{ committee: StructureCommittee; position: StructurePosition }> {
  return doc.committees.flatMap((committee) =>
    committee.positions.map((position) => ({ committee, position })),
  );
}

/** Groups the document's positions into tier rows, each sorted by `order`. */
export function tiersOf(doc: StructureDocument): StructurePosition[][] {
  const byTier = new Map<number, StructurePosition[]>();
  for (const { position } of allPositions(doc)) {
    const tier = position.tier ?? 0;
    const list = byTier.get(tier) ?? [];
    list.push(position);
    byTier.set(tier, list);
  }
  return [...byTier.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, list]) => list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
}

export function findPosition(
  doc: StructureDocument,
  key: string,
): { committee: StructureCommittee; position: StructurePosition; ci: number; pi: number } | null {
  for (let ci = 0; ci < doc.committees.length; ci++) {
    const committee = doc.committees[ci];
    for (let pi = 0; pi < committee.positions.length; pi++) {
      if (committee.positions[pi].key === key) {
        return { committee, position: committee.positions[pi], ci, pi };
      }
    }
  }
  return null;
}

/** A position with a blank title is a row the person started and did not finish. */
export function positionIncomplete(pos: StructurePosition): boolean {
  if (!pos.title.trim()) return true;
  const h = pos.holder;
  if (!h) return false;
  if (!h.email.trim()) return true;
  return !h.firstName?.trim() || !h.lastName?.trim();
}

export type DocumentProblem = {
  /** A human sentence naming what to fix, suitable to render under a form. */
  message: string;
  /** Where the problem is, so the builder can point at it. */
  at: { committee: number; position?: number } | null;
};

/**
 * Checks the document the way `gov_document_valid` does.
 *
 * This is not a replacement for that function -- it exists so the builder can
 * point at the offending row while the person is still looking at it. Anything
 * it misses is caught by the save, which is the authority.
 */
export function checkDocument(doc: StructureDocument): DocumentProblem | null {
  if (!doc.committees.length) {
    return { message: "Add at least one committee.", at: null };
  }

  if (!doc.committees[0].name.trim()) {
    return { message: "The first committee is your council: give it a name.", at: { committee: 0 } };
  }

  const committeeKeys = new Set<string>();
  const positionKeys = new Set<string>();
  const people = new Set<string>();

  const checkHolder = (
    holder: StructureHolder,
    title: string,
    at: DocumentProblem["at"],
  ): DocumentProblem | null => {
    if (!validEmail(holder.email)) {
      return { message: `${title} needs a valid email address.`, at };
    }
    if (!holder.firstName?.trim() || !holder.lastName?.trim()) {
      return { message: `${title} needs the holder's first and last name.`, at };
    }
    const email = holder.email.trim().toLowerCase();
    if (people.has(email)) {
      return { message: `${holder.email.trim()} is already an officer in another position.`, at };
    }
    people.add(email);
    return null;
  };

  for (let ci = 0; ci < doc.committees.length; ci++) {
    const c = doc.committees[ci];
    if (committeeKeys.has(c.key)) {
      return { message: `Two committees share the key ${c.key}.`, at: { committee: ci } };
    }
    committeeKeys.add(c.key);

    if (!c.name.trim()) {
      return { message: "Every committee needs a name.", at: { committee: ci } };
    }
    // The database refuses `isUnit` anywhere but the first committee, so the
    // builder never lets it be set there.
    if (ci > 0 && c.isUnit) {
      return { message: "Only the first committee can be the council itself.", at: { committee: ci } };
    }

    if (!c.positions.length) {
      return { message: `${c.name} has no positions yet.`, at: { committee: ci } };
    }

    for (let pi = 0; pi < c.positions.length; pi++) {
      const p = c.positions[pi];
      const at = { committee: ci, position: pi };

      if (positionKeys.has(p.key)) {
        return { message: `Two positions share the key ${p.key}.`, at };
      }
      positionKeys.add(p.key);

      if (!p.title.trim()) {
        return { message: `${c.name} has a position with no title.`, at };
      }

      const tier = p.tier ?? 0;
      const max = p.maxHolders ?? 1;
      if (tier < 0 || tier > 12) {
        return { message: `${p.title} is on a tier the chart cannot draw.`, at };
      }
      if ((p.order ?? 0) < 0 || (p.order ?? 0) > 999) {
        return { message: `${p.title} has an invalid position in its tier.`, at };
      }
      if (max < 0 || max > 20) {
        return { message: `${p.title} cannot allow more than 20 holders.`, at };
      }

      const holders =
        p.holders && p.holders.length
          ? p.holders
          : p.holder && Object.keys(p.holder).length
            ? [p.holder]
            : [];

      if (holders.length > max) {
        return {
          message: `${p.title} allows ${max} holder(s) but names ${holders.length}.`,
          at,
        };
      }

      for (const holder of holders) {
        const problem = checkHolder(holder, p.title, at);
        if (problem) return problem;
      }
    }
  }

  // Parent links are checked after every key is known, and a walk is used so a
  // cycle is reported where the person is rather than as a save failure.
  for (let ci = 0; ci < doc.committees.length; ci++) {
    for (let pi = 0; pi < doc.committees[ci].positions.length; pi++) {
      const p = doc.committees[ci].positions[pi];
      if (!p.parentKey) continue;
      if (!positionKeys.has(p.parentKey)) {
        return {
          message: `${p.title} reports to a position that is not in this structure.`,
          at: { committee: ci, position: pi },
        };
      }
      let walk: string | null | undefined = p.parentKey;
      for (let step = 0; walk && step < 14; step++) {
        if (walk === p.key) {
          return {
            message: `${p.title} is in a reporting loop.`,
            at: { committee: ci, position: pi },
          };
        }
        let parentKey: string | null | undefined = null;
        for (const c of doc.committees) {
          const parent = c.positions.find((x) => x.key === walk);
          if (parent) {
            parentKey = parent.parentKey;
            break;
          }
        }
        walk = parentKey;
      }
    }
  }

  return null;
}