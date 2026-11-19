"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { TimezonePicker } from "@/components/ui/TimezonePicker";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SectionIcon, selectClass } from "@/components/dashboard/workspace-shared";
import { IconCheckCircle, IconClose, IconEvents, IconPencil, IconShield } from "@/components/ui/Icons";
import { toDraftPayload, type DraftItem } from "@/lib/budgets";
import { CalendarPanel } from "@/components/dashboard/CalendarPanel";
import { AccomplishmentPanel } from "@/components/dashboard/AccomplishmentPanel";

type EvFile = { id: string; name: string; url: string | null; mimeType: string | null; sizeBytes: number | null };
type EvScope = { unitType: string | null; unitId: string | null };
type EvAssignee = { accountId: string; displayName: string };
type AssigneeOption = { accountId: string; displayName: string; email: string };
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
  assignees: EvAssignee[];
  assigneeCount: number;
  canAssign: boolean;
  isAssignedToMe: boolean;
  canReport: boolean;
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const view: "list" | "calendar" | "future" | "accomplishment" =
    tabParam === "calendar"
      ? "calendar"
      : tabParam === "future"
        ? "future"
        : tabParam === "accomplishment"
          ? "accomplishment"
          : "list";
  const setView = (next: "list" | "calendar" | "future" | "accomplishment") => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "list") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const [events, setEvents] = useState<Ev[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [filter, setFilter] = useState("all");

  const [showCreate, setShowCreate] = useState(false);
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);

  // create form
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [timezone, setTimezone] = useState("Asia/Manila");
  const [venue, setVenue] = useState("");
  const [scope, setScope] = useState(isUsg ? "university" : "unit");
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

  // assignees
  const [assignTarget, setAssignTarget] = useState<Ev | null>(null);
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignSaving, setAssignSaving] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignSelected, setAssignSelected] = useState<string[]>([]);
  const [assignCandidates, setAssignCandidates] = useState<AssigneeOption[]>([]);

  // budget
  const [budgetTarget, setBudgetTarget] = useState<Ev | null>(null);
  const [budgetTitle, setBudgetTitle] = useState("");
  const [budgetJustification, setBudgetJustification] = useState("");
  const [budgetItems, setBudgetItems] = useState<DraftItem[]>([
    { label: "", quantity: "1", unitCost: "" },
  ]);
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [budgetError, setBudgetError] = useState<string | null>(null);

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
    const t = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    if (isUsg) {
      fetch("/api/units")
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
    setScope(isUsg ? "university" : "unit");
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
      setCalendarRefreshKey((key) => key + 1);
      setNote(isUsg ? "Event created." : "Event claim submitted.");
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

  const openAssign = async (ev: Ev) => {
    setAssignTarget(ev);
    setAssignError(null);
    setAssignSelected([]);
    setAssignCandidates([]);
    setAssignLoading(true);
    try {
      const res = await fetch(`/api/events/${ev.id}/assignees`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.message);
      const assignees = (json.assignees ?? []) as AssigneeOption[];
      setAssignSelected(assignees.map((a) => a.accountId));
      setAssignCandidates((json.candidates ?? []) as AssigneeOption[]);
    } catch (e) {
      setAssignError(e instanceof Error ? e.message : "Could not load the assignees.");
    } finally {
      setAssignLoading(false);
    }
  };

  const saveAssign = async () => {
    if (!assignTarget) return;
    setAssignSaving(true);
    setAssignError(null);
    try {
      const res = await fetch(`/api/events/${assignTarget.id}/assignees`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountIds: assignSelected }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.message);
      setAssignTarget(null);
      setNote("Assignees saved.");
      await load();
    } catch (e) {
      setAssignError(e instanceof Error ? e.message : "Could not save the assignees.");
    } finally {
      setAssignSaving(false);
    }
  };

  const openBudget = (ev: Ev) => {
    setBudgetTarget(ev);
    setBudgetTitle(`${ev.title} budget`.slice(0, 140));
    setBudgetJustification("");
    setBudgetItems([{ label: "", quantity: "1", unitCost: "" }]);
    setBudgetError(null);
  };

  const submitBudget = async () => {
    if (!budgetTarget) return;
    if (budgetTitle.trim().length < 4) {
      setBudgetError("Give the budget a name of at least 4 characters.");
      return;
    }
    const payload = toDraftPayload(budgetItems);
    if (!payload.ok) {
      setBudgetError(payload.message);
      return;
    }

    setBudgetSaving(true);
    setBudgetError(null);
    try {
      const res = await fetch("/api/budgets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventId: budgetTarget.id,
          title: budgetTitle.trim(),
          justification: budgetJustification.trim(),
          items: payload.items,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.message);
      setBudgetTarget(null);
      setNote("Budget request submitted.");
    } catch (e) {
      setBudgetError(e instanceof Error ? e.message : "Could not submit the budget.");
    } finally {
      setBudgetSaving(false);
    }
  };

  const cancel = async (ev: Ev) => {
    if (saving) return;
    if (!window.confirm("Cancel this event?")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/events/${ev.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.message);
      setNote("Event cancelled.");
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not cancel.");
    } finally {
      setSaving(false);
    }
  };

  // calendar grouping

  return (
    <div className="mx-auto flex w-full max-w-[110rem] flex-col gap-6 px-4 py-8 sm:px-6 lg:px-10">
      <header data-tour="events-header" className="flex flex-col gap-2">
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

      <div data-tour="events-toolbar" className="flex flex-wrap items-center gap-2">
        <Button data-tour="events-create" size="sm" onClick={() => setShowCreate(true)}>
          <IconPencil className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          {isUsg ? "Create event" : "Add event"}
        </Button>
        <div className="flex gap-1">
          <button onClick={() => setView("list")} className={`rounded-full px-3 py-1 text-sm ${view === "list" ? "bg-ink text-canvas" : "border border-line text-ink"}`}>List</button>
          <button onClick={() => setView("calendar")} className={`rounded-full px-3 py-1 text-sm ${view === "calendar" ? "bg-ink text-canvas" : "border border-line text-ink"}`}>Calendar</button>
          <button onClick={() => setView("future")} className={`rounded-full px-3 py-1 text-sm ${view === "future" ? "bg-ink text-canvas" : "border border-line text-ink"}`}>Future Events</button>
          <button onClick={() => setView("accomplishment")} className={`rounded-full px-3 py-1 text-sm ${view === "accomplishment" ? "bg-ink text-canvas" : "border border-line text-ink"}`}>Accomplishment</button>
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-xl border border-line px-3 py-1.5 text-sm">
          <option value="all">All</option>
          <option value="open">Open</option>
          <option value="claimed">Claimed</option>
          <option value="honored">Honoured</option>
          <option value="not_honored">Not honoured</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {loading && <p className="text-muted">Loading…</p>}

      {view === "list" && !loading && (
        <div data-tour="events-list" className="grid gap-3">
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
                    {e.venue ? ` • ${e.venue}` : ""}
                  </div>
                  <div className="text-xs text-muted mt-1">
                    Scope: {e.scope} • Status: {e.status} • Honour: {e.honorStatus}
                    {e.source ? ` • Source: ${e.source}` : ""}
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
                  {e.assignees.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <span className="text-xs text-muted">Assigned to report:</span>
                      {e.assignees.map((a) => (
                        <span
                          key={a.accountId}
                          className="rounded-full border border-line px-2 py-0.5 text-xs text-ink"
                        >
                          {a.displayName}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  {e.canAssign && !e.cancelledAt && (
                    <Button size="sm" onClick={() => void openAssign(e)}>
                      Assign
                    </Button>
                  )}
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
                  {!e.cancelledAt && (
                    <Button size="sm" onClick={() => openBudget(e)}>
                      Submit budget
                    </Button>
                  )}
                  {e.canEdit && !e.cancelledAt && (
                    <button disabled={saving} onClick={() => void cancel(e)} className="inline-flex items-center justify-end gap-1.5 text-xs text-[#a5442c] underline disabled:opacity-50">
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

      {(view === "calendar" || view === "future") && !loading && (
        <CalendarPanel
          variant={view === "future" ? "future" : "calendar"}
          refreshKey={calendarRefreshKey}
          onCreate={view === "future" ? () => setShowCreate(true) : undefined}
        />
      )}

      {view === "accomplishment" && !loading && <AccomplishmentPanel isUsg={isUsg} />}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-line bg-paper p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-lg font-medium">{isUsg ? "Create event" : "Add event"}</div>
              <button onClick={() => setShowCreate(false)}>×</button>
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
              {isUsg ? (
                <>
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
                </>
              ) : (
                <div className="rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm text-body">
                  This will be added as an event claim for your unit. USG will review it before it is honoured.
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
                      ×
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
                  <div className="mb-1 text-sm text-muted">Note to USG (optional)</div>
                  <textarea value={claimNote} onChange={(e) => setClaimNote(e.target.value)} rows={2} className={selectClass} />
                </div>
              )}
              <Button disabled={saving || !title.trim() || !eventDate} onClick={() => void create()}>
                {saving ? "Saving…" : isUsg ? "Create event" : "Submit event"}
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

      {assignTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-2xl border border-line bg-paper p-6">
            <div className="mb-1 flex items-center justify-between gap-4">
              <div className="text-lg font-medium">Assign report filers</div>
              <button
                type="button"
                onClick={() => setAssignTarget(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <p className="mb-4 text-sm text-muted">
              {assignTarget.title}
              <br />
              Only the accounts you tick here can file an accomplishment report for this event.
            </p>

            {assignLoading && <p className="text-sm text-muted">Loading accounts…</p>}

            {!assignLoading && (
              <div className="grid gap-3">
                <div className="grid gap-1 sm:grid-cols-2">
                  {assignCandidates.map((candidate) => (
                    <label key={candidate.accountId} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={assignSelected.includes(candidate.accountId)}
                        onChange={(event) =>
                          setAssignSelected((prev) =>
                            event.target.checked
                              ? [...prev, candidate.accountId]
                              : prev.filter((id) => id !== candidate.accountId),
                          )
                        }
                      />
                      <span>
                        {candidate.displayName}
                        <span className="ml-1 text-xs text-muted">{candidate.email}</span>
                      </span>
                    </label>
                  ))}
                  {assignCandidates.length === 0 && (
                    <span className="text-xs text-muted">No active accounts available.</span>
                  )}
                </div>

                {assignError && (
                  <p className="rounded-xl border border-[#d9a99c] bg-[#a5442c]/[0.06] px-3.5 py-2.5 text-sm font-medium text-[#a5442c]">
                    {assignError}
                  </p>
                )}

                <Button disabled={assignSaving} onClick={() => void saveAssign()}>
                  {assignSaving ? "Saving…" : "Save assignees"}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {budgetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-line bg-paper p-6">
            <div className="mb-1 flex items-center justify-between gap-4">
              <div className="text-lg font-medium">Submit budget</div>
              <button
                type="button"
                onClick={() => setBudgetTarget(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <p className="mb-4 text-sm text-muted">
              {budgetTarget.title}
              {budgetTarget.eventDate ? ` • ${budgetTarget.eventDate}` : ""}
            </p>

            <div className="grid gap-3">
              <div>
                <div className="mb-1 text-sm text-muted">Request name</div>
                <input
                  value={budgetTitle}
                  onChange={(e) => setBudgetTitle(e.target.value)}
                  className={selectClass}
                />
              </div>
              <div>
                <div className="mb-1 text-sm text-muted">Justification</div>
                <textarea
                  value={budgetJustification}
                  onChange={(e) => setBudgetJustification(e.target.value)}
                  rows={2}
                  className={selectClass}
                />
              </div>

              <div>
                <div className="mb-1 text-sm text-muted">Lines</div>
                {budgetItems.map((row, i) => (
                  <div key={i} className="mb-2 grid gap-2 sm:grid-cols-[1fr_6rem_7rem_auto]">
                    <input
                      placeholder="Item"
                      value={row.label}
                      onChange={(e) =>
                        setBudgetItems((prev) =>
                          prev.map((item, j) =>
                            j === i ? { ...item, label: e.target.value } : item,
                          ),
                        )
                      }
                      className="rounded-lg border border-line px-2 py-1 text-sm"
                    />
                    <input
                      placeholder="Qty"
                      inputMode="decimal"
                      value={row.quantity}
                      onChange={(e) =>
                        setBudgetItems((prev) =>
                          prev.map((item, j) =>
                            j === i ? { ...item, quantity: e.target.value } : item,
                          ),
                        )
                      }
                      className="rounded-lg border border-line px-2 py-1 text-sm"
                    />
                    <input
                      placeholder="Unit cost"
                      inputMode="decimal"
                      value={row.unitCost}
                      onChange={(e) =>
                        setBudgetItems((prev) =>
                          prev.map((item, j) =>
                            j === i ? { ...item, unitCost: e.target.value } : item,
                          ),
                        )
                      }
                      className="rounded-lg border border-line px-2 py-1 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setBudgetItems((prev) => prev.filter((_, j) => j !== i))}
                      className="text-xs text-muted"
                      disabled={budgetItems.length === 1}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setBudgetItems((prev) => [...prev, { label: "", quantity: "1", unitCost: "" }])
                  }
                  className="text-sm text-muted"
                >
                  + Add line
                </button>
              </div>

              {budgetError && (
                <p className="rounded-xl border border-[#d9a99c] bg-[#a5442c]/[0.06] px-3.5 py-2.5 text-sm font-medium text-[#a5442c]">
                  {budgetError}
                </p>
              )}

              <Button disabled={budgetSaving} onClick={() => void submitBudget()}>
                {budgetSaving ? "Submitting…" : "Submit budget"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
