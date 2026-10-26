"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/Button";
import { Enter } from "@/components/fx/Presence";
import { SwapText } from "@/components/fx/SwapText";
import { TextField } from "@/components/ui/Field";
import { cn } from "@/lib/utils";
import { ROW_STAGGER_CAP_MS, ROW_STAGGER_MS, formatDate } from "./workspace-shared";


type Officer = {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
  statusLabel: string;
  deactivatedAt: string | null;
  deactivationReason: string | null;
  deactivatedEmail: string | null;
  seat: string | null;
};

export function OfficersPanel() {
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [replacementEmail, setReplacementEmail] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  const [purgingId, setPurgingId] = useState<string | null>(null);
  const [confirmEmail, setConfirmEmail] = useState("");

  async function load() {
    try {
      const res = await fetch("/api/officers");
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.message ?? "We could not load officers.");
        return;
      }
      setOfficers(data.officers ?? []);
      setError(null);
    } catch {
      setError("We could not reach the server. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function deactivate(id: string) {
    setBusy(true);
    setActionError(null);
    setNote(null);
    try {
      const res = await fetch(`/api/officers/${id}/deactivate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: reason.trim(),
          replacementEmail: replacementEmail.trim(),
          startsAt: startsAt ? new Date(startsAt).toISOString() : null,
          endsAt: endsAt ? new Date(endsAt).toISOString() : null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setActionError(data.message ?? "We could not deactivate that officer.");
        return;
      }
      setNote(
        data.handoverSent
          ? `Deactivated. A handover link was sent to ${data.replacementEmail}.`
          : "Officer deactivated.",
      );
      setDeactivatingId(null);
      setReason("");
      setReplacementEmail("");
      setStartsAt("");
      setEndsAt("");
      await load();
    } catch {
      setActionError("We could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  async function purge(id: string) {
    setBusy(true);
    setActionError(null);
    setNote(null);
    try {
      const res = await fetch(`/api/officers/${id}/purge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmEmail: confirmEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setActionError(data.message ?? "We could not remove that officer.");
        return;
      }
      setNote(`${data.purgedEmail} removed. ${data.seatsFreed} seat(s) freed.`);
      setPurgingId(null);
      setConfirmEmail("");
      await load();
    } catch {
      setActionError("We could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-2.5" aria-live="polite">
        <div className="fade-in h-11 animate-pulse rounded-xl bg-ink/[0.05]" />
        <div className="fade-in h-11 animate-pulse rounded-xl bg-ink/[0.05]" style={{ animationDelay: "70ms" }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-card border border-line bg-paper px-4 py-5">
        <p className="text-[0.9375rem] leading-relaxed text-body">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-[0.9375rem] hover:bg-canvas"
        >
          Try again
        </button>
      </div>
    );
  }

  if (officers.length === 0) {
    return (
      <div className="rise-in rounded-2xl border border-dashed border-line-strong bg-canvas/40 px-5 py-6">
        <p className="text-[0.9375rem] font-medium text-ink">No officers yet</p>
        <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-muted">
          Invite officers from the Invitations screen; they appear here once their account exists.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {note ? (
        <Enter open as="p" role="status" className="rise-in flex items-center gap-2 rounded-xl border border-brass/40 bg-brass-soft/25 px-3.5 py-2.5 text-[0.8125rem] font-medium text-ink">
          {note}
        </Enter>
      ) : null}
      {actionError ? (
        <Enter open as="p" role="alert" className="rise-in rounded-xl border border-[#d9a99c] bg-[#a5442c]/[0.06] px-3.5 py-2.5 text-[0.8125rem] font-medium text-[#a5442c]">
          {actionError}
        </Enter>
      ) : null}

      <div className="fade-in overflow-x-auto">
        <table className="w-full min-w-[44rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-line">
              {["Officer", "Status", "Seat", "Actions"].map((h) => (
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
            {officers.map((o, index) => {
              const isDeactivating = deactivatingId === o.id;
              const isPurging = purgingId === o.id;
              return (
                <tr
                  key={o.id}
                  className="row-in border-b border-line/70 last:border-b-0"
                  style={{ "--motion-delay": `${Math.min(index * ROW_STAGGER_MS, ROW_STAGGER_CAP_MS)}ms` } as CSSProperties}
                >
                  <td className="py-3 pr-4">
                    <div className="text-[0.875rem] font-medium text-ink-deep">{o.displayName || o.email}</div>
                    {o.displayName ? <div className="text-[0.75rem] text-muted">{o.email}</div> : null}
                    {o.deactivatedAt ? (
                      <div className="mt-1 text-[0.7rem] text-muted">
                        Deactivated {formatDate(o.deactivatedAt)}
                        {o.deactivationReason ? ` — ${o.deactivationReason}` : ""}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={cn(
                        "pop-in inline-flex items-center rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold tracking-[0.06em] uppercase",
                        o.statusLabel === "deactivated"
                          ? "bg-[#a5442c]/10 text-[#a5442c]"
                          : o.statusLabel === "invited"
                          ? "bg-brass-soft/45 text-brass-deep"
                          : "bg-ink text-canvas",
                      )}
                    >
                      {o.statusLabel}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-[0.8125rem] text-body">{o.seat || "—"}</td>
                  <td className="py-3 pl-4">
                    {isDeactivating ? (
                      <div className="rise-in flex flex-col gap-3 rounded-xl border border-line bg-paper/70 p-3">
                        <TextField
                          id={`reason-${o.id}`}
                          label="Reason (optional)"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder="Retiring, end of term…"
                        />
                        <TextField
                          id={`replacement-${o.id}`}
                          label="Replacement email (optional)"
                          type="email"
                          value={replacementEmail}
                          onChange={(e) => setReplacementEmail(e.target.value)}
                          placeholder="successor@campus.edu"
                          hint="Leave blank to just suspend. A handover link will be emailed."
                        />
                        <div className="grid gap-3 sm:grid-cols-2">
                          <TextField
                            id={`starts-${o.id}`}
                            label="Starts (optional)"
                            type="datetime-local"
                            value={startsAt}
                            onChange={(e) => setStartsAt(e.target.value)}
                            hint="Leave blank for immediate."
                          />
                          <TextField
                            id={`ends-${o.id}`}
                            label="Ends (optional)"
                            type="datetime-local"
                            value={endsAt}
                            onChange={(e) => setEndsAt(e.target.value)}
                            hint="Auto-reactivates after this date."
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button size="sm" disabled={busy} onClick={() => void deactivate(o.id)}>
                            <SwapText isPending={busy} idle="Deactivate" pending="Working…" />
                          </Button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeactivatingId(null);
                              setReason("");
                              setReplacementEmail("");
                              setStartsAt("");
                              setEndsAt("");
                            }}
                            disabled={busy}
                            className="pressable cursor-pointer rounded-full border border-line px-3 py-1.5 text-[0.75rem] font-medium text-muted"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : isPurging ? (
                      <div className="rise-in flex flex-col gap-3 rounded-xl border border-[#d9a99c] bg-[#a5442c]/[0.04] p-3">
                        <p className="text-[0.8125rem] leading-relaxed text-body">
                          This permanently deletes the account. Type the officer&apos;s email to confirm.
                        </p>
                        <TextField
                          id={`confirm-${o.id}`}
                          label="Confirm email"
                          type="email"
                          value={confirmEmail}
                          onChange={(e) => setConfirmEmail(e.target.value)}
                          placeholder={o.email}
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void purge(o.id)}
                            disabled={busy || confirmEmail.trim().toLowerCase() !== o.email.toLowerCase()}
                            className="pressable cursor-pointer rounded-full bg-[#a5442c] px-3 py-1.5 text-[0.75rem] font-semibold text-canvas disabled:opacity-45"
                          >
                            <SwapText isPending={busy} idle="Purge permanently" pending="Working…" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPurgingId(null);
                              setConfirmEmail("");
                            }}
                            disabled={busy}
                            className="pressable cursor-pointer rounded-full border border-line px-3 py-1.5 text-[0.75rem] font-medium text-muted"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          title={`Deactivate ${o.email}`}
                          disabled={busy || o.statusLabel === "deactivated"}
                          onClick={() => {
                            setDeactivatingId(o.id);
                            setPurgingId(null);
                            setReason("");
                            setReplacementEmail("");
                            setStartsAt("");
                            setEndsAt("");
                          }}
                          className="pressable rounded-full border border-line px-3 py-1.5 text-[0.7rem] font-semibold text-ink hover:bg-paper disabled:opacity-40"
                        >
                          Deactivate
                        </button>
                        <button
                          type="button"
                          title={`Purge ${o.email}`}
                          disabled={busy}
                          onClick={() => {
                            setPurgingId(o.id);
                            setDeactivatingId(null);
                            setConfirmEmail("");
                          }}
                          className="pressable rounded-full border border-line px-3 py-1.5 text-[0.7rem] font-semibold text-[#a5442c] hover:bg-[#a5442c]/[0.06]"
                        >
                          Purge
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}