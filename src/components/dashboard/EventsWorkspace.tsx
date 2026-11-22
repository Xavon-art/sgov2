"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { TimezonePicker } from "@/components/ui/TimezonePicker";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SectionIcon, selectClass } from "@/components/dashboard/workspace-shared";
import { IconCheckCircle, IconClose, IconEvents, IconPencil, IconShield } from "@/components/ui/Icons";
import { formatMoney, parseAmount, toDraftPayload, type BudgetRow } from "@/lib/budgets";
import { CalendarPanel } from "@/components/dashboard/CalendarPanel";
import { AccomplishmentPanel } from "@/components/dashboard/AccomplishmentPanel";
import { useBudgetStore } from "./budget-store";

type EvFile = { id: string; name: string; url: string | null; mimeType: string | null; sizeBytes: number | null };
type EvScope = { unitType: string | null; unitId: string | null };
type ReportRequiredUnit = {
  unitId: string;
  unitName: string;
  required: boolean;
  reportStatus?: string | null;
  reportId?: string | null;
};
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
  assigneeCount: number;
  canAssign: boolean;
  isAssignedToMe: boolean;
  canReport: boolean;
  requiredForMyUnit?: boolean;
  reportStatus?: string | null;
  reportId?: string | null;
  reportRequiredUnits?: ReportRequiredUnit[];
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
  const [editTarget, setEditTarget] = useState<Ev | null>(null);
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

  // budget
  const { budgets, loading: budgetsLoading, refresh: refreshBudgets } = useBudgetStore();
  const [budgetTarget, setBudgetTarget] = useState<Ev | null>(null);
  const [budgetTitle, setBudgetTitle] = useState("");
  const [budgetJustification, setBudgetJustification] = useState("");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [budgetError, setBudgetError] = useState<string | null>(null);

  const [spendTarget, setSpendTarget] = useState<{ event: Ev; budget: BudgetRow } | null>(null);
  const [spendAmount, setSpendAmount] = useState("");
  const [spendSaving, setSpendSaving] = useState(false);
  const [spendError, setSpendError] = useState<string | null>(null);

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

  const loadBudgets = useCallback(async () => {
    await refreshBudgets();
  }, [refreshBudgets]);

  useEffect(() => {
    const t = setTimeout(() => {
      void load();
      void loadBudgets();
    }, 0);
    return () => clearTimeout(t);
  }, [load, loadBudgets]);

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

  const approvedBudgets = useMemo(() => {
    const map = new Map<string, BudgetRow>();
    for (const row of budgets) {
      if (row.status === "approved" && row.eventId) {
        map.set(row.eventId, row);
      }
    }
    return map;
  }, [budgets]);

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
    setEditTarget(null);
  };

  const closeEventForm = () => {
    setShowCreate(false);
    resetForm();
  };

  const openEdit = (ev: Ev) => {
    setEditTarget(ev);
    setTitle(ev.title);
    setDescription(ev.description ?? "");
    setEventDate(ev.eventDate);
    setEventTime(ev.eventTime ? ev.eventTime.slice(0, 5) : "");
    setTimezone(ev.timezone ?? "Asia/Manila");
    setVenue(ev.venue ?? "");
    setActionError(null);
    setShowCreate(true);
  };

  const create = async () => {
    const editing = editTarget !== null;
    if (!title.trim() || !eventDate) {
      setActionError("Title and date are required.");
      return;
    }
    if (editing && title.trim().length < 3) {
      setActionError("Give the event a title of at least 3 characters.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch(editing ? `/api/events/${editTarget?.id}` : "/api/events", {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          editing
            ? {
                title: title.trim(),
                description: description || null,
                eventDate,
                eventTime: eventTime || null,
                timezone: timezone || null,
                venue: venue || null,
              }
            : {
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
              },
        ),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.message);
      setShowCreate(false);
      resetForm();
      setCalendarRefreshKey((key) => key + 1);
      setNote(editing ? "Event updated." : isUsg ? "Event created." : "Event claim submitted.");
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : editing ? "Could not update event." : "Could not create event.");
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
    if (!claimNoteInput.trim()) {
      setActionError("Enter a claim note before claiming.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/events/${claimTarget.id}/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ claimNote: claimNoteInput }),
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

  const openBudget = (ev: Ev) => {
    setBudgetTarget(ev);
    setBudgetTitle(`${ev.title} budget`.slice(0, 140));
    setBudgetJustification("");
    setBudgetAmount("");
    setBudgetError(null);
  };

  const submitBudget = async () => {
    if (!budgetTarget) return;
    if (budgetTitle.trim().length < 4) {
      setBudgetError("Give the budget a name of at least 4 characters.");
      return;
    }
    const amount = parseAmount(budgetAmount);
    if (amount === null || amount <= 0) {
      setBudgetError("Enter an overall budget request above zero.");
      return;
    }
    const payload = toDraftPayload([
      { label: "Overall budget request", quantity: "1", unitCost: budgetAmount },
    ]);
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
      await loadBudgets();
    } catch (e) {
      setBudgetError(e instanceof Error ? e.message : "Could not submit the budget.");
    } finally {
      setBudgetSaving(false);
    }
  };

  const approvedBudgetFor = (eventId: string) => approvedBudgets.get(eventId) ?? null;

  const openSpending = (ev: Ev, budget: BudgetRow) => {
    setSpendTarget({ event: ev, budget });
    setSpendAmount(String(budget.actualSpent ?? 0));
    setSpendError(null);
  };

  const saveSpending = async () => {
    if (!spendTarget) return;
    const amount = parseAmount(spendAmount);
    const approved = Number(spendTarget.budget.approvedTotal ?? 0);
    if (amount === null || amount < 0) {
      setSpendError("Enter a valid amount.");
      return;
    }
    if (amount > approved) {
      setSpendError("Spending cannot exceed the approved budget.");
      return;
    }
    setSpendSaving(true);
    setSpendError(null);
    try {
      const res = await fetch(`/api/budgets/${spendTarget.budget.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actualSpent: amount }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.message);
      setSpendTarget(null);
      setNote("Spending recorded.");
      await loadBudgets();
    } catch (e) {
      setSpendError(e instanceof Error ? e.message : "Could not record spending.");
    } finally {
      setSpendSaving(false);
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

  const removeEvent = async (ev: Ev) => {
    if (saving) return;
    if (!window.confirm("Delete this event?")) return;
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/events/${ev.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.message);
      setNote("Event deleted.");
      setCalendarRefreshKey((key) => key + 1);
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not delete event.");
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
        <Button data-tour="events-create" size="sm" onClick={() => { resetForm(); setShowCreate(true); }}>
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
      {budgetsLoading && !loading && <p className="text-xs text-muted">Loading budgets…</p>}

      {view === "list" && !loading && (
        <div data-tour="events-list" className="grid gap-3">
          {filtered.length === 0 && <p className="text-muted">No events.</p>}
          {filtered.map((e) => {
            const approvedBudget = approvedBudgetFor(e.id);
            return (
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
                  {e.reportRequiredUnits && e.reportRequiredUnits.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <span className="text-xs text-muted">Report required from:</span>
                      {e.reportRequiredUnits.map((unit) => (
                        <span
                          key={unit.unitId}
                          className="rounded-full border border-line px-2 py-0.5 text-xs text-ink"
                        >
                          {unit.unitName}
                          {unit.reportStatus ? ` • ${unit.reportStatus}` : ""}
                        </span>
                      ))}
                    </div>
                  )}
                  {(!e.reportRequiredUnits || e.reportRequiredUnits.length === 0) && e.requiredForMyUnit && (
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <span className="text-xs text-muted">Report required from:</span>
                      <span className="rounded-full border border-line px-2 py-0.5 text-xs text-ink">Your unit</span>
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
                  {!isUsg && !e.cancelledAt && (
                    <Button size="sm" onClick={() => openBudget(e)}>
                      Submit budget
                    </Button>
                  )}
                  {!isUsg && !e.cancelledAt && approvedBudget && (
                    <Button size="sm" onClick={() => openSpending(e, approvedBudget)}>Record spending</Button>
                  )}
                  {e.canEdit && !isUsg && !e.cancelledAt && (
                    <>
                      <button disabled={saving} onClick={() => openEdit(e)} className="inline-flex items-center justify-end text-xs text-ink underline disabled:opacity-50">EDIT</button>
                      <button disabled={saving} onClick={() => void removeEvent(e)} className="inline-flex items-center justify-end text-xs text-[#a5442c] underline disabled:opacity-50">DELETE</button>
                    </>
                  )}
                  {e.canEdit && isUsg && !e.cancelledAt && (
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
              {!isUsg && approvedBudget && (
                <div className="mt-3 grid gap-2 rounded-xl border border-line bg-canvas/40 p-3 sm:grid-cols-3">
                  <div data-testid="event-approved-budget">
                    <div className="text-xs text-muted">Approved budget</div>
                    <div className="text-base font-medium tabular-nums text-ink">₱{formatMoney(approvedBudget.approvedTotal ?? 0)}</div>
                  </div>
                  <div data-testid="event-actual-spent">
                    <div className="text-xs text-muted">Total expenses</div>
                    <div className="text-base font-medium tabular-nums text-ink">₱{formatMoney(approvedBudget.actualSpent ?? 0)}</div>
                  </div>
                  <div data-testid="event-remaining-budget">
                    <div className="text-xs text-muted">Remaining budget</div>
                    <div className="text-base font-medium tabular-nums text-ink">
                      ₱{formatMoney(Math.max(0, Number(approvedBudget.approvedTotal ?? 0) - Number(approvedBudget.actualSpent ?? 0)))}
                    </div>
                  </div>
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      {(view === "calendar" || view === "future") && !loading && (
        <CalendarPanel
          variant={view === "future" ? "future" : "calendar"}
          refreshKey={calendarRefreshKey}
          onCreate={view === "future" ? () => { resetForm(); setShowCreate(true); } : undefined}
        />
      )}

      {view === "accomplishment" && !loading && <AccomplishmentPanel isUsg={isUsg} />}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-line bg-paper p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-lg font-medium">{editTarget ? "Edit event" : isUsg ? "Create event" : "Add event"}</div>
              <button onClick={closeEventForm}>×</button>
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
              {!editTarget && (isUsg ? (
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
              ))}
              {!editTarget && (
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
              )}
              {!editTarget && !isUsg && (
                <div>
                  <div className="mb-1 text-sm text-muted">Note to USG (optional)</div>
                  <textarea value={claimNote} onChange={(e) => setClaimNote(e.target.value)} rows={2} className={selectClass} />
                </div>
              )}
              <Button disabled={saving || !title.trim() || !eventDate || (editTarget !== null && title.trim().length < 3)} onClick={() => void create()}>
                {saving ? "Saving…" : editTarget ? "Save changes" : isUsg ? "Create event" : "Submit event"}
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
                placeholder="Claim note (required)"
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
                <div className="mb-1 text-sm text-muted">Overall budget request</div>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={budgetAmount}
                  onChange={(e) => setBudgetAmount(e.target.value)}
                  className={selectClass}
                />
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

      {spendTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl border border-line bg-paper p-6">
            <div className="mb-1 flex items-center justify-between gap-4">
              <div className="text-lg font-medium">Record spending</div>
              <button
                type="button"
                onClick={() => setSpendTarget(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <p className="mb-4 text-sm text-muted">{spendTarget.event.title}</p>
            <div className="grid gap-3">
              <div className="rounded-xl border border-line bg-canvas px-3.5 py-2.5">
                <div className="mb-1 text-sm text-muted">Remaining budget</div>
                <div className="text-lg font-medium tabular-nums text-ink">
                  ₱{formatMoney(Math.max(0, Number(spendTarget.budget.approvedTotal ?? 0) - Number(spendTarget.budget.actualSpent ?? 0)))}
                </div>
              </div>
              <div>
                <div className="mb-1 text-sm text-muted">Actual spent</div>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={spendAmount}
                  onChange={(e) => setSpendAmount(e.target.value)}
                  className={selectClass}
                />
              </div>
              {spendError && (
                <p className="rounded-xl border border-[#d9a99c] bg-[#a5442c]/[0.06] px-3.5 py-2.5 text-sm font-medium text-[#a5442c]">
                  {spendError}
                </p>
              )}
              <Button disabled={spendSaving} onClick={() => void saveSpending()}>
                {spendSaving ? "Saving…" : "Save spending"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
