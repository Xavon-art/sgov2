"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { TimezonePicker } from "@/components/ui/TimezonePicker";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useAccount } from "@/components/dashboard/dashboard-context";
import { SectionIcon, selectClass } from "@/components/dashboard/workspace-shared";
import { IconCheckCircle, IconClose, IconEvents, IconPencil, IconShield } from "@/components/ui/Icons";

type EvFile = { id: string; name: string; url: string | null; mimeType: string | null; sizeBytes: number | null };
type EvScope = { unitType: string | null; unitId: string | null };
type Ev = {
  id: string;
  title: string;
  description: string | null;
  eventDate: string;
  eventTime: string | null;
  timezone: string | null;
  venue: string | null;
  scope: string;
  unitId: string | null;
  status: string;
  honorStatus: string;
  honorReason: string | null;
  source: string;
  supportFiles: unknown;
  files: EvFile[];
  scopes: EvScope[];
  claimNote: string | null;
  decisionNote: string | null;
  linkedRequest: string | null;
  cancelledAt: string | null;
  updatedAt: string;
  createdAt: string;
  createdBy: string;
  canDecide: boolean;
  canEdit: boolean;
  canClaim: boolean;
};

type Unit = { id: string; name: string; unitType?: string };

const SCOPE_OPTIONS = [
  { value: "university", label: "Whole university" },
  { value: "unit_type", label: "By unit type" },
  { value: "units", label: "Selected units" },
  { value: "unit", label: "One unit" },
];

const UNIT_TYPES = ["usg", "lsg", "department", "council", "committee"];

export function EventsWorkspace({ isUsg }: { isUsg: boolean }) {
  const account = useAccount();
  const [events, setEvents] = useState<Ev[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [filter, setFilter] = useState("all");
  const [view, setView] = useState<"list" | "calendar">("list");
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<Ev | null>(null);

  // create form
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [timezone, setTimezone] = useState("Asia/Manila");
  const [venue, setVenue] = useState("");
  const [scope, setScope] = useState("university");
  const [unitTypes, setUnitTypes] = useState<string[]>([]);
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [files, setFiles] = useState<Array<{ name: string; url: string }>>([]);
  const [claimNote, setClaimNote] = useState("");
  const [saving, setSaving] = useState(false);

  // decide
  const [decideOpen, setDecideOpen] = useState(false);
  const [decideDecision, setDecideDecision] = useState<"honored" | "not_honored">("honored");
  const [decideNote, setDecideNote] = useState("");
  const [decideTarget, setDecideTarget] = useState<Ev | null>(null);

  const [claimOpen, setClaimOpen] = useState(false);
  const [claimTarget, setClaimTarget] = useState<Ev | null>(null);
  const [claimNoteInput, setClaimNoteInput] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/events");
      const json = await res.json();
      if (!json.ok) throw new Error(json.message);
      setEvents(json.events ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load events.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    if (isUsg) {
      fetch("/api/umbrella")
        .then((r) => r.json())
        .then((j) => {
          if (j.ok && Array.isArray(j.units)) {
            setUnits(
              j.units.map((u: { id?: string; unitId?: string; name?: string; unitName?: string }) => ({
                id: String(u.id ?? u.unitId ?? ""),
                name: String(u.name ?? u.unitName ?? "Unit"),
              })),
            );
          }
        })
        .catch(() => {});
    }
  }, [isUsg]);

  const filtered = events.filter((e) => {
    if (filter === "all") return true;
    if (filter === "open") return e.status === "open" || e.status === "claimed";
    if (filter === "claimed") return e.status === "claimed";
    if (filter === "honored") return e.honorStatus === "honored";
    if (filter === "not_honored") return e.honorStatus === "not_honored";
    if (filter === "cancelled") return e.cancelledAt !== null;
    return true;
  });

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setEventDate("");
    setEventTime("");
    setTimezone("Asia/Manila");
    setVenue("");
    setScope("university");
    setUnitTypes([]);
    setUnitIds([]);
    setFiles([]);
    setClaimNote("");
  };

  const create = async () => {
    if (!title.trim() || !eventDate) {
      setActionError("Title and date are required.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          description: description || null,
          eventDate,
          eventTime: eventTime || null,
          timezone,
          venue: venue || null,
          scope,
          unitIds: scope === "units" || scope === "unit" ? unitIds : [],
          unitTypes: scope === "unit_type" ? unitTypes : [],
          files: files.filter((f) => f.name && f.url),
          claimNote: isUsg ? null : claimNote || null,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.message);
      setShowCreate(false);
      resetForm();
      setNote("Event created.");
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not create event.");
    } finally {
      setSaving(false);
    }
  };

  const decide = async () => {
    if (!decideTarget) return;
    if (decideDecision === "not_honored" && decideNote.trim().length < 3) {
      setActionError("A reason is required when not honouring.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/events/${decideTarget.id}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: decideDecision, note: decideNote }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.message);
      setDecideOpen(false);
      setDecideTarget(null);
      setDecideNote("");
      setNote(decideDecision === "honored" ? "Event honoured." : "Event not honoured.");
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not decide.");
    } finally {
      setSaving(false);
    }
  };

  const claim = async () => {
    if (!claimTarget) return;
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/events/${claimTarget.id}/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: claimNoteInput }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.message);
      setClaimOpen(false);
      setClaimTarget(null);
      setClaimNoteInput("");
      setNote("Claimed as approved.");
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not claim.");
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (ev: Ev) => {
    if (!window.confirm("Cancel this event?")) return;
    try {
      const res = await fetch(`/api/events/${ev.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.message);
      setNote("Event cancelled.");
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not cancel.");
    }
  };

  // calendar grouping
  const daysInMonth = (() => {
    const [y, m] = month.split("-").map(Number);
    return new Date(y, m, 0).getDate();
  })();
  const firstWeekday = (() => {
    const [y, m] = month.split("-").map(Number);
    return new Date(y, m - 1, 1).getDay();
  })();
  const eventsByDate = new Map<string, Ev[]>();
  for (const e of filtered) {
    const arr = eventsByDate.get(e.eventDate) ?? [];
    arr.push(e);
    eventsByDate.set(e.eventDate, arr);
  }

  return (
    <div className="mx-auto flex w-full max-w-[110rem] flex-col gap-6 px-4 py-8 sm:px-6 lg:px-10">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <SectionIcon>
            <IconEvents className="h-5 w-5" strokeWidth={1.7} />
          </SectionIcon>
          <div className="flex flex-col gap-1">
            <p className="text-xs uppercase tracking-[0.32em] text-muted">Events</p>
            <h1 className="text-[clamp(2rem,4vw,3.4rem)] leading-[1.02]">Events and acts</h1>
          </div>
        </div>
        <p className="max-w-2xl text-[0.98rem] leading-relaxed text-body">
          {isUsg
            ? "Schedule university events, honour claims from units, and track the calendar."
            : "View events, claim approval for your unit, and propose events upward."}
        </p>
      </header>

      {note && <p className="rounded-xl border border-brass/40 bg-brass-soft/25 px-3.5 py-2.5 text-sm font-medium text-ink">{note}</p>}
      {actionError && <p className="rounded-xl border border-[#d9a99c] bg-[#a5442c]/[0.06] px-3.5 py-2.5 text-sm font-medium text-[#a5442c]">{actionError}</p>}
      {error && <p className="text-sm text-[#a5442c]">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <IconPencil className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          Create event
        </Button>
        <div className="flex gap-1">
          <button onClick={() => setView("list")} className={`rounded-full px-3 py-1 text-sm ${view === "list" ? "bg-ink text-canvas" : "border border-line text-ink"}`}>List</button>
          <button onClick={() => setView("calendar")} className={`rounded-full px-3 py-1 text-sm ${view === "calendar" ? "bg-ink text-canvas" : "border border-line text-ink"}`}>Calendar</button>
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-xl border border-line px-3 py-1.5 text-sm">
          <option value="all">All</option>
          <option value="open">Open</option>
          <option value="claimed">Claimed</option>
          <option value="honored">Honoured</option>
          <option value="not_honored">Not honoured</option>
          <option value="cancelled">Cancelled</option>
        </select>
        {view === "calendar" && (
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-xl border border-line px-3 py-1.5 text-sm" />
        )}
      </div>

      {loading && <p className="text-muted">Loading…</p>}

      {view === "list" && !loading && (
        <div className="grid gap-3">
          {filtered.length === 0 && <p className="text-muted">No events.</p>}
          {filtered.map((e) => (
            <div key={e.id} className="rounded-2xl border border-line bg-paper p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-lg font-medium">{e.title}</div>
                  <div className="text-sm text-muted">
                    {e.eventDate}
                    {e.eventTime ? ` ${e.eventTime}` : ""}
                    {e.timezone ? ` (${e.timezone})` : ""}
                    {e.venue ? ` · ${e.venue}` : ""}
                  </div>
                  <div className="text-xs text-muted mt-1">
                    Scope: {e.scope} · Status: {e.status} · Honour: {e.honorStatus}
                    {e.source ? ` · Source: ${e.source}` : ""}
                  </div>
                  {e.description && <p className="mt-2 text-sm text-body whitespace-pre-wrap">{e.description}</p>}
                  {e.files.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {e.files.map((f) => (
                        <a key={f.id} href={f.url ?? "#"} target="_blank" className="text-xs underline text-ink">
                          {f.name}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  {e.canDecide && (
                    <Button size="sm" onClick={() => { setDecideTarget(e); setDecideOpen(true); }}>
                      <IconCheckCircle className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                      Decide
                    </Button>
                  )}
                  {e.canClaim && (
                    <Button size="sm" onClick={() => { setClaimTarget(e); setClaimOpen(true); }}>
                      <IconShield className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                      Claim
                    </Button>
                  )}
                  {e.canEdit && !e.cancelledAt && (
                    <button onClick={() => void cancel(e)} className="inline-flex items-center justify-end gap-1.5 text-xs text-[#a5442c] underline">
                      <IconClose className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                      Cancel
                    </button>
                  )}
                </div>
              </div>
              {e.honorReason && (
                <p className="mt-2 text-sm text-muted">Honour reason: {e.honorReason}</p>
              )}
              {e.decisionNote && (
                <p className="mt-1 text-sm text-muted">Decision note: {e.decisionNote}</p>
              )}
              {e.claimNote && (
                <p className="mt-1 text-sm text-muted">Claim note: {e.claimNote}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {view === "calendar" && !loading && (
        <div className="rounded-2xl border border-line bg-paper p-4">
          <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-7 gap-1">
            {Array.from({ length: firstWeekday }).map((_, i) => (
              <div key={`pad-${i}`} />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dateStr = `${month}-${String(day).padStart(2, "0")}`;
              const dayEvents = eventsByDate.get(dateStr) ?? [];
              return (
                <div key={day} className="min-h-[4rem] rounded-lg border border-line p-1 text-xs">
                  <div className="font-medium text-muted">{day}</div>
                  {dayEvents.map((e) => (
                    <div key={e.id} className="mt-0.5 truncate rounded bg-brass-soft/40 px-1 text-[0.65rem] text-ink">
                      {e.title}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-line bg-paper p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-lg font-medium">Create event</div>
              <button onClick={() => setShowCreate(false)}>✕</button>
            </div>
            <div className="grid gap-3">
              <div>
                <div className="mb-1 text-sm text-muted">Title</div>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className={selectClass} />
              </div>
              <div>
                <div className="mb-1 text-sm text-muted">Description</div>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={selectClass} />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <div className="mb-1 text-sm text-muted">Date</div>
                  <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} className={selectClass} />
                </div>
                <div>
                  <div className="mb-1 text-sm text-muted">Time</div>
                  <input type="time" value={eventTime} onChange={(e) => setEventTime(e.target.value)} className={selectClass} />
                </div>
                <div>
                  <div className="mb-1 text-sm text-muted">Timezone</div>
                  <TimezonePicker value={timezone} onChange={setTimezone} />
                </div>
              </div>
              <div>
                <div className="mb-1 text-sm text-muted">Venue</div>
                <input value={venue} onChange={(e) => setVenue(e.target.value)} className={selectClass} />
              </div>
              <div>
                <div className="mb-1 text-sm text-muted">Scope</div>
                <select value={scope} onChange={(e) => setScope(e.target.value)} className={selectClass}>
                  {SCOPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              {scope === "unit_type" && (
                <div>
                  <div className="mb-1 text-sm text-muted">Unit types</div>
                  <div className="flex flex-wrap gap-2">
                    {UNIT_TYPES.map((t) => (
                      <label key={t} className="flex items-center gap-1 text-sm">
                        <input
                          type="checkbox"
                          checked={unitTypes.includes(t)}
                          onChange={(e) =>
                            setUnitTypes((prev) =>
                              e.target.checked ? [...prev, t] : prev.filter((x) => x !== t),
                            )
                          }
                        />
                        {t}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {(scope === "units" || scope === "unit") && (
                <div>
                  <div className="mb-1 text-sm text-muted">Units</div>
                  <div className="grid gap-1 sm:grid-cols-2">
                    {units.map((u) => (
                      <label key={u.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={unitIds.includes(u.id)}
                          onChange={(e) =>
                            setUnitIds((prev) =>
                              e.target.checked ? [...prev, u.id] : prev.filter((x) => x !== u.id),
                            )
                          }
                        />
                        {u.name}
                      </label>
                    ))}
                    {units.length === 0 && (
                      <span className="text-xs text-muted">No units available.</span>
                    )}
                  </div>
                </div>
              )}
              <div>
                <div className="mb-1 text-sm text-muted">Support links</div>
                {files.map((f, i) => (
                  <div key={i} className="mb-1 flex gap-2">
                    <input
                      placeholder="Name"
                      value={f.name}
                      onChange={(e) => {
                        const n = [...files];
                        n[i] = { ...n[i], name: e.target.value };
                        setFiles(n);
                      }}
                      className="flex-1 rounded-lg border border-line px-2 py-1 text-sm"
                    />
                    <input
                      placeholder="https://..."
                      value={f.url}
                      onChange={(e) => {
                        const n = [...files];
                        n[i] = { ...n[i], url: e.target.value };
                        setFiles(n);
                      }}
                      className="flex-1 rounded-lg border border-line px-2 py-1 text-sm"
                    />
                    <button onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="text-xs text-muted">
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setFiles((prev) => [...prev, { name: "", url: "" }])}
                  className="text-sm text-muted"
                >
                  + Add link
                </button>
              </div>
              {!isUsg && (
                <div>
                  <div className="mb-1 text-sm text-muted">Claim note (optional)</div>
                  <textarea value={claimNote} onChange={(e) => setClaimNote(e.target.value)} rows={2} className={selectClass} />
                </div>
              )}
              <Button disabled={saving || !title.trim() || !eventDate} onClick={() => void create()}>
                {saving ? "Creating…" : "Create"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {decideOpen && decideTarget && (
        <ConfirmDialog
          open
          title={decideDecision === "honored" ? "Honour event" : "Not honour event"}
          description={
            <div className="grid gap-2">
              <div className="flex gap-2">
                <button
                  onClick={() => setDecideDecision("honored")}
                  className={`rounded-full px-3 py-1 text-sm ${decideDecision === "honored" ? "bg-ink text-canvas" : "border border-line text-ink"}`}
                >
                  Honour
                </button>
                <button
                  onClick={() => setDecideDecision("not_honored")}
                  className={`rounded-full px-3 py-1 text-sm ${decideDecision === "not_honored" ? "bg-ink text-canvas" : "border border-line text-ink"}`}
                >
                  Not honour
                </button>
              </div>
              <textarea
                value={decideNote}
                onChange={(e) => setDecideNote(e.target.value)}
                rows={3}
                className={selectClass}
                placeholder={decideDecision === "not_honored" ? "Reason (required)" : "Note (optional)"}
              />
            </div>
          }
          confirmLabel={decideDecision === "honored" ? "Honour" : "Not honour"}
          onConfirm={() => void decide()}
          onCancel={() => {
            setDecideOpen(false);
            setDecideTarget(null);
            setDecideNote("");
          }}
        />
      )}

      {claimOpen && claimTarget && (
        <ConfirmDialog
          open
          title="Claim event as approved"
          description={
            <div className="grid gap-2">
              <p className="text-sm text-body">
                This will be recorded as &quot;Claimed as approved&quot; and sent to the USG for honouring.
              </p>
              <textarea
                value={claimNoteInput}
                onChange={(e) => setClaimNoteInput(e.target.value)}
                rows={3}
                className={selectClass}
                placeholder="Claim note (optional)"
              />
            </div>
          }
          confirmLabel="Claim"
          onConfirm={() => void claim()}
          onCancel={() => {
            setClaimOpen(false);
            setClaimTarget(null);
            setClaimNoteInput("");
          }}
        />
      )}
    </div>
  );
}