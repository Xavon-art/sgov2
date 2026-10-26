"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Enter } from "@/components/fx/Presence";
import { SwapText } from "@/components/fx/SwapText";
import { TextField } from "@/components/ui/Field";
import { useAccount } from "@/components/dashboard/dashboard-context";

type Ev = {
  id: string;
  title: string;
  description: string | null;
  eventDate: string;
  scope: string;
  unitId: string | null;
  status: string;
  supportFiles: { name?: string; url?: string }[];
  claimNote: string | null;
  decisionNote: string | null;
  createdAt: string;
  createdBy: string;
  canDecide: boolean;
};

export default function LsgEventsPage() {
  const account = useAccount();
  const isOwner = account.accountScope === "owner";

  const [events, setEvents] = useState<Ev[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [scope, setScope] = useState("unit");
  const [creating, setCreating] = useState(false);

  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [decision, setDecision] = useState<"honored" | "rejected">("honored");
  const [decisionNote, setDecisionNote] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/events");
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.message ?? "We could not load events.");
        return;
      }
      setEvents(data.events ?? []);
      setError(null);
    } catch {
      setError("We could not reach the server. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setNote(null);
    setActionError(null);
    if (!title.trim() || !eventDate) {
      setActionError("Give the event a title and a date.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          eventDate,
          scope,
          unitId: null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setActionError(data.message ?? "We could not create that event.");
        return;
      }
      setTitle("");
      setDescription("");
      setEventDate("");
      setNote("Event created.");
      await load();
    } catch {
      setActionError("We could not reach the server. Check your connection.");
    } finally {
      setCreating(false);
    }
  }

  async function decide(id: string) {
    setBusy(true);
    setActionError(null);
    setNote(null);
    try {
      const res = await fetch(`/api/events/${id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: decisionNote.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setActionError(data.message ?? "We could not record that decision.");
        return;
      }
      setNote(`Event ${decision}.`);
      setDecidingId(null);
      setDecisionNote("");
      await load();
    } catch {
      setActionError("We could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-[0.9375rem] text-muted">Loading…</p>;

  return (
    <div className="flex flex-col gap-8">
      <section className="card-lift rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
        <p className="eyebrow">New event</p>
        <form onSubmit={create} className="mt-5 flex flex-col gap-4">
          <TextField id="ev-title" label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <TextField id="ev-desc" label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} optional />
          <TextField id="ev-date" label="Date" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} required />
          <div className="flex flex-col gap-2">
            <label className="text-[0.8125rem] font-semibold text-ink">Scope</label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="h-12 w-full rounded-xl border border-line bg-paper/70 px-3.5 text-[0.9375rem] text-ink-deep"
            >
              <option value="unit">Unit</option>
              <option value="org">Organization-wide</option>
            </select>
          </div>
          {actionError ? (
            <Enter open as="p" role="alert" className="rounded-xl border border-[#d9a99c] bg-[#a5442c]/[0.06] px-3.5 py-2.5 text-[0.8125rem] font-medium text-[#a5442c]">
              {actionError}
            </Enter>
          ) : null}
          {note ? (
            <Enter open as="p" role="status" className="rounded-xl border border-brass/40 bg-brass-soft/25 px-3.5 py-2.5 text-[0.8125rem] font-medium text-ink">
              {note}
            </Enter>
          ) : null}
          <Button type="submit" disabled={creating}>
            <SwapText isPending={creating} idle="Create event" pending="Creating…" />
          </Button>
        </form>
      </section>

      <section className="card-lift rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
        <p className="eyebrow">Events ({events.length})</p>
        {error ? <p className="mt-3 text-[0.875rem] text-[#a5442c]">{error}</p> : null}
        {events.length === 0 ? (
          <p className="mt-4 text-[0.875rem] text-muted">No events yet.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {events.map((ev) => (
              <li key={ev.id} className="rounded-card border border-line bg-paper px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[0.9375rem] font-medium text-ink-deep">{ev.title}</p>
                    <p className="text-[0.75rem] text-muted">
                      {new Date(ev.eventDate).toLocaleDateString()} · {ev.status} · {ev.scope}
                    </p>
                    {ev.description ? <p className="mt-1 text-[0.8125rem] text-body">{ev.description}</p> : null}
                    {ev.decisionNote ? <p className="mt-1 text-[0.8125rem] text-muted">Note: {ev.decisionNote}</p> : null}
                  </div>
                  {ev.status === "upcoming" && !isOwner ? (
                    <button
                      type="button"
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const res = await fetch(`/api/events/${ev.id}/claim`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ supportFiles: [], claimNote: "" }),
                          });
                          const data = await res.json();
                          if (!res.ok || !data.ok) {
                            setActionError(data.message ?? "We could not claim that event.");
                            return;
                          }
                          setNote("Event claimed for review.");
                          await load();
                        } catch {
                          setActionError("We could not reach the server. Check your connection.");
                        } finally {
                          setBusy(false);
                        }
                      }}
                      disabled={busy}
                      className="pressable rounded-full border border-line px-3 py-1.5 text-[0.75rem] font-semibold text-ink hover:bg-paper"
                    >
                      Claim
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}