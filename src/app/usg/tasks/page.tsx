"use client";

import { useEffect, useState } from "react";
import { TaskCard, type StatusChoice } from "@/components/dashboard/tasks/TaskCard";
import { dueLabel, todayIso, type Task } from "@/lib/tasks";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; tasks: Task[] };

type Filter = "open" | "closed" | "all";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "open", label: "Still open" },
  { id: "closed", label: "Completed" },
  { id: "all", label: "All" },
];

const emptyDraft = {
  title: "",
  details: "",
  dueDate: "",
  priority: "normal",
  unitIds: [] as string[],
};

/**
 * The USG task desk: assign work, then watch each unit answer separately.
 *
 * One task to twelve units is twelve rows here, not one row with a single status,
 * which is why the progress line reads "3 of 12 units have this done". The office
 * counts compliance, and a single shared status cannot answer that.
 */
export default function UsgTasksPage() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [filter, setFilter] = useState<Filter>("open");
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [busyUnitId, setBusyUnitId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/tasks");
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setState({ kind: "error", message: data.message ?? "We could not load the tasks." });
        return;
      }
      setState({ kind: "ready", tasks: data.tasks ?? [] });
    } catch {
      setState({ kind: "error", message: "We could not reach the server. Check your connection." });
    }
  };

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/tasks");
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setState({ kind: "error", message: data.message ?? "We could not load the tasks." });
          return;
        }
        setState({ kind: "ready", tasks: data.tasks ?? [] });
      } catch {
        if (cancelled) return;
        setState({
          kind: "error",
          message: "We could not reach the server. Check your connection.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setNotice(null);

    if (draft.title.trim().length < 4) {
      setNotice({ tone: "bad", text: "Give the task a name of at least 4 characters." });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title.trim(),
          details: draft.details.trim(),
          dueDate: draft.dueDate || null,
          priority: draft.priority,
          unitIds: draft.unitIds,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setNotice({ tone: "bad", text: data.message ?? "We could not create that task." });
        return;
      }

      setNotice({
        tone: "ok",
        text: `Assigned to ${data.assignedUnits} unit${data.assignedUnits === 1 ? "" : "s"}.`,
      });
      setDraft(emptyDraft);
      setComposing(false);
      setFilter("open");
      await load();
    } catch {
      setNotice({ tone: "bad", text: "We could not reach the server. Check your connection." });
    } finally {
      setSaving(false);
    }
  }

  async function report(task: Task, unitId: string, status: StatusChoice) {
    setNotice(null);
    setBusyUnitId(unitId);
    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id, unitId, status, note: notes[unitId] ?? "" }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setNotice({ tone: "bad", text: data.message ?? "We could not save that." });
        return;
      }

      const unitName =
        task.assignments.find((a) => a.unitId === unitId)?.unitName ?? "That unit";
      setNotice({
        tone: "ok",
        text:
          status === "done"
            ? `${unitName} marked done.`
            : `${unitName} is now ${status === "in_progress" ? "in progress" : "not started"}.`,
      });
      await load();
    } catch {
      setNotice({ tone: "bad", text: "We could not reach the server. Check your connection." });
    } finally {
      setBusyUnitId(null);
    }
  }

  const tasks = state.kind === "ready" ? state.tasks : [];
  const visible = tasks.filter((t) => {
    if (filter === "all") return true;
    const closed = t.doneUnits >= t.totalUnits;
    return filter === "closed" ? closed : !closed;
  });
  const overdue = tasks.filter((t) => t.overdue);

  return (
    <section className="mx-auto w-full max-w-5xl">
      <header className="border-b border-line/80 pb-4">
        <p className="eyebrow">Tasks</p>
        <h1 className="mt-1 text-[1.5rem] leading-tight sm:text-[1.75rem]">
          What your units owe you
        </h1>
        <p className="mt-1 max-w-prose text-[0.9375rem] leading-relaxed text-body">
          Assign one task to a single unit, several, or all of them. Each unit answers
          on its own, so you can see exactly who has moved and who has not.
        </p>
      </header>

      {overdue.length > 0 ? (
        <div className="mt-5 rounded-card border border-[#d9a99c] bg-[#a5442c]/[0.05] px-4 py-3">
          <p className="text-[0.9375rem] leading-relaxed text-[#a5442c]">
            {overdue.length} task{overdue.length === 1 ? " is" : "s are"} past the
            deadline and not yet done.
          </p>
        </div>
      ) : null}

      <div aria-live="polite" className="mt-4 min-h-6">
        {notice ? (
          <p
            className={
              notice.tone === "ok"
                ? "text-[0.9375rem] text-ink"
                : "text-[0.9375rem] text-brass-deep"
            }
          >
            {notice.text}
          </p>
        ) : null}
      </div>

      {!composing ? (
        <button
          type="button"
          onClick={() => setComposing(true)}
          className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-ink px-4 text-[0.9375rem] text-paper transition-colors hover:bg-ink-deep"
        >
          Assign a task
        </button>
      ) : (
        <form onSubmit={create} className="mt-4 flex flex-col gap-4">
          <div className="rounded-card border border-line bg-paper p-4">
            <div className="flex flex-col gap-4">
              <div>
                <label htmlFor="task-title" className="block text-[0.8125rem] font-medium">
                  What has to be done
                </label>
                <input
                  id="task-title"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  disabled={saving}
                  maxLength={140}
                  placeholder="Liquidate the tickets"
                  className="mt-1.5 min-h-11 w-full rounded-lg border border-line bg-canvas px-3 text-[0.9375rem] outline-none focus-visible:border-brass focus-visible:ring-2 focus-visible:ring-brass/40"
                />
              </div>

              <div>
                <label
                  htmlFor="task-details"
                  className="flex items-baseline justify-between gap-3 text-[0.8125rem] font-medium"
                >
                  <span>Details</span>
                  <span className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-faint">
                    Optional
                  </span>
                </label>
                <textarea
                  id="task-details"
                  value={draft.details}
                  onChange={(e) => setDraft({ ...draft, details: e.target.value })}
                  disabled={saving}
                  rows={2}
                  maxLength={1000}
                  placeholder="Bring them to the office and get a receipt."
                  className="mt-1.5 w-full resize-y rounded-lg border border-line bg-canvas px-3 py-2.5 text-[0.9375rem] leading-relaxed outline-none focus-visible:border-brass focus-visible:ring-2 focus-visible:ring-brass/40"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="task-due"
                    className="flex items-baseline justify-between gap-3 text-[0.8125rem] font-medium"
                  >
                    <span>Deadline</span>
                    <span className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-faint">
                      Optional
                    </span>
                  </label>
                  <input
                    id="task-due"
                    type="date"
                    value={draft.dueDate}
                    min={todayIso()}
                    onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })}
                    disabled={saving}
                    className="mt-1.5 min-h-11 w-full rounded-lg border border-line bg-canvas px-3 text-[0.9375rem] outline-none focus-visible:border-brass focus-visible:ring-2 focus-visible:ring-brass/40"
                  />
                </div>

                <div>
                  <label htmlFor="task-priority" className="block text-[0.8125rem] font-medium">
                    Priority
                  </label>
                  <select
                    id="task-priority"
                    value={draft.priority}
                    onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
                    disabled={saving}
                    className="mt-1.5 min-h-11 w-full rounded-lg border border-line bg-canvas px-3 text-[0.9375rem] outline-none focus-visible:border-brass focus-visible:ring-2 focus-visible:ring-brass/40"
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>

              <fieldset>
                <legend className="text-[0.8125rem] font-medium">Which units</legend>
                <p className="mt-1 text-[0.8125rem] text-muted">
                  Leave every box unticked to send this to all of them.
                </p>
                <UnitPicker
                  tasks={tasks}
                  selected={draft.unitIds}
                  onChange={(unitIds) => setDraft({ ...draft, unitIds })}
                />
              </fieldset>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex min-h-11 items-center rounded-lg bg-ink px-4 text-[0.9375rem] text-paper transition-colors hover:bg-ink-deep disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Assigning..." : "Assign the task"}
            </button>
            <button
              type="button"
              onClick={() => {
                setComposing(false);
                setNotice(null);
              }}
              disabled={saving}
              className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-[0.9375rem] transition-colors hover:bg-canvas disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-b border-line/80 pb-3">
        <h2 className="text-[1.125rem] leading-tight">Tasks</h2>
        <div role="group" aria-label="Filter tasks" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={`min-h-11 rounded-lg border px-3 text-[0.875rem] transition-colors ${
                filter === f.id
                  ? "border-ink/30 bg-ink/[0.06] text-ink"
                  : "border-line text-muted hover:bg-canvas"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {state.kind === "loading" ? (
        <p className="mt-3 text-[0.9375rem] text-muted">Loading tasks...</p>
      ) : state.kind === "error" ? (
        <div className="mt-3 rounded-card border border-line bg-paper px-4 py-5">
          <p className="text-[0.9375rem] leading-relaxed text-body">{state.message}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-[0.9375rem] transition-colors hover:bg-canvas"
          >
            Try again
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="mt-3 rounded-card border border-line bg-paper px-4 py-5">
          <p className="text-[0.9375rem] leading-relaxed text-body">
            {tasks.length === 0
              ? "No tasks yet. Assign one and every unit will see it."
              : "No tasks in this view."}
          </p>
        </div>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {visible.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              busyUnitId={busyUnitId}
              note={notes[task.assignments[0]?.unitId] ?? ""}
              onNote={(value) =>
                setNotes((prev) => ({ ...prev, [task.assignments[0]?.unitId]: value }))
              }
              onReport={(unitId, status) => void report(task, unitId, status)}
              canFinish
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The unit picker, built from the units already named on loaded tasks.
 *
 * That is deliberate rather than lazy: the task list already carries every unit
 * name in the organization, so this adds no new endpoint and no new permission.
 * With no tasks yet there is nothing to pick, and the hint says all units will be
 * sent the task -- which is also what an empty selection means.
 */
function UnitPicker({
  tasks,
  selected,
  onChange,
}: {
  tasks: Task[];
  selected: string[];
  onChange: (unitIds: string[]) => void;
}) {
  const units = new Map<string, string>();
  for (const task of tasks) {
    for (const a of task.assignments) {
      if (a.unitId && a.unitName) units.set(a.unitId, a.unitName);
    }
  }

  if (units.size === 0) {
    return (
      <p className="mt-2 text-[0.875rem] text-muted">
        No units named yet, so this will go to all of them.
      </p>
    );
  }

  const toggle = (unitId: string) => {
    onChange(
      selected.includes(unitId)
        ? selected.filter((id) => id !== unitId)
        : [...selected, unitId],
    );
  };

  return (
    <ul className="mt-2 flex flex-col gap-2">
      {[...units].map(([unitId, name]) => (
        <li key={unitId}>
          <label className="flex min-h-11 items-center gap-3 rounded-lg bg-canvas/60 px-3 text-[0.9375rem]">
            <input
              type="checkbox"
              checked={selected.includes(unitId)}
              onChange={() => toggle(unitId)}
              className="size-4 accent-[#1c1917]"
            />
            {name}
          </label>
        </li>
      ))}
    </ul>
  );
}

export { dueLabel };