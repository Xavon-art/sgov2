"use client";

import { useRef, useState } from "react";
import { ActionError, selectClass } from "@/components/dashboard/workspace-shared";
import { Button } from "@/components/ui/Button";
import { IconClose, IconPencil } from "@/components/ui/Icons";
import { TimezonePicker } from "@/components/ui/TimezonePicker";

type Unit = { id: string; name: string; unitType: string };
type AssignMode = "all" | "by-campus" | "by-unit-type" | "specific-units";
type RequirementDraft = {
  label: string;
  instructions: string;
  acceptedTypes: string[];
  required: boolean;
};

const STEPS = ["Basics", "Assign units", "Requirements", "Deadline", "Preview & Publish"] as const;

async function mutate(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, init);
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || json.ok !== true) {
    const detail =
      typeof json.message === "string" && json.message.trim()
        ? json.message
        : typeof json.reason === "string" && json.reason.trim()
          ? json.reason
          : "That action could not be completed.";
    throw new Error(detail);
  }
  return json;
}

function actionMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function labelForUnitType(value: string): string {
  const labels: Record<string, string> = {
    campus: "Campus",
    college: "College",
    department: "Department",
    lsg: "Local Student Government",
    council: "Council",
  };
  return labels[value] ?? value.replace(/^./, (letter) => letter.toUpperCase());
}

function unitIdsForCampus(units: Unit[], campusValue: string): string[] {
  const selected = units.find(
    (unit) => unit.unitType === "campus" && (unit.id === campusValue || unit.name === campusValue),
  );
  if (!selected) return [];
  const needle = selected.name.toLowerCase();
  return units
    .filter((unit) => unit.id === selected.id || unit.name.toLowerCase().includes(needle))
    .map((unit) => unit.id);
}

function unitIdsForType(units: Unit[], unitType: string): string[] {
  if (!unitType) return [];
  return units.filter((unit) => unit.unitType === unitType).map((unit) => unit.id);
}

