"use client";

import { useEffect, useState } from "react";
import { TaskCard, type StatusChoice } from "@/components/dashboard/tasks/TaskCard";
import type { Task } from "@/lib/tasks";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; tasks: Task[] };

/**
 * The LSG task list.
 *
 * One control per unit row, and no "mark done": an officer can say "we started"
 * and stop there. Done is the USG office's answer to give, because done is what
 * the office counts when it decides whether the unit complied. SQL refuses an
 * officer's attempt to set it, and this screen does not offer the control it would
 * have to turn away.
 */
export default function LsgTasksPage() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [busyUnitId, setBusyUnitId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/tasks");
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setState({ kind: "error", message: data.message ?? "We could not load your tasks." });
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
          setState({ kind: "error", message: data.message ?? "We could not load your tasks." });
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

  async function report(task: Task, unitId: string, status: StatusChoice) {
    setNotice(null);
    setBusyUnitId(unitId);
    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          unitId,
          status,
          note: notes[unitId] ?? "",
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setNotice({ tone: "bad", text: data.message ?? "We could not save that." });
        return;
      }

      setNotice({
        tone: "ok",
        text:
          status === "in_progress"
            ? "Noted. USG can see that your unit has started."
            : "Moved back to not started.",
      });
      await load();
    } catch {
      setNotice({ tone: "bad", text: "We could not reach the server. Check your connection." });
    } finally {
      setBusyUnitId(null);
    }
  }

  const tasks = state.kind === "ready" ? state.tasks : [];
  const open = tasks.filter((t) => t.doneUnits < t.totalUnits);
  const closed = tasks.filter((t) => t.doneUnits >= t.totalUnits);

  return (
    <section className="mx-auto w-full max-w-3xl">
      <header className="border-b border-line/80 pb-4">
        <p className="eyebrow">Your unit</p>
        <h1 className="mt-1 text-[1.5rem] leading-tight sm:text-[1.75rem]">
          What USG needs from your unit
        </h1>
        <p className="mt-1 max-w-prose text-[0.9375rem] leading-relaxed text-body">
          Mark a task as started so the office knows where you are. USG marks it done
          once it has checked the work.
        </p>
      </header>

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

      {state.kind === "loading" ? (
        <p className="mt-4 text-[0.9375rem] text-muted">Loading your tasks...</p>
      ) : state.kind === "error" ? (
        <div className="mt-4 rounded-card border border-line bg-paper px-4 py-5">
          <p className="text-[0.9375rem] leading-relaxed text-body">{state.message}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-[0.9375rem] transition-colors hover:bg-canvas"
          >
            Try again
          </button>
        </div>
      ) : open.length === 0 && closed.length === 0 ? (
        <div className="mt-4 rounded-card border border-line bg-paper px-4 py-5">
          <p className="text-[0.9375rem] leading-relaxed text-body">
            Nothing is assigned to your unit right now.
          </p>
        </div>
      ) : (
        <>
          <h2 className="mt-6 text-[1.125rem] leading-tight">To do</h2>
          {open.length === 0 ? (
            <p className="mt-2 text-[0.9375rem] text-muted">
              Nothing open. Everything assigned to your unit has been marked done.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {open.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  busyUnitId={busyUnitId}
                  note={
                    notes[task.assignments[0]?.unitId] ??
                    task.assignments[0]?.note ??
                    ""
                  }
                  onNote={(value) =>
                    setNotes((prev) => ({
                      ...prev,
                      [task.assignments[0]?.unitId]: value,
                    }))
                  }
                  onReport={(unitId, status) => void report(task, unitId, status)}
                  canFinish={false}
                />
              ))}
            </ul>
          )}

          {closed.length > 0 ? (
            <>
              <h2 className="mt-8 text-[1.125rem] leading-tight">Done</h2>
              <ul className="mt-2 flex flex-col gap-2">
                {closed.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    busyUnitId={null}
                    note=""
                    onNote={() => undefined}
                    onReport={() => undefined}
                    canFinish={false}
                    readOnly
                  />
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}