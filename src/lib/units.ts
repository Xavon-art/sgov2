export type UnitType = "college" | "campus" | "department";

export type DraftUnit = { name: string; type: UnitType };

const UNIT_TYPES: UnitType[] = ["college", "campus", "department"];

/** How a unit's type is written for a person, since the draft stores it lowercase. */
export const UNIT_TYPE_LABELS: Record<UnitType, string> = {
  college: "College",
  campus: "Campus",
  department: "Department",
};

function asUnitType(value: string): UnitType | null {
  const normalized = value.trim().toLowerCase();
  return UNIT_TYPES.find((type) => type === normalized) ?? null;
}

/**
 * Guesses a unit's type from its own name, so a pasted line that says nothing
 * about its type still lands as something usable.
 *
 * Matching is on containment rather than equality: institutions write "Baguio
 * Campus" and "Nursing Department", not the bare type. Campus is tested before
 * department because a name can carry both words ("College Campus Support
 * Office") and the campus reading is the one that changes the org chart.
 */
export function inferUnitType(name: string): UnitType {
  const normalized = name.trim().toLowerCase();
  if (normalized.includes("campus")) return "campus";
  if (normalized.includes("department")) return "department";
  return "college";
}

/**
 * Turns a pasted block of text into draft units, one per line.
 *
 * A university with 20 colleges and 4 campuses should not cost 24 rounds of
 * typing, so the wizard accepts a whole roster at once. A line may declare its
 * type after an em dash or a spaced hyphen ("College of Engineering — college");
 * when it does not, the separator is treated as part of the name because
 * institutions put hyphens in unit names ("College of Veterinary Medicine -
 * vetmed") and guessing there would rename their unit.
 */
export function parseBulkUnits(text: string): DraftUnit[] {
  const units: DraftUnit[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const [head, tail] = line.split(/—| - /, 2);
    const declared = tail === undefined ? null : asUnitType(tail);

    units.push(
      declared
        ? { name: head.trim(), type: declared }
        : { name: line, type: inferUnitType(line) },
    );
  }

  return units;
}

/**
 * A federated government with no units has nothing to govern, and two units
 * under the same name would render as one indistinguishable row, so both are
 * refused before the draft is submitted.
 */
export function validateUnits(
  units: DraftUnit[],
): { ok: true } | { ok: false; reason: string } {
  if (units.length === 0) {
    return { ok: false, reason: "at_least_one" };
  }

  const seen = new Set<string>();
  for (const unit of units) {
    const key = unit.name.trim().toLowerCase();
    if (seen.has(key)) {
      return { ok: false, reason: "duplicate" };
    }
    seen.add(key);
  }

  return { ok: true };
}