export function CreateTaskStepper({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [priority, setPriority] = useState("normal");
  const [mode, setMode] = useState<AssignMode>("all");
  const [campusSelection, setCampusSelection] = useState("");
  const [unitTypeSelection, setUnitTypeSelection] = useState("");
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [reqs, setReqs] = useState<RequirementDraft[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [dueTimezone, setDueTimezone] = useState("");
  const [gracePeriodMinutes, setGracePeriodMinutes] = useState("0");
  const [reviewSlaDays, setReviewSlaDays] = useState("");
  const [autoClose, setAutoClose] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const modeRef = useRef<AssignMode>("all");

  const campusOptions = units.filter((unit) => unit.unitType === "campus");
  const unitTypeOptions = Array.from(new Set(units.map((unit) => unit.unitType).filter(Boolean))).sort();
  const assignedNames = units.filter((unit) => unitIds.includes(unit.id)).map((unit) => unit.name);
  const validReqs = reqs.filter((req) => req.label.trim());

  const titleValid = title.trim().length >= 3;
  const unitsValid = unitIds.length > 0;
  const graceValid =
    /^\d+$/.test(gracePeriodMinutes) &&
    Number(gracePeriodMinutes) >= 0 &&
    Number(gracePeriodMinutes) <= 10080;
  const reviewValid =
    reviewSlaDays === "" ||
    (/^\d+$/.test(reviewSlaDays) && Number(reviewSlaDays) >= 1 && Number(reviewSlaDays) <= 30);
  const canContinue =
    step === 1 ? titleValid : step === 2 ? unitsValid : step === 4 ? graceValid && reviewValid : true;
  const canPublish = titleValid && unitsValid && graceValid && reviewValid;

  const reset = () => {
    setStep(1);
    setTitle("");
    setDetails("");
    setPriority("normal");
    modeRef.current = "all";
    setMode("all");
    setCampusSelection("");
    setUnitTypeSelection("");
    setUnits([]);
    setUnitIds([]);
    setReqs([]);
    setDueDate("");
    setDueTime("");
    setDueTimezone("");
    setGracePeriodMinutes("0");
    setReviewSlaDays("");
    setAutoClose(false);
    setLoading(false);
    setError(null);
  };

  const loadUnits = async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await mutate("/api/units", {});
      const rawUnits = (Array.isArray(json.units) ? json.units : []) as Array<Record<string, unknown>>;
      const loaded = rawUnits
        .map((unit) => ({
          id: String(unit.id ?? ""),
          name: String(unit.name ?? "Unit"),
          unitType: String(unit.unitType ?? ""),
        }))
        .filter((unit) => unit.id);
      setUnits(loaded);
      if (modeRef.current === "all") setUnitIds(loaded.map((unit) => unit.id));
    } catch (loadError) {
      setError(actionMessage(loadError, "We could not load your units."));
    } finally {
      setLoading(false);
    }
  };

  const openModal = () => {
    setError(null);
    setOpen(true);
    void loadUnits();
  };

  const closeModal = () => {
    if (saving) return;
    setOpen(false);
    setError(null);
  };

  const applyMode = (next: AssignMode) => {
    modeRef.current = next;
    setMode(next);
    if (next === "all") setUnitIds(units.map((unit) => unit.id));
    if (next === "by-campus") setUnitIds(unitIdsForCampus(units, campusSelection));
    if (next === "by-unit-type") setUnitIds(unitIdsForType(units, unitTypeSelection));
    if (next === "specific-units")
      setUnitIds((previous) => previous.filter((id) => units.some((unit) => unit.id === id)));
  };

  const updateReq = (index: number, patch: Partial<RequirementDraft>) => {
    setReqs((previous) => previous.map((req, position) => (position === index ? { ...req, ...patch } : req)));
  };

  const publish = async () => {
    setSaving(true);
    setError(null);
    try {
      await mutate("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          details,
          dueDate: dueDate || null,
          dueTime: dueTime || null,
          dueTimezone: dueTime ? dueTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone : null,
          priority,
          autoClose,
          gracePeriodMinutes: Number(gracePeriodMinutes || 0),
          reviewSlaDays: reviewSlaDays === "" ? null : Number(reviewSlaDays),
          unitIds,
          requirements: reqs.filter((req) => req.label.trim()),
        }),
      });
      setOpen(false);
      reset();
      onCreated();
    } catch (publishError) {
      setError(actionMessage(publishError, "We could not create that task."));
    } finally {
      setSaving(false);
    }
  };

  const renderStep = () => {
    if (step === 1) {
      return (
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm text-muted">
            <span>Title</span>
            <input
              id="task-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className={selectClass}
            />
          </label>
          {title.trim().length > 0 && !titleValid ? (
            <span className="text-xs text-[#a5442c]">Use at least 3 characters.</span>
          ) : null}
          <label className="grid gap-1 text-sm text-muted">
            <span>Details</span>
            <textarea
              id="task-details"
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              rows={4}
              className={selectClass}
            />
          </label>
          <label className="grid gap-1 text-sm text-muted">
            <span>Priority</span>
            <select
              id="task-prio"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
              className={selectClass}
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </label>
        </div>
      );
    }

    if (step === 2) {
      return (
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm text-muted">
            <span>Assignment mode</span>
            <select
              aria-label="Assignment mode"
              value={mode}
              onChange={(event) => applyMode(event.target.value as AssignMode)}
              className={selectClass}
            >
              <option value="all">All units</option>
              <option value="by-campus">By campus</option>
              <option value="by-unit-type">By unit type</option>
              <option value="specific-units">Specific units</option>
            </select>
          </label>

          {mode === "by-campus" ? (
            <label className="grid gap-1 text-sm text-muted">
              <span>Campus</span>
              <select
                aria-label="Campus"
                value={campusSelection}
                onChange={(event) => {
                  setCampusSelection(event.target.value);
                  setUnitIds(unitIdsForCampus(units, event.target.value));
                }}
                className={selectClass}
              >
                <option value="">Choose a campus</option>
                {campusOptions.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {mode === "by-unit-type" ? (
            <label className="grid gap-1 text-sm text-muted">
              <span>Unit type</span>
              <select
                aria-label="Unit type"
                value={unitTypeSelection}
                onChange={(event) => {
                  setUnitTypeSelection(event.target.value);
                  setUnitIds(unitIdsForType(units, event.target.value));
                }}
                className={selectClass}
              >
                <option value="">Choose a unit type</option>
                {unitTypeOptions.map((unitType) => (
                  <option key={unitType} value={unitType}>
                    {labelForUnitType(unitType)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {mode === "specific-units" ? (
            <div className="grid gap-1 rounded-xl border border-line p-3 text-sm">
              <span className="text-muted">Units</span>
              {units.length === 0 ? (
                <span className="text-muted">{loading ? "Loading units..." : "No units are available yet."}</span>
              ) : (
                units.map((unit) => (
                  <label key={unit.id} className="flex items-center gap-2 text-ink-soft">
                    <input
                      type="checkbox"
                      checked={unitIds.includes(unit.id)}
                      onChange={(event) => {
                        setUnitIds((previous) =>
                          event.target.checked
                            ? [...previous, unit.id]
                            : previous.filter((id) => id !== unit.id),
                        );
                      }}
                    />
                    {unit.name}
                  </label>
                ))
              )}
            </div>
          ) : null}

          <div className="rounded-xl border border-line bg-canvas/40 px-3 py-2 text-sm text-muted">
            {loading ? "Loading units..." : `${unitIds.length} unit${unitIds.length === 1 ? "" : "s"} selected`}
          </div>
        </div>
      );
    }

    if (step === 3) {
      return (
        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-ink">Requirements</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setReqs((previous) => [
                  ...previous,
                  { label: "", instructions: "", acceptedTypes: [], required: true },
                ])
              }
            >
              Add
            </Button>
          </div>

          {reqs.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">
              No requirements yet.
            </p>
          ) : null}

          {reqs.map((req, index) => (
            <div key={index} className="grid gap-2 rounded-xl border border-line p-3">
              <label className="grid gap-1 text-sm text-muted">
                <span>Label</span>
                <input
                  aria-label={`Requirement ${index + 1} label`}
                  value={req.label}
                  onChange={(event) => updateReq(index, { label: event.target.value })}
                  className={selectClass}
                />
              </label>
              <label className="grid gap-1 text-sm text-muted">
                <span>Instructions</span>
                <textarea
                  aria-label={`Requirement ${index + 1} instructions`}
                  value={req.instructions}
                  onChange={(event) => updateReq(index, { instructions: event.target.value })}
                  rows={3}
                  className={selectClass}
                />
              </label>
              <label className="grid gap-1 text-sm text-muted">
                <span>Accepted types</span>
                <input
                  aria-label={`Requirement ${index + 1} accepted types`}
                  value={req.acceptedTypes.join(",")}
                  onChange={(event) =>
                    updateReq(index, {
                      acceptedTypes: event.target.value
                        .split(",")
                        .map((type) => type.trim())
                        .filter(Boolean),
                    })
                  }
                  className={selectClass}
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-ink-soft">
                <input
                  type="checkbox"
                  checked={req.required}
                  onChange={(event) => updateReq(index, { required: event.target.checked })}
                />
                Required
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="justify-self-start"
                onClick={() => setReqs((previous) => previous.filter((_, position) => position !== index))}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      );
    }

    if (step === 4) {
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm text-muted">
            <span>Due date</span>
            <input
              id="task-due"
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className={selectClass}
            />
          </label>
          <label className="grid gap-1 text-sm text-muted">
            <span>Due time</span>
            <input
              id="task-time"
              type="time"
              value={dueTime}
              onChange={(event) => setDueTime(event.target.value)}
              className={selectClass}
            />
          </label>
          <div className="grid gap-1 text-sm text-muted sm:col-span-2">
            <span>Timezone</span>
            <TimezonePicker value={dueTimezone} onChange={setDueTimezone} />
          </div>
          <label className="grid gap-1 text-sm text-muted">
            <span>Grace period (minutes)</span>
            <input
              id="task-grace"
              type="number"
              min={0}
              max={10080}
              value={gracePeriodMinutes}
              onChange={(event) => setGracePeriodMinutes(event.target.value)}
              className={selectClass}
            />
          </label>
          <label className="grid gap-1 text-sm text-muted">
            <span>Review within (days)</span>
            <input
              id="task-review-sla"
              type="number"
              min={1}
              max={30}
              value={reviewSlaDays}
              onChange={(event) => setReviewSlaDays(event.target.value)}
              className={selectClass}
            />
          </label>
          {!graceValid ? (
            <span className="text-xs text-[#a5442c] sm:col-span-2">Grace period must be 0-10080 minutes.</span>
          ) : null}
          {!reviewValid ? (
            <span className="text-xs text-[#a5442c] sm:col-span-2">Review SLA must be 1-30 days.</span>
          ) : null}
          <label className="flex items-center gap-2 text-sm text-ink-soft sm:col-span-2">
            <input
              type="checkbox"
              checked={autoClose}
              onChange={(event) => setAutoClose(event.target.checked)}
            />
            Auto-close after the deadline and grace period
          </label>
        </div>
      );
    }

    return (
      <div className="grid gap-3 text-sm">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-line p-3">
            <span className="block text-xs tracking-[0.12em] text-muted uppercase">Title</span>
            <span className="mt-1 block text-ink">{title}</span>
          </div>
          <div className="rounded-xl border border-line p-3">
            <span className="block text-xs tracking-[0.12em] text-muted uppercase">Priority</span>
            <span className="mt-1 block text-ink">{labelForUnitType(priority)}</span>
          </div>
          <div className="rounded-xl border border-line p-3 sm:col-span-2">
            <span className="block text-xs tracking-[0.12em] text-muted uppercase">Details</span>
            <span className="mt-1 block whitespace-pre-wrap text-body">{details || "—"}</span>
          </div>
          <div className="rounded-xl border border-line p-3 sm:col-span-2">
            <span className="block text-xs tracking-[0.12em] text-muted uppercase">Assigned units</span>
            <span className="mt-1 block text-ink">
              {assignedNames.length ? assignedNames.join(", ") : `${unitIds.length} unit(s)`}
            </span>
          </div>
          <div className="rounded-xl border border-line p-3">
            <span className="block text-xs tracking-[0.12em] text-muted uppercase">Deadline</span>
            <span className="mt-1 block text-ink">
              {dueDate || "No due date"}
              {dueTime ? ` at ${dueTime}` : ""}
              {dueTime ? ` (${dueTimezone || "Device timezone"})` : ""}
            </span>
          </div>
          <div className="rounded-xl border border-line p-3">
            <span className="block text-xs tracking-[0.12em] text-muted uppercase">Timing</span>
            <span className="mt-1 block text-ink">
              {gracePeriodMinutes} min grace, review within {reviewSlaDays || "no SLA"} day(s)
              {autoClose ? ", auto-close on" : ""}
            </span>
          </div>
          <div className="rounded-xl border border-line p-3 sm:col-span-2">
            <span className="block text-xs tracking-[0.12em] text-muted uppercase">Requirements</span>
            {validReqs.length === 0 ? (
              <span className="mt-1 block text-ink">None</span>
            ) : (
              <ul className="mt-1 grid gap-1">
                {validReqs.map((req, index) => (
                  <li key={index} className="text-ink">
                    {req.label}
                    {req.required ? " (required)" : ""}
                    {req.acceptedTypes.length ? ` — ${req.acceptedTypes.join(", ")}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <Button
        type="button"
        data-tour="request-create-task"
        size="sm"
        className="ml-auto"
        onClick={openModal}
      >
        <IconPencil className="h-4 w-4" /> Create task
      </Button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeModal();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Create task"
            className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-line bg-paper p-5 shadow-lift sm:p-6"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-medium text-ink">Create task</h2>
                <p className="mt-1 text-sm text-muted">
                  Step {step} of {STEPS.length}: {STEPS[step - 1]}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Close"
                onClick={closeModal}
                disabled={saving}
              >
                <IconClose className="h-4 w-4" />
              </Button>
            </div>

            <ol className="mt-4 grid grid-cols-5 gap-1" aria-label="Create task steps">
              {STEPS.map((label, index) => {
                const number = index + 1;
                const active = number === step;
                return (
                  <li
                    key={label}
                    aria-current={active ? "step" : undefined}
                    className={`rounded-xl border px-1 py-2 text-center text-[0.6875rem] leading-tight sm:text-xs ${
                      active
                        ? "border-brass bg-brass-soft/40 text-brass-deep"
                        : number < step
                          ? "border-line bg-canvas/40 text-ink-soft"
                          : "border-line bg-paper/60 text-muted"
                    }`}
                  >
                    <span className="font-semibold">
                      {number}. {label}
                    </span>
                  </li>
                );
              })}
            </ol>

            <div className="mt-4">{renderStep()}</div>

            <div className="mt-4">
              <ActionError message={error} />
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
              <div>
                {step > 1 ? (
                  <Button type="button" variant="outline" onClick={() => setStep(step - 1)} disabled={saving}>
                    Back
                  </Button>
                ) : null}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={closeModal} disabled={saving}>
                  Cancel
                </Button>
                {step < STEPS.length ? (
                  <Button
                    type="button"
                    variant={step === 4 ? "brass" : "primary"}
                    disabled={!canContinue}
                    onClick={() => setStep(step + 1)}
                  >
                    Continue
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="brass"
                    disabled={saving || !canPublish}
                    onClick={() => void publish()}
                  >
                    {saving ? "Publishing..." : "Publish"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
