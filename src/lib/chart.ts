import { callRpc } from "@/lib/auth/rpc";

/**
 * Field-for-field mirror of the jsonb `smartgov.unit_chart` assembles in
 * `supabase/migrations/20260101000800_unit_chart_functions.sql`. Postgres emits
 * these keys in camelCase, so nothing is renamed on the way in: a divergence
 * from the migration shows up as `undefined` in the markup rather than as a
 * type error at the call site.
 */
export type ChartScope = "organization" | "unit";

/** The parentless unit the chart hangs from. Null when the org has no such row. */
export type ChartRoot = {
  id: string;
  name: string;
  unitType: string;
};

/**
 * One enabled position on a unit. Every field past `label` is null while the
 * seat is empty: the aggregate left-joins the membership, so a vacant seat is
 * still a row rather than a gap in the list.
 */
export type ChartSeat = {
  positionId: string;
  label: string;
  rosterId: string | null;
  fullName: string | null;
  email: string | null;
  membershipId: string | null;
  startDate: string | null;
};

export type ChartUnit = {
  id: string;
  name: string;
  unitType: string;
  parentId: string | null;
  seats: ChartSeat[];
};

/** The organization template: the positions any unit may enable. */
export type ChartPosition = {
  id: string;
  label: string;
  sortOrder: number;
};

export type UnitChart = {
  scope: ChartScope;
  root: ChartRoot | null;
  units: ChartUnit[];
  positions: ChartPosition[];
};

/** One person on the organization roster, as `public.list_roster` returns it. */
export type RosterEntry = {
  rosterId: string;
  fullName: string;
  email: string;
};

/** The function answers one of two shapes: a chart, or a machine reason. */
export type ChartResponse = ({ ok: true } & UnitChart) | { ok: false; reason: string };

type RosterResponse = { ok: true; roster: RosterEntry[] } | { ok: false; reason: string };

const UNIT_TYPE_LABELS: Record<string, string> = {
  usg: "University Student Government",
  lsg: "Local Student Government",
  council: "Council",
  college: "College",
  campus: "Campus",
  department: "Department",
};

/**
 * `public.unit_type` is a Postgres enum, so a value added by a later migration
 * arrives here untyped and the fallback keeps it on screen instead of blank.
 */
export function unitTypeLabel(unitType: string | null | undefined): string {
  if (!unitType) return "Unit";
  return UNIT_TYPE_LABELS[unitType] ?? unitType;
}

/**
 * Reads the caller's chart answer verbatim, or null when the call itself
 * failed. Unlike `fetchUnitChart`, a refused call keeps its `reason`, so a
 * page can tell "this officer holds no seat" from "the database is down" --
 * the two render differently, and collapsing them would pick one state for
 * both.
 */
export async function fetchUnitChartResult(
  sessionToken: string,
): Promise<ChartResponse | null> {
  try {
    return await callRpc<ChartResponse>("unit_chart", {
      p_session_token: sessionToken,
    });
  } catch (error) {
    console.error("[org-chart:read]", error);
    return null;
  }
}

/**
 * Reads the caller's chart, or null when it could not be read.
 *
 * A null answer is deliberately indistinguishable between a refused call and an
 * unreachable database: the page renders one state for both, and `reason` -- a
 * machine code that never reaches a person -- goes to the server log only.
 */
export async function fetchUnitChart(sessionToken: string): Promise<UnitChart | null> {
  const payload = await fetchUnitChartResult(sessionToken);

  if (!payload?.ok) {
    console.error(`[org-chart:read] refused: ${payload?.reason ?? "unknown"}`);
    return null;
  }

  return payload;
}

/**
 * Narrows a chart to the LSG-officer scope, the only scope the council page
 * renders. The database has already excluded every unit but the caller's own
 * and its parent, so a chart that fails this guard is never drawn there.
 */
export function isUnitScopeChart(chart: UnitChart): chart is UnitChart & { scope: "unit" } {
  return chart.scope === "unit";
}

/**
 * Reads the organization roster for the seat-assignment picker, or null when
 * it could not be read.
 *
 * A missing `public.list_roster` -- the migration that creates it not yet
 * applied -- reaches here as a thrown transport error rather than a refused
 * call, and is deliberately the same null as any other failure: the chart
 * still renders and only the assign-existing option degrades.
 */
export async function fetchRoster(sessionToken: string): Promise<RosterEntry[] | null> {
  let payload: RosterResponse;

  try {
    payload = await callRpc<RosterResponse>("list_roster", {
      p_session_token: sessionToken,
    });
  } catch (error) {
    console.error("[roster:read]", error);
    return null;
  }

  if (!payload?.ok) {
    console.error(`[roster:read] refused: ${payload?.reason ?? "unknown"}`);
    return null;
  }

  return payload.roster ?? [];
}
