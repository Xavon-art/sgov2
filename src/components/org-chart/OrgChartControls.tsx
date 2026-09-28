"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { IconCheck } from "@/components/ui/Icons";
import { cn } from "@/lib/utils";
import type { ChartPosition, ChartUnit } from "@/lib/chart";

type WriteResponse = {
  ok?: boolean;
  message?: string;
  label?: string;
  enabledUnits?: number;
};

const MAX_LABEL = 120;

const alertClass =
  "animate-float-in rounded-xl border border-[#d9a99c] bg-[#a5442c]/[0.06] px-3.5 py-2.5 text-[0.8125rem] font-medium text-[#a5442c]";

const noticeClass =
  "flex items-center gap-2 rounded-xl border border-brass/40 bg-brass-soft/25 px-3.5 py-2.5 text-[0.8125rem] font-medium text-ink";

/**
 * The organization template, and the one control that changes it.
 *
 * A new position is enabled on every unit by the same call that creates it, so
 * the chips below are the whole list a unit can be given a seat in and adding
 * one is the only way that list grows.
 */
export function AddPositionControl({ positions }: { positions: ChartPosition[] }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const trimmed = label.trim();
    if (!trimmed) {
      setError("Give the position a name before adding it.");
      return;
    }

    setBusy(true);

    try {
      const res = await fetch("/api/org-chart/position", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The function defaults to 0, which sorts ahead of everything already
        // in the template; the current length puts a new position after its
        // predecessors instead.
        body: JSON.stringify({ label: trimmed, sortOrder: positions.length }),
      });
      const data = (await res.json()) as WriteResponse;

      if (!res.ok || !data.ok) {
        setError(data.message ?? "We could not add that position.");
        return;
      }

      const units = Number(data.enabledUnits ?? 0);
      setLabel("");
      setNotice(
        `${data.label ?? trimmed} is enabled on ${units} ${units === 1 ? "unit" : "units"}.`,
      );
      router.refresh();
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line-strong bg-paper/80 p-6 shadow-lift sm:p-7">
      <p className="eyebrow">Position template</p>
      <p className="mt-2 max-w-2xl text-[0.875rem] leading-relaxed text-body">
        These are the positions any unit can hold. Adding one enables it on every unit in
        your organization at the same time, so nobody has to visit each council to make it
        appear.
      </p>

      {positions.length === 0 ? (
        <p className="mt-4 text-[0.8125rem] leading-relaxed text-muted">
          No positions yet. Add the first one below.
        </p>
      ) : (
        <ul className="mt-4 flex flex-wrap gap-2">
          {positions.map((position) => (
            <li
              key={position.id}
              className="rounded-full border border-line bg-paper px-3 py-1.5 text-[0.8125rem] font-medium text-ink-deep"
            >
              {position.label}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-start">
        <TextField
          id="org-position-label"
          label="New position"
          placeholder="Auditor"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={MAX_LABEL}
          className="sm:w-72"
        />
        <Button type="submit" size="md" disabled={busy} className="sm:mt-7">
          {busy ? "Adding…" : "Add position"}
        </Button>
      </form>

      {error ? (
        <p role="alert" className={cn("mt-4", alertClass)}>
          {error}
        </p>
      ) : null}

      {notice ? (
        <p role="status" className={cn("mt-4", noticeClass)}>
          <IconCheck className="h-4 w-4 shrink-0 text-brass-deep" strokeWidth={2.2} />
          {notice}
        </p>
      ) : null}
    </section>
  );
}

function SeatSwitch({
  checked,
  busy,
  label,
  onToggle,
}: {
  checked: boolean;
  busy: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={busy || undefined}
      disabled={busy}
      onClick={onToggle}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-300 ease-out",
        "disabled:cursor-progress",
        checked ? "border-ink bg-ink" : "border-line bg-canvas-sunk hover:border-line-strong",
      )}
    >
      <span className="sr-only">
        {checked ? `Disable the ${label} seat` : `Enable the ${label} seat`}
      </span>
      <span
        aria-hidden
        className={cn(
          "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-[0_1px_2px_rgba(13,33,53,0.28)] transition-transform duration-300 ease-out",
          checked && "translate-x-5",
        )}
      />
    </button>
  );
}

/**
 * One toggle per position in the template, for this unit only.
 *
 * A toggle is left live on an occupied seat on purpose: the refusal for
 * disabling one belongs to the function, which is the only thing that knows
 * whether a holder arrived between this read and the click. The client shows the
 * line it is given and leaves the switch where the server left it.
 */
export function UnitSeatToggles({
  unit,
  positions,
}: {
  unit: ChartUnit;
  positions: ChartPosition[];
}) {
  const router = useRouter();
  const [inFlight, setInFlight] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const enabledSeats = new Set(unit.seats.map((seat) => seat.positionId));

  function drop(id: string) {
    setOverrides((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  /**
   * An override stands for a value this client asked for and the refreshed
   * chart has not repeated yet, so the switch does not snap back in the gap
   * between the response and the new props. An override the server has caught up
   * with is redundant and goes on the next click, which keeps the read here in an
   * event handler rather than in an effect that would re-render the card.
   */
  function override(id: string, enabled: boolean) {
    setOverrides((prev) => {
      const next: Record<string, boolean> = {};

      for (const [key, value] of Object.entries(prev)) {
        if (value !== enabledSeats.has(key)) next[key] = value;
      }

      next[id] = enabled;
      return next;
    });
  }

  async function toggle(position: ChartPosition, enabled: boolean) {
    if (inFlight) return;
    setError(null);
    setNotice(null);
    setInFlight(position.id);
    override(position.id, enabled);

    try {
      const res = await fetch("/api/org-chart/unit-position", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unitId: unit.id, positionId: position.id, enabled }),
      });
      const data = (await res.json()) as WriteResponse;

      if (!res.ok || !data.ok) {
        drop(position.id);
        setError(data.message ?? "We could not change that seat.");
        return;
      }

      setNotice(`${position.label} ${enabled ? "enabled" : "disabled"} for this unit.`);
      router.refresh();
    } catch {
      drop(position.id);
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setInFlight(null);
    }
  }

  if (positions.length === 0) {
    return (
      <p className="mt-4 border-t border-line/70 pt-4 text-[0.8125rem] leading-relaxed text-muted">
        Your organization has no positions yet, so there is nothing to enable for this
        unit. Add one at the top of the chart.
      </p>
    );
  }

  return (
    <div className="mt-4 border-t border-line/70 pt-4">
      <p className="eyebrow">Enabled for this unit</p>

      <ul role="group" aria-label="Positions enabled for this unit" className="mt-2">
        {positions.map((position) => {
          const busy = inFlight === position.id;
          const shown = overrides[position.id] ?? enabledSeats.has(position.id);

          return (
            <li
              key={position.id}
              className="flex items-center justify-between gap-3 border-b border-line/70 py-2 last:border-b-0"
            >
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="truncate text-[0.8125rem] text-ink-deep">
                  {position.label}
                </span>
                {busy ? (
                  <span className="shrink-0 text-[0.6875rem] font-semibold tracking-[0.08em] text-muted uppercase">
                    Saving…
                  </span>
                ) : null}
              </span>
              <SeatSwitch
                label={position.label}
                checked={shown}
                busy={busy}
                onToggle={() => toggle(position, !shown)}
              />
            </li>
          );
        })}
      </ul>

      {error ? (
        <p role="alert" className={cn("mt-3", alertClass)}>
          {error}
        </p>
      ) : null}

      {notice ? (
        <p role="status" className={cn("mt-3", noticeClass)}>
          <IconCheck className="h-4 w-4 shrink-0 text-brass-deep" strokeWidth={2.2} />
          {notice}
        </p>
      ) : null}
    </div>
  );
}
