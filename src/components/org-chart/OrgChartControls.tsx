"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { IconCheck, IconClose, IconUser } from "@/components/ui/Icons";
import { cn } from "@/lib/utils";
import type { ChartPosition, ChartSeat, ChartUnit, RosterEntry } from "@/lib/chart";

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

const INVITE_UNIT_TYPES = [
  { value: "lsg", label: "Local Student Government" },
  { value: "college", label: "College" },
  { value: "campus", label: "Campus" },
  { value: "council", label: "Council" },
  { value: "department", label: "Department" },
];

const selectClass =
  "h-12 w-full appearance-none rounded-xl border border-line bg-paper/70 px-3.5 text-[0.9375rem] text-ink-deep outline-none transition-[border-color,box-shadow,background-color] duration-300 hover:border-line-strong focus:border-ink/25 focus:bg-paper";

type SeatWriteResponse = {
  ok?: boolean;
  message?: string;
  email?: string;
  delivered?: boolean;
  code?: string;
};

/**
 * One seat row: the position, who holds it, and the actions that fill or
 * empty it.
 *
 * A vacant seat opens a panel with the two ways to fill it -- invite
 * somebody new, or seat somebody already on the roster -- and a seated one
 * shows the holder with the release that makes the seat vacant again. Every
 * action writes through the owner-gated API routes and then refreshes the
 * chart, so the row always shows what the database now says.
 */
