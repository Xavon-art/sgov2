"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/Button";
import { Enter } from "@/components/fx/Presence";
import { SwapText } from "@/components/fx/SwapText";
import { TextField } from "@/components/ui/Field";
import { IconCheck, IconClose, IconMail } from "@/components/ui/Icons";
import { cn } from "@/lib/utils";
import {
  ROW_STAGGER_CAP_MS,
  ROW_STAGGER_MS,
  StatusBadge,
  UNIT_TYPES,
  fetchInvites,
  fetchUnits,
  formatDate,
  selectClass,
} from "./workspace-shared";
import { useAccount } from "./dashboard-context";
import type { InviteRow } from "@/app/api/invites/route";
import type { UnitOption } from "@/app/api/units/route";

/**
 * Invitations, and the officers they produced.
 *
 * Separate from `UnitsPanel` so that neither page pays for the other's list. The
 * decentralized form needs the campus list to put somebody *into* a campus, so
 * this route does read `/api/units` -- but only for the dropdown, and only when
 * it is a USG whose units are a tree.
 *
 * The centralized office sits above its units directly, so `add_unit` refuses to
 * extend one and its units are not a tree. That variant keeps a free-text invite
 * with a type instead of a campus picker.
 */
export function InvitesPanel() {
  const account = useAccount();
  const isUsg = account.accountKind === "usg";

  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [email, setEmail] = useState("");
  const [campusName, setCampusName] = useState("");
  const [unitType, setUnitType] = useState("lsg");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const [units, setUnits] = useState<UnitOption[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(true);
  const [selectedUnitId, setSelectedUnitId] = useState("");

  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // The centralized office has no campus tree, so it never asks for one.
      const [rows, list] = await Promise.all([
        fetchInvites(),
        isUsg ? fetchUnits() : Promise.resolve([] as UnitOption[]),
      ]);
      if (cancelled) return;
      if (rows) setInvites(rows);
      setUnits(list);
      setLoading(false);
      setUnitsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [isUsg]);

  async function onInvite(event: React.FormEvent) {
    event.preventDefault();

    if (isUsg && !selectedUnitId) {
      setError("Choose a campus or department first.");
      return;
    }

    setError(null);
    setSentTo(null);
    setNote(null);
    setActionError(null);
    setSending(true);

    const selected = units.find((u) => u.id === selectedUnitId);
    const body = isUsg
      ? {
          email,
          campusName: selected?.name ?? "",
          unitType: selected?.unitType ?? "lsg",
          unitId: selectedUnitId,
        }
      : { email, campusName, unitType };

    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setError(data.message ?? "We could not send that invitation.");
        return;
      }

      setSentTo(`Invitation sent to ${data.email}.`);
      setEmail("");
      if (isUsg) {
        setSelectedUnitId("");
      } else {
        setCampusName("");
        setUnitType("lsg");
      }
      const rows = await fetchInvites();
      if (rows) setInvites(rows);
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  async function cancelInvitation(id: string) {
    setBusy(true);
    setActionError(null);
    setNote(null);
    try {
      const res = await fetch("/api/invites/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteId: id }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setActionError(data.message ?? "We could not cancel that invitation.");
        return;
      }
      // Reported outside the refetch guard: the revoke has already landed, so a
      // flaky read should not swallow the confirmation.
      setNote("Invitation cancelled.");
      // Only leave the confirm state once the row is gone for real. A failed
      // refetch keeps the previous list, so the officer can simply try again.
      const rows = await fetchInvites();
      if (rows) {
        setInvites(rows);
        setConfirmId(null);
      }
    } catch {
      setActionError("We could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function resendInvitation(id: string) {
    setBusy(true);
    setActionError(null);
    setNote(null);
    try {
      const res = await fetch("/api/invites/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteId: id }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setActionError(data.message ?? "We could not resend that invitation.");
        return;
      }
      setNote(`Invitation re-sent to ${data.email}. The old link no longer works.`);
      // A re-send extends the expiry, so an expired row turns pending again.
      const rows = await fetchInvites();
      if (rows) setInvites(rows);
    } catch {
      setActionError("We could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const noUnits = units.length === 0 && !unitsLoading;

  /* `transition-colors` deliberately not used here. It is a Tailwind utility,
     and utilities are layered after components, so it would win over
     `.pressable` and replace transition-property with the colour list alone --
     dropping `transform` and leaving the press to snap instead of easing.
     `.pressable` transitions the same properties itself. */
  const controlClass =
    "pressable grid size-10 place-items-center rounded-full text-muted hover:bg-paper hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass focus-visible:ring-offset-2 disabled:opacity-45 cursor-pointer";

  return (
    <div className="flex flex-col gap-6">
      <section className="card-lift rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
        {isUsg ? (
          <>
            <p className="eyebrow">Invite a campus</p>
            <p className="mt-2 text-[0.875rem] leading-relaxed text-body">
              Enter someone&rsquo;s email and the campus they belong to. They will sit under your
              umbrella once they activate.
            </p>

            <form onSubmit={onInvite} noValidate className="mt-6 flex flex-col gap-5">
              <TextField
                id="invite-email"
                label="Email"
                type="email"
                placeholder="officer@campus.edu"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />

              {noUnits ? (
                <p className="rise-in rounded-xl border border-dashed border-line-strong bg-canvas/40 px-3.5 py-3 text-[0.8125rem] leading-relaxed text-muted">
                  Add a campus or department first — until then there is no unit to invite someone
                  into.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  <label htmlFor="invite-unit" className="text-[0.8125rem] font-semibold text-ink">
                    Campus or unit
                  </label>
                  <select
                    id="invite-unit"
                    value={selectedUnitId}
                    onChange={(e) => setSelectedUnitId(e.target.value)}
                    className={selectClass}
                  >
                    <option value="">Choose a campus or department…</option>
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {error ? (
                <Enter
                  open
                  as="p"
                  role="alert"
                  className="rise-in rounded-xl border border-[#d9a99c] bg-[#a5442c]/[0.06] px-3.5 py-2.5 text-[0.8125rem] font-medium text-[#a5442c]"
                >
                  {error}
                </Enter>
              ) : null}

              {sentTo ? (
                <Enter
                  open
                  as="p"
                  role="status"
                  className="rise-in flex items-center gap-2 rounded-xl border border-brass/40 bg-brass-soft/25 px-3.5 py-2.5 text-[0.8125rem] font-medium text-ink"
                >
                  <IconCheck
                    className="stamp-in h-4 w-4 shrink-0 text-brass-deep"
                    strokeWidth={2.2}
                  />
                  {sentTo}
                </Enter>
              ) : null}

              {noUnits ? null : (
                <Button type="submit" size="md" disabled={sending || !selectedUnitId}>
                  <SwapText isPending={sending} idle="Send invitation" pending="Sending…" />
                </Button>
              )}
            </form>
          </>
        ) : (
          <>
            <p className="eyebrow">Invite a unit</p>
            <p className="mt-2 text-[0.875rem] leading-relaxed text-body">
              Enter someone&rsquo;s email and the unit they belong to. The central office records
              them directly.
            </p>

            <form
              onSubmit={onInvite}
              noValidate
              className="mt-6 flex flex-col gap-5 sm:max-w-xl"
            >
              <TextField
                id="invite-email"
                label="Email"
                type="email"
                placeholder="officer@campus.edu"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />

              <TextField
                id="invite-campus"
                label="Campus or unit"
                placeholder="College of Engineering"
                value={campusName}
                onChange={(e) => setCampusName(e.target.value)}
                optional
                hint="Leave blank if this person represents the whole organization."
              />

              <div className="flex flex-col gap-2">
                <label htmlFor="invite-type" className="text-[0.8125rem] font-semibold text-ink">
                  Unit type
                </label>
                <select
                  id="invite-type"
                  value={unitType}
                  onChange={(e) => setUnitType(e.target.value)}
                  className={selectClass}
                >
                  {UNIT_TYPES.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </div>

              {error ? (
                <Enter
                  open
                  as="p"
                  role="alert"
                  className="rise-in rounded-xl border border-[#d9a99c] bg-[#a5442c]/[0.06] px-3.5 py-2.5 text-[0.8125rem] font-medium text-[#a5442c]"
                >
                  {error}
                </Enter>
              ) : null}

              {sentTo ? (
                <Enter
                  open
                  as="p"
                  role="status"
                  className="rise-in flex items-center gap-2 rounded-xl border border-brass/40 bg-brass-soft/25 px-3.5 py-2.5 text-[0.8125rem] font-medium text-ink"
                >
                  <IconCheck
                    className="stamp-in h-4 w-4 shrink-0 text-brass-deep"
                    strokeWidth={2.2}
                  />
                  {sentTo}
                </Enter>
              ) : null}

              <Button type="submit" size="md" disabled={sending}>
                <SwapText isPending={sending} idle="Send invitation" pending="Sending…" />
              </Button>
            </form>
          </>
        )}
      </section>

      <section className="rise-in card-lift rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
        <p className="eyebrow">Officers you have asked to join</p>

        {note ? (
          <Enter
            open
            as="p"
            role="status"
            className="rise-in mt-4 flex items-center gap-2 rounded-xl border border-brass/40 bg-brass-soft/25 px-3.5 py-2.5 text-[0.8125rem] font-medium text-ink"
          >
            <IconCheck className="stamp-in h-4 w-4 shrink-0 text-brass-deep" strokeWidth={2.2} />
            {note}
          </Enter>
        ) : null}

        {actionError ? (
          <Enter
            open
            as="p"
            role="alert"
            className="rise-in mt-4 rounded-xl border border-[#d9a99c] bg-[#a5442c]/[0.06] px-3.5 py-2.5 text-[0.8125rem] font-medium text-[#a5442c]"
          >
            {actionError}
          </Enter>
        ) : null}

        {loading ? (
          <div className="mt-4 flex flex-col gap-2.5" aria-live="polite">
            <div className="fade-in h-11 animate-pulse rounded-xl bg-ink/[0.05]" />
            <div
              className="fade-in h-11 animate-pulse rounded-xl bg-ink/[0.05]"
              style={{ animationDelay: "70ms" }}
            />
            <div
              className="fade-in h-11 animate-pulse rounded-xl bg-ink/[0.04]"
              style={{ animationDelay: "140ms" }}
            />
          </div>
        ) : invites.length === 0 ? (
          <div className="rise-in mt-4 flex flex-col items-start gap-3 rounded-2xl border border-dashed border-line-strong bg-canvas/40 px-5 py-6 sm:flex-row sm:items-center">
            <span className="grid size-10 shrink-0 place-items-center rounded-full border border-line-strong bg-paper text-brass-deep">
              <IconMail className="h-[1.15rem] w-[1.15rem]" strokeWidth={1.8} />
            </span>
            <div>
              <p className="text-[0.9375rem] font-medium text-ink">No invitations yet</p>
              <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-muted">
                Send the first one above and it will appear here the moment it is delivered.
              </p>
            </div>
          </div>
        ) : (
          <div className="fade-in mt-4 overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-left">
              <thead>
                <tr className="border-b border-line">
                  {["Email", "Campus or unit", "Status", "Invited", "Action"].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="pb-2.5 text-[0.6875rem] font-semibold tracking-[0.1em] text-muted uppercase"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invites.map((invite, index) => (
                  <tr
                    key={invite.id}
                    className="row-in border-b border-line/70 last:border-b-0"
                    style={
                      {
                        "--motion-delay": `${Math.min(index * ROW_STAGGER_MS, ROW_STAGGER_CAP_MS)}ms`,
                      } as CSSProperties
                    }
                  >
                    <td className="py-3 pr-4 text-[0.875rem] text-ink-deep">{invite.email}</td>
                    <td className="py-3 pr-4 text-[0.875rem] text-body">
                      {invite.campusName || "—"}
                    </td>
                    <td className="py-3 pr-4">
                      <StatusBadge status={invite.status} />
                    </td>
                    <td className="py-3 pr-4 text-[0.8125rem] text-muted">
                      {formatDate(invite.createdAt)}
                    </td>
                    <td className="py-3 pl-4">
                      {invite.status === "activated" ? (
                        <span className="text-[0.8125rem] text-muted">—</span>
                      ) : confirmId === invite.id ? (
                        /* key is load-bearing. Both branches render a div, so
                           React would otherwise patch the attributes onto the
                           same node and the confirm panel would swap in with
                           no motion at all -- the exact moment a user most
                           needs to see that something changed. */
                        <div key="confirm" className="rise-in flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            autoFocus
                            onClick={() => void cancelInvitation(invite.id)}
                            disabled={busy}
                            className="pressable cursor-pointer rounded-full bg-ink px-3 py-1.5 text-[0.75rem] font-semibold text-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass focus-visible:ring-offset-2 disabled:opacity-45"
                          >
                            Yes, cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmId(null)}
                            disabled={busy}
                            className="pressable cursor-pointer rounded-full border border-line px-3 py-1.5 text-[0.75rem] font-medium text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass focus-visible:ring-offset-2 disabled:opacity-45"
                          >
                            Keep
                          </button>
                          <p role="status" className="basis-full text-[0.6875rem] text-muted">
                            The link will stop working immediately.
                          </p>
                        </div>
                      ) : (
                        <div key="actions" className="rise-in flex items-center gap-1.5">
                          <button
                            type="button"
                            aria-label={`Resend invitation to ${invite.email}`}
                            title={`Resend invitation to ${invite.email}`}
                            onClick={() => void resendInvitation(invite.id)}
                            disabled={busy}
                            className={controlClass}
                          >
                            <IconMail className="h-4 w-4" strokeWidth={1.9} />
                          </button>
                          <button
                            type="button"
                            aria-label={`Cancel invitation to ${invite.email}`}
                            title={`Cancel invitation to ${invite.email}`}
                            onClick={() =>
                              setConfirmId(confirmId === invite.id ? null : invite.id)
                            }
                            disabled={busy}
                            className={cn(controlClass, "hover:text-[#a5442c]")}
                          >
                            <IconClose className="h-4 w-4" strokeWidth={1.9} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}