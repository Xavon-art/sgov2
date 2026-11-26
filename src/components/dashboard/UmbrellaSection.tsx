"use client";

import { useCallback, useEffect, useState } from "react";
import { Reveal } from "@/components/fx/Reveal";
import { Button, ButtonLink } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";

/**
 * The umbrella: every LSG under this USG, with the temporary deactivations the
 * owner can schedule over them.
 *
 * This is the USG's own view of what it is responsible for. It is owner-gated in
 * the database (`list_umbrella`), so an invited USG officer is refused by the
 * function rather than by a hidden button here.
 *
 * A deactivation is a window rather than a switch: the owner names a start and
 * (optionally) an end, and `authenticate` sweeps the schedule on the target's
 * next request. The email is a courtesy layered on top -- the window is already
 * in force whether or not the letter lands -- so a send failure is reported as
 * "tell them by hand" rather than shown as a failed schedule.
 */

type Member = {
  rosterId: string;
  name: string;
  email: string;
  position: string | null;
  account: {
    id: string;
    email: string;
    displayName: string;
    status: string;
    deactivationStartsAt: string | null;
    deactivationEndsAt: string | null;
    deactivationReason: string | null;
  } | null;
};

type Unit = {
  unitId: string;
  name: string;
  unitType: string;
  structureKey: string | null;
  address?: string | null;
  locationCode?: string | null;
  memberCount: number;
  members: Member[];
};

function statusLabel(u: Unit): { text: string; tone: "quiet" | "paused" | "live" } {
  const seat = u.members.find((m) => m.account)?.account ?? null;
  if (seat?.status === "suspended" && seat.deactivationStartsAt) {
    return { text: "Paused now", tone: "paused" };
  }
  if (seat?.deactivationStartsAt) {
    return { text: "Scheduled", tone: "live" };
  }
  return { text: seat?.status === "active" ? "Active" : (seat?.status ?? "No seat"), tone: "quiet" };
}

const TONE = {
  quiet: "bg-canvas text-muted",
  paused: "bg-[#f7e3dd] text-[#a5442c]",
  live: "bg-brass-soft/50 text-brass-deep",
} as const;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** A short, readable form of an ISO timestamp for a pause window. */
function dayOf(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

export function UmbrellaSection() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [openUnit, setOpenUnit] = useState<string | null>(null);
  const [target, setTarget] = useState<{ unit: Unit; seat: Member } | null>(null);
  const [startsOn, setStartsOn] = useState(todayIso());
  const [endsOn, setEndsOn] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/umbrella");
      const body = (await res.json().catch(() => ({}))) as {
        ok: boolean;
        units?: Unit[];
        message?: string;
      };
      if (res.ok && body.ok) {
        setUnits(body.units ?? []);
        setError("");
      } else {
        setError(body.message ?? "We could not load your umbrella.");
      }
    } catch {
      setError("We could not load your umbrella.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function submit(action: "schedule" | "cancel", seat: Member) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/umbrella", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          accountId: seat.account?.id,
          startsOn,
          endsOn: endsOn || null,
          reason,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok: boolean;
        message?: string;
        delivered?: boolean;
      };
      if (!res.ok || !body.ok) {
        setNote({ kind: "error", text: body.message ?? "We could not save that." });
        return;
      }
      setTarget(null);
      setReason("");
      setEndsOn("");
      setNote({
        kind: "ok",
        text:
          action === "cancel"
            ? "The deactivation is lifted."
            : body.delivered === false
              ? (body.message ?? "Scheduled. The notice email did not go out — tell them directly.")
              : "Scheduled. The unit has been emailed a notice.",
      });
      await load();
    } catch {
      setNote({ kind: "error", text: "We could not reach the server." });
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="text-[0.9375rem] text-body">Loading your umbrella…</p>;
  }

  if (error) {
    return (
      <p role="alert" className="text-[0.9375rem] font-medium text-[#a5442c]">
        {error}
      </p>
    );
  }

  return (
    <div data-tour="manage-umbrella" className="flex flex-col gap-5">
      <Reveal>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="eyebrow">Umbrella</p>
            <h2 className="mt-1 text-[1.25rem] leading-tight">Units under you</h2>
            <p className="mt-2 max-w-2xl text-[0.875rem] leading-relaxed text-body">
              Every campus, department, and college in your federation. Open a unit to see its
              officers, or schedule a temporary pause over one.
            </p>
          </div>
          <span className="text-[0.8125rem] text-muted">
            {units.length} {units.length === 1 ? "unit" : "units"}
          </span>
        </div>
      </Reveal>

      {note ? (
        <p
          role={note.kind === "error" ? "alert" : "status"}
          className={`text-[0.8125rem] ${note.kind === "error" ? "text-[#a5442c]" : "text-[#2f5d38]"}`}
        >
          {note.text}
        </p>
      ) : null}

      {units.length === 0 ? (
        <Reveal delay={0.04}>
          <div className="flex flex-col items-start gap-4 rounded-2xl border border-dashed border-line-strong bg-paper/70 px-5 py-6">
            <div>
              <p className="text-[0.9375rem] font-medium text-ink">
                You don&rsquo;t have any LSG under you yet.
              </p>
              <p className="mt-1 max-w-xl text-[0.875rem] leading-relaxed text-body">
                Create the campus, college, or department first, then invite its officer.
                Every LSG you add will show up here.
              </p>
            </div>
            <ButtonLink href="/usg/manage?tab=people&view=invites" size="sm">
              Invite an LSG
            </ButtonLink>
          </div>
        </Reveal>
      ) : (
        <ul className="flex flex-col gap-3">
          {units.map((u) => {
            const seat = u.members.find((m) => m.account) ?? null;
            const status = statusLabel(u);
            const isOpen = openUnit === u.unitId;
            return (
              <li key={u.unitId} className="rounded-2xl border border-line bg-paper/70">
                <div className="flex flex-wrap items-center gap-3 p-5">
                  <button
                    type="button"
                    onClick={() => setOpenUnit(isOpen ? null : u.unitId)}
                    className="min-w-0 flex-1 cursor-pointer text-left"
                    aria-expanded={isOpen}
                  >
                    <span className="block text-[1.0625rem] leading-snug font-medium text-ink">
                      {u.name}
                    </span>
                    <span className="mt-0.5 block text-[0.8125rem] text-muted">
                      {[u.unitType, `${u.memberCount} ${u.memberCount === 1 ? "officer" : "officers"}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {u.address ? (
                      <span className="mt-0.5 block text-[0.75rem] text-muted">{u.address}</span>
                    ) : null}
                  </button>

                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold ${TONE[status.tone]}`}
                  >
                    {status.text}
                  </span>

                  {seat ? (
                    <Button
                      size="sm"
                      variant={status.tone === "paused" ? "outline" : "paper"}
                      onClick={() => {
                        setTarget({ unit: u, seat });
                        setStartsOn(todayIso());
                        setEndsOn("");
                        setReason("");
                        setNote(null);
                      }}
                    >
                      {seat.account?.deactivationStartsAt ? "Edit pause" : "Pause"}
                    </Button>
                  ) : (
                    <span className="text-[0.75rem] text-muted">No seat yet</span>
                  )}
                </div>

                {isOpen ? (
                  <div className="border-t border-line/70 px-5 py-4">
                    {u.members.length === 0 ? (
                      <p className="text-[0.875rem] text-muted">No officers on record for this unit.</p>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {u.members.map((m) => (
                          <li
                            key={m.rosterId}
                            className="flex flex-wrap items-baseline justify-between gap-2 text-[0.875rem]"
                          >
                            <span className="min-w-0">
                              <span className="text-ink">{m.name}</span>
                              {m.position ? (
                                <span className="text-muted"> · {m.position}</span>
                              ) : null}
                            </span>
                            <span className="text-[0.8125rem] text-muted">{m.email}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {seat?.account?.deactivationStartsAt ? (
                      <p className="mt-3 text-[0.8125rem] text-muted">
                        Paused {dayOf(seat.account.deactivationStartsAt)}
                        {seat.account.deactivationEndsAt
                          ? ` until ${dayOf(seat.account.deactivationEndsAt)}`
                          : " until lifted"}
                        {seat.account.deactivationReason ? ` — ${seat.account.deactivationReason}` : ""}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {/* The schedule form. A window the owner sets here is enforced by the
          database on the unit's next request, whether or not mail is delivered.
          Rendered inline under a heading rather than in the ConfirmDialog: that
          primitive takes no children, and a three-field form with a conditional
          second action is a panel, not a yes/no. */}
      {target ? (
        <Reveal delay={0.04}>
          <div className="rounded-2xl border border-line bg-canvas/70 p-6">
            <p className="eyebrow">
              {target.seat.account?.deactivationStartsAt ? "Reschedule pause" : "Schedule a pause"}
            </p>
            <h3 className="mt-1 text-[1.0625rem] leading-tight">
              {target.unit.name}
            </h3>
            <p className="mt-2 text-[0.875rem] leading-relaxed text-body">
              Choose when this unit goes quiet and, if you like, when it comes back.
            </p>

            <form
              className="mt-5 flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void submit("schedule", target.seat);
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  id="pause-start"
                  label="Starts"
                  type="date"
                  value={startsOn}
                  onChange={(e) => setStartsOn(e.target.value)}
                />
                <TextField
                  id="pause-end"
                  label="Ends"
                  hint="Leave blank to keep it paused until you lift it."
                  type="date"
                  value={endsOn}
                  onChange={(e) => setEndsOn(e.target.value)}
                />
              </div>
              <TextField
                id="pause-reason"
                label="Note to the unit"
                hint="Optional. Appears in the email they receive."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <Button type="submit" size="sm" disabled={busy}>
                  {busy ? "Saving…" : "Save window"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setTarget(null);
                    setNote(null);
                  }}
                >
                  Cancel
                </Button>
                {target.seat.account?.deactivationStartsAt ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void submit("cancel", target.seat)}
                  >
                    Lift the pause instead
                  </Button>
                ) : null}
              </div>
            </form>
          </div>
        </Reveal>
      ) : null}
    </div>
  );
}