export function SeatRow({
  seat,
  unitId,
  unitType,
  roster,
  rosterAvailable,
}: {
  seat: ChartSeat;
  unitId: string;
  unitType: string;
  roster: RosterEntry[];
  rosterAvailable: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"invite" | "assign">("invite");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [campusName, setCampusName] = useState("");
  const [inviteType, setInviteType] = useState(
    INVITE_UNIT_TYPES.some((t) => t.value === unitType) ? unitType : "lsg",
  );
  const [query, setQuery] = useState("");
  const [assigningId, setAssigningId] = useState<string | null>(null);

  const held = Boolean(seat.rosterId);
  const panelId = `seat-panel-${seat.positionId}`;

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter(
      (entry) =>
        entry.fullName.toLowerCase().includes(q) || entry.email.toLowerCase().includes(q),
    );
  }, [query, roster]);

  function showError(message: string) {
    setNotice(null);
    setError(message);
  }

  async function onInvite(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setNotice(null);
    setBusy(true);

    try {
      const res = await fetch("/api/org-chart/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          campusName: campusName.trim(),
          unitType: inviteType,
          unitId,
          positionId: seat.positionId,
        }),
      });
      const data = (await res.json()) as SeatWriteResponse;

      if (!res.ok || !data.ok) {
        showError(data.message ?? "We could not send that invitation.");
        if (data.code === "delivery_failed") {
          setOpen(false);
          router.refresh();
        }
        return;
      }

      setEmail("");
      setCampusName("");
      setOpen(false);
      setNotice(`Invite sent to ${data.email ?? email.trim()}.`);
      router.refresh();
    } catch {
      showError("We could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onAssign(entry: RosterEntry) {
    if (busy) return;
    setError(null);
    setNotice(null);
    setAssigningId(entry.rosterId);
    setBusy(true);

    try {
      const res = await fetch("/api/org-chart/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unitId, positionId: seat.positionId, rosterId: entry.rosterId }),
      });
      const data = (await res.json()) as SeatWriteResponse;

      if (!res.ok || !data.ok) {
        showError(data.message ?? "We could not assign that person.");
        return;
      }

      setOpen(false);
      router.refresh();
    } catch {
      showError("We could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
      setAssigningId(null);
    }
  }

  async function onRelease() {
    if (busy || !seat.membershipId) return;
    setError(null);
    setNotice(null);
    setBusy(true);

    try {
      const res = await fetch("/api/org-chart/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipId: seat.membershipId }),
      });
      const data = (await res.json()) as SeatWriteResponse;

      if (!res.ok || !data.ok) {
        showError(data.message ?? "We could not release that seat.");
        return;
      }

      router.refresh();
    } catch {
      showError("We could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="border-b border-line/70 py-2.5 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <span className="text-[0.875rem] text-ink-deep">{seat.label}</span>

        {held ? (
          <span className="flex min-w-0 items-center gap-3">
            <span className="min-w-0 text-right">
              <span className="block truncate text-[0.8125rem] font-medium text-ink">
                {seat.fullName || seat.email}
              </span>
              {seat.email ? (
                <span className="block truncate text-[0.75rem] text-muted">{seat.email}</span>
              ) : null}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={onRelease}
            >
              {busy ? "Releasing…" : "Release"}
            </Button>
          </span>
        ) : (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            disabled={busy}
            onClick={() => {
              setError(null);
              setNotice(null);
              setOpen((v) => !v);
            }}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[0.6875rem] font-semibold tracking-[0.06em] uppercase transition-colors duration-300",
              "disabled:cursor-progress",
              open
                ? "border-ink/40 bg-ink/[0.06] text-ink"
                : "border-line text-muted hover:border-line-strong hover:text-ink-soft",
            )}
          >
            Vacant
          </button>
        )}
      </div>

      {open && !held ? (
        <div id={panelId} className="mt-3 rounded-xl border border-line bg-canvas/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="eyebrow">Fill this seat</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="grid size-7 place-items-center rounded-full border border-line text-muted transition-colors duration-300 hover:border-line-strong hover:text-ink"
            >
              <IconClose className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-3 flex gap-2">
            {(
              [
                { id: "invite", label: "Invite new" },
                { id: "assign", label: "Assign existing" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                aria-pressed={mode === tab.id}
                onClick={() => {
                  setMode(tab.id);
                  setError(null);
                }}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[0.75rem] font-semibold tracking-[0.04em] transition-colors duration-300",
                  mode === tab.id
                    ? "border-ink/40 bg-ink/[0.06] text-ink"
                    : "border-line text-muted hover:border-line-strong hover:text-ink-soft",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {mode === "invite" ? (
            <form onSubmit={onInvite} noValidate className="mt-4 flex flex-col gap-4">
              <TextField
                id={`seat-invite-email-${seat.positionId}`}
                label="Email"
                type="email"
                placeholder="officer@campus.edu"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <TextField
                id={`seat-invite-campus-${seat.positionId}`}
                label="Campus or unit"
                placeholder="College of Engineering"
                value={campusName}
                onChange={(e) => setCampusName(e.target.value)}
                optional
                hint="Leave blank if this person represents the whole organization."
              />
              <div className="flex flex-col gap-2">
                <label
                  htmlFor={`seat-invite-type-${seat.positionId}`}
                  className="text-[0.8125rem] font-medium text-ink"
                >
                  Unit type
                </label>
                <select
                  id={`seat-invite-type-${seat.positionId}`}
                  value={inviteType}
                  onChange={(e) => setInviteType(e.target.value)}
                  className={selectClass}
                >
                  {INVITE_UNIT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" size="sm" disabled={busy} className="self-start">
                {busy ? "Sending…" : "Send invite"}
              </Button>
            </form>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              {!rosterAvailable ? (
                <p className="text-[0.8125rem] leading-relaxed text-muted">
                  The roster is not available yet. Ask an administrator to apply the latest
                  database migration, then refresh the chart.
                </p>
              ) : (
                <>
                  <TextField
                    id={`seat-assign-search-${seat.positionId}`}
                    label="Search the roster"
                    placeholder="Search by name or email"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    icon={<IconUser className="h-4 w-4" />}
                  />
                  {matches.length === 0 ? (
                    <p className="text-[0.8125rem] leading-relaxed text-muted">
                      {roster.length === 0
                        ? "No one is on the roster yet. Invite somebody new instead."
                        : "No one matches that search."}
                    </p>
                  ) : (
                    <ul className="flex max-h-48 flex-col gap-1.5 overflow-y-auto pr-1">
                      {matches.map((entry) => (
                        <li key={entry.rosterId}>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => onAssign(entry)}
                            className="flex w-full items-center justify-between gap-3 rounded-lg border border-line bg-paper/70 px-3 py-2 text-left transition-colors duration-300 hover:border-line-strong disabled:opacity-50"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-[0.8125rem] font-medium text-ink-deep">
                                {entry.fullName}
                              </span>
                              <span className="block truncate text-[0.75rem] text-muted">
                                {entry.email}
                              </span>
                            </span>
                            {assigningId === entry.rosterId ? (
                              <span className="shrink-0 text-[0.6875rem] font-semibold tracking-[0.08em] text-muted uppercase">
                                Assigning…
                              </span>
                            ) : (
                              <span className="shrink-0 text-[0.6875rem] font-semibold tracking-[0.08em] text-brass-deep uppercase">
                                Assign
                              </span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className={cn("mt-2", alertClass)}>
          {error}
        </p>
      ) : null}

      {notice ? (
        <p role="status" className={cn("mt-2", noticeClass)}>
          <IconCheck className="h-4 w-4 shrink-0 text-brass-deep" strokeWidth={2.2} />
          {notice}
        </p>
      ) : null}
    </li>
  );
}
