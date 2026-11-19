export const MONITORING_STATUSES = [
  "pending",
  "under_review",
  "approved",
  "returned",
  "rejected",
  "cancelled",
] as const;

export type MonitoringStatus = (typeof MONITORING_STATUSES)[number];

export type StatusCounts = Record<MonitoringStatus, number>;

export type MonitoringModule = {
  key: string;
  label: string;
  total: number;
  statuses: StatusCounts;
};

export type MonitoringCampus = {
  unitId: string;
  unitName: string;
  totals: StatusCounts;
  modules: MonitoringModule[];
};

export type MonitoringPayload = {
  ok: true;
  campuses: MonitoringCampus[];
  totals: StatusCounts;
};

export function emptyStatusCounts(): StatusCounts {
  return {
    pending: 0,
    under_review: 0,
    approved: 0,
    returned: 0,
    rejected: 0,
    cancelled: 0,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : 0;
}

function parseStatusCounts(value: unknown): StatusCounts {
  const source = isObject(value) ? value : {};
  const result = emptyStatusCounts();
  for (const status of MONITORING_STATUSES) {
    result[status] = count(source[status]);
  }
  return result;
}

function parseModule(value: unknown): MonitoringModule | null {
  if (!isObject(value) || typeof value.key !== "string" || !value.key) return null;
  return {
    key: value.key,
    label: typeof value.label === "string" && value.label ? value.label : value.key,
    total: count(value.total),
    statuses: parseStatusCounts(value.statuses),
  };
}

function parseCampus(value: unknown): MonitoringCampus | null {
  if (!isObject(value)) return null;
  if (typeof value.unitId !== "string" || !value.unitId) return null;
  if (typeof value.unitName !== "string" || !value.unitName) return null;
  if (!Array.isArray(value.modules)) return null;

  const modules = value.modules.map(parseModule).filter((module): module is MonitoringModule => Boolean(module));
  return {
    unitId: value.unitId,
    unitName: value.unitName,
    totals: parseStatusCounts(value.totals),
    modules,
  };
}

export function parseMonitoringPayload(value: unknown): MonitoringPayload | null {
  if (!isObject(value) || value.ok !== true || !Array.isArray(value.campuses)) return null;

  const campuses = value.campuses.map(parseCampus).filter((campus): campus is MonitoringCampus => Boolean(campus));
  return {
    ok: true,
    campuses,
    totals: parseStatusCounts(value.totals),
  };
}

function csvCell(value: string | number): string {
  const text = String(value);
  const safe = typeof value === "string" && /^[=+@-]/.test(text.trimStart()) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function monitoringCsv(payload: MonitoringPayload): string {
  const rows: Array<Array<string | number>> = [
    ["Campus", "Module", ...MONITORING_STATUSES.map((status) => status.replace(/_/g, " ")), "Total"],
  ];

  for (const campus of payload.campuses) {
    for (const entry of campus.modules) {
      rows.push([
        campus.unitName,
        entry.label,
        ...MONITORING_STATUSES.map((status) => entry.statuses[status]),
        entry.total,
      ]);
    }
  }

  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
