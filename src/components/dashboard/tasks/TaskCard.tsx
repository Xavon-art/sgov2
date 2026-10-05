"use client";

import {
  ASSIGNMENT_CLASS,
  ASSIGNMENT_LABEL,
  PRIORITY_CLASS,
  dueLabel,
  formatTaskDate,
  type Task,
} from "@/lib/tasks";

export type StatusChoice = "assigned" | "in_progress" | "done";

/**
 * One task and one unit's answer to it.
 *
 * `canFinish` is the difference between the two desks and it is passed in rather
 * than derived from a role here: the LSG screen leaves it false, so an officer is
 * never shown a control the database would refuse. `update_task_status` enforces
 * the same rule independently, so this is convenience, not the boundary.
 */
export function TaskCard({
  task,
  busyUnitId,
  note,
  onNote,
  onReport,
  canFinish,
  readOnly = false,
}: {
  task: Task;
  busyUnitId: string | null;
  note: string;
  onNote: (value: string) => void;
  onReport: (unitId: string, status: StatusChoice) => void;
  canFinish: boolean;
  readOnly?: boolean;
}) {
  const due = dueLabel(task);

  return (
    <li
      className={`rounded-card border bg-paper px-4 py-3 ${task.overdue ? "border-[#d9a99c]" : "border-line"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[0.9375rem]">{task.title}</p>
          <p className="mt-0.5 text-[0.8125rem] text-muted">
            {task.priority === "high" ? (
              <span className={PRIORITY_CLASS.high}>High priority · </span>
            ) : null}
            {task.dueDate ? formatTaskDate(task.dueDate) : "No deadline"}
          </p>
        </div>
        <p
          className={`text-[0.8125rem] tabular-nums ${due.late ? "text-[#a5442c]" : "text-muted"}`}
        >
          {due.text}
        </p>
      </div>

      {task.details ? (
        <p className="mt-2 text-[0.875rem] leading-relaxed text-body">{task.details}</p>
      ) : null}

      {task.totalUnits > 1 ? (
        <p className="mt-2 text-[0.8125rem] text-muted tabular-nums">
          {task.doneUnits} of {task.totalUnits} units have this done
        </p>
      ) : null}

      <ul className="mt-3 flex flex-col gap-2">
        {task.assignments.map((a) => (
          <li
            key={a.unitId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-canvas/60 px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <span className="text-[0.875rem]">{a.unitName}</span>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium ${ASSIGNMENT_CLASS[a.status]}`}
              >
                {ASSIGNMENT_LABEL[a.status]}
              </span>
            </div>

            {readOnly || a.status === "done" ? null : (
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor={`note-${task.id}-${a.unitId}`} className="sr-only">
                  Note for USG about {task.title}
                </label>
                <input
                  id={`note-${task.id}-${a.unitId}`}
                  value={note}
                  onChange={(e) => onNote(e.target.value)}
                  disabled={busyUnitId === a.unitId}
                  maxLength={200}
                  placeholder="Optional note"
                  className="min-h-11 w-full rounded-lg border border-line bg-paper px-2.5 text-[0.875rem] outline-none focus-visible:border-brass focus-visible:ring-2 focus-visible:ring-brass/40 sm:w-48"
                />
                <button
                  type="button"
                  onClick={() =>
                    onReport(a.unitId, a.status === "in_progress" ? "assigned" : "in_progress")
                  }
                  disabled={busyUnitId === a.unitId}
                  className="min-h-11 rounded-lg border border-line px-3 text-[0.875rem] transition-colors hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {a.status === "in_progress" ? "Not started" : "Started"}
                </button>
                {canFinish ? (
                  <button
                    type="button"
                    onClick={() => onReport(a.unitId, "done")}
                    disabled={busyUnitId === a.unitId}
                    className="min-h-11 rounded-lg bg-ink px-3 text-[0.875rem] text-paper transition-colors hover:bg-ink-deep disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Mark done
                  </button>
                ) : null}
              </div>
            )}
          </li>
        ))}
      </ul>
    </li>
  );
}