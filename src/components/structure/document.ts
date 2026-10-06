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

import type { StructureCommittee, StructureDocument, StructurePosition } from "@/lib/structure";

/**
 * `crypto.randomUUID` is not on `http:` origins, and the app is served over
 * plain http on a LAN address during development. A key only has to be unique
 * within one document, so a counter seeded from the clock is enough -- but the
 * prefix keeps it from colliding with anything hand-typed into a template.
 */
function nextKey(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

export function emptyPosition(): StructurePosition {
  return { key: nextKey("pos"), title: "", holder: null };
}

export function emptyCommittee(): StructureCommittee {
  return { key: nextKey("cmt"), name: "", positions: [emptyPosition()] };
}

export function emptyDocument(): StructureDocument {
  return { committees: [emptyCommittee()] };
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
  const holders = new Set<string>();

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

    const positionKeys = new Set<string>();
    for (let pi = 0; pi < c.positions.length; pi++) {
      const p = c.positions[pi];
      if (positionKeys.has(p.key)) {
        return {
          message: `${c.name} has two positions sharing the key ${p.key}.`,
          at: { committee: ci, position: pi },
        };
      }
      positionKeys.add(p.key);

      if (!p.title.trim()) {
        return { message: `${c.name} has a position with no title.`, at: { committee: ci, position: pi } };
      }

      const h = p.holder;
      if (!h) continue;

      if (!h.email.trim()) {
        return {
          message: `${p.title} needs the holder's email.`,
          at: { committee: ci, position: pi },
        };
      }
      if (!h.firstName?.trim() || !h.lastName?.trim()) {
        // Matches `gov_document_valid`: a holder is a person on a roll, and a
        // person needs a name to go on it.
        return {
          message: `${p.title} needs the holder's first and last name.`,
          at: { committee: ci, position: pi },
        };
      }
      if (holders.has(h.email.trim().toLowerCase())) {
        return {
          message: `${h.email.trim()} is already an officer in another position.`,
          at: { committee: ci, position: pi },
        };
      }
      holders.add(h.email.trim().toLowerCase());
    }
  }

  return null;
}