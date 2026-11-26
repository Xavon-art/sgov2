"use client";

import { selectClass } from "@/components/dashboard/workspace-shared";
import { Button } from "@/components/ui/Button";

export type RequestFilterState = {
  status: string;
  campus: string;
  unit: string;
  dueFrom: string;
  dueTo: string;
  overdue: "all" | "yes" | "no";
};

export const EMPTY_REQUEST_FILTERS: RequestFilterState = {
  status: "all",
  campus: "",
  unit: "",
  dueFrom: "",
  dueTo: "",
  overdue: "all",
};

export function RequestFilterBar({
  value,
  onChange,
  isUsg,
  campuses,
  units,
}: {
  value: RequestFilterState;
  onChange: (next: RequestFilterState) => void;
  isUsg: boolean;
  campuses: string[];
  units: Array<{ id: string; name: string }>;
}) {
  const patch = (next: Partial<RequestFilterState>) => onChange({ ...value, ...next });

  return (
    <div className="grid gap-2 rounded-2xl border border-line bg-paper/70 p-3 text-sm sm:flex sm:flex-wrap sm:items-end">
      <label className="grid min-w-[9rem] gap-1 text-muted">
        <span>Status</span>
        <select
          aria-label="Status"
          value={value.status}
          onChange={(event) => patch({ status: event.target.value })}
          className={selectClass}
        >
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="pending">Pending</option>
          <option value="under_review">Under review</option>
          <option value="overdue">Overdue</option>
          <option value="returned">Returned</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="closed">Closed</option>
        </select>
      </label>

      {isUsg ? (
        <label className="grid min-w-[9rem] gap-1 text-muted">
          <span>Campus</span>
          <select
            aria-label="Campus"
            value={value.campus}
            onChange={(event) => patch({ campus: event.target.value })}
            className={selectClass}
          >
            <option value="">All campuses</option>
            {campuses.map((campus) => (
              <option key={campus} value={campus}>
                {campus}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {isUsg ? (
        <label className="grid min-w-[9rem] gap-1 text-muted">
          <span>Unit</span>
          <select
            aria-label="Unit"
            value={value.unit}
            onChange={(event) => patch({ unit: event.target.value })}
            className={selectClass}
          >
            <option value="">All units</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="grid min-w-[9rem] gap-1 text-muted">
        <span>Due from</span>
        <input
          aria-label="Due from"
          type="date"
          value={value.dueFrom}
          onChange={(event) => patch({ dueFrom: event.target.value })}
          className={selectClass}
        />
      </label>

      <label className="grid min-w-[9rem] gap-1 text-muted">
        <span>Due to</span>
        <input
          aria-label="Due to"
          type="date"
          value={value.dueTo}
          onChange={(event) => patch({ dueTo: event.target.value })}
          className={selectClass}
        />
      </label>

      <label className="grid min-w-[9rem] gap-1 text-muted">
        <span>Overdue</span>
        <select
          aria-label="Overdue"
          value={value.overdue}
          onChange={(event) => patch({ overdue: event.target.value as RequestFilterState["overdue"] })}
          className={selectClass}
        >
          <option value="all">All</option>
          <option value="yes">Overdue</option>
          <option value="no">Not overdue</option>
        </select>
      </label>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onChange(EMPTY_REQUEST_FILTERS)}
        className="self-end text-sm"
      >
        Clear filters
      </Button>
    </div>
  );
}

export function filterTasksByRequestFilters<T>(
  tasks: T[],
  filters: RequestFilterState,
  read: (task: T) => {
    status?: string | null;
    dueDate?: string | null;
    overdue?: boolean;
    isClosed?: boolean;
    assignmentUnitIds?: string[];
    assignmentUnitNames?: string[];
  },
): T[] {
  const dueDay = (value: string | null | undefined) =>
    typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : "";

  return tasks.filter((task) => {
    const info = read(task);
    const status = (info.status ?? "").toLowerCase();

    if (filters.status && filters.status !== "all") {
      if (filters.status === "open") {
        if (info.isClosed || status === "closed" || status === "approved" || status === "rejected") return false;
      } else if (status !== filters.status.toLowerCase()) {
        return false;
      }
    }

    if (filters.overdue === "yes" && info.overdue !== true) return false;
    if (filters.overdue === "no" && info.overdue !== false) return false;

    const day = dueDay(info.dueDate);
    if (filters.dueFrom && (!day || day < filters.dueFrom)) return false;
    if (filters.dueTo && (!day || day > filters.dueTo)) return false;

    if (filters.campus) {
      const campus = filters.campus.toLowerCase();
      const names = info.assignmentUnitNames ?? [];
      if (!names.some((name) => name.toLowerCase().includes(campus))) return false;
    }

    if (filters.unit && !(info.assignmentUnitIds ?? []).includes(filters.unit)) return false;

    return true;
  });
}
