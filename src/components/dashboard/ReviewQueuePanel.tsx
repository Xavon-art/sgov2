"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { CountdownChip } from "@/components/ui/CountdownChip";
import { ReviewTimeline } from "@/components/ui/ReviewTimeline";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { countdownText, countdownTone } from "@/lib/deadlines";
import type { Status } from "@/lib/status";
import { cn } from "@/lib/utils";

type QueueRequirement = {
  id: string;
  label: string;
  instructions: string | null;
  required: boolean;
  linkUrl: string | null;
  storagePath: string | null;
  originalName: string | null;
  mimeType: string | null;
  respondedAt: string | null;
  reviewStatus: string;
  reviewNote: string | null;
};

type QueueItem = {
  taskId: string;
  unitId: string;
  taskTitle: string;
  unitName: string;
  campusName: string;
  departmentName: string;
  status: string;
  submittedAt: string | null;
  submittedBy: string | null;
  reviewOpenedAt: string | null;
  reviewDueAt: string | null;
  late: boolean;
  dueAt: string | null;
  overdue: boolean;
  note: string | null;
  responseName: string | null;
  responseMime: string | null;
  responseBytes: number | null;
  hasResponse: boolean;
  requirements: QueueRequirement[];
};

type QueueExtension = {
  id: string;
  taskId: string;
  taskTitle: string;
  unitId: string;
  unitName: string;
  campusName: string;
  requestedDueAt: string | null;
  reason: string | null;
  createdAt: string;
  status: string;
};

type UnitOption = { id: string; name: string; parentName?: string };

type Filters = {
  status: string;
  campus: string;
  unitId: string;
  dueFrom: string;
  dueTo: string;
  overdue: string;
  late: string;
};

const initialFilters: Filters = {
  status: "under_review",
  campus: "",
  unitId: "",
  dueFrom: "",
  dueTo: "",
  overdue: "",
  late: "",
};

const inputClass =
  "h-9 w-full rounded-lg border border-line bg-canvas px-2.5 text-sm text-ink outline-none transition-colors focus:border-line-strong";

function fmt(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function reviewDueLabel(value: string | null): string {
  const text = countdownText(value, 0, false);
  if (text.startsWith("Due in ")) return `Review due in ${text.slice("Due in ".length)}`;
  if (text === "Due today") return "Review due today";
  if (text.startsWith("Overdue by ")) return `Review overdue by ${text.slice("Overdue by ".length)}`;
  if (text === "Overdue today") return "Review overdue today";
  return "Review deadline not set";
}

function fmtBytes(value: number | null): string {
  if (!value || value <= 0) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function previewHref(item: QueueItem, requirement: QueueRequirement): string | null {
  if (requirement.linkUrl && requirement.linkUrl.trim()) return requirement.linkUrl;
  if (requirement.storagePath) {
    return `/api/files/task-requirement/${encodeURIComponent(requirement.id)}/${encodeURIComponent(item.unitId)}`;
  }
  return null;
}

export function ReviewQueuePanel({
  units,
  onChanged,
}: {
  units: UnitOption[];
  onChanged?: () => void | Promise<void>;
}) {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [extensions, setExtensions] = useState<QueueExtension[]>([]);
  const [selected, setSelected] = useState<QueueItem | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [extensionNotes, setExtensionNotes] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const searchParams = useSearchParams();
  const focusTaskId = searchParams.get("task");
  const [autoOpenedTask, setAutoOpenedTask] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (filters.status) params.set("status", filters.status);
      if (filters.campus) params.set("campus", filters.campus);
      if (filters.unitId) params.set("unitId", filters.unitId);
      if (filters.dueFrom) params.set("dueFrom", filters.dueFrom);
      if (filters.dueTo) params.set("dueTo", filters.dueTo);
      if (filters.overdue) params.set("overdue", filters.overdue);
      if (filters.late) params.set("late", filters.late);
      const res = await fetch(`/api/tasks/review-queue?${params.toString()}`, { cache: "no-store" });
      const data = (await res.json()) as {
        ok?: boolean;
        items?: QueueItem[];
        extensions?: QueueExtension[];
        message?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.message || "We could not load the review queue.");
        return;
      }
      setItems(data.items ?? []);
      setExtensions(data.extensions ?? []);
    } catch {
      setError("We could not load the review queue.");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    return () => {
      active = false;
    };
  }, [load]);

  useEffect(() => {
    if (!focusTaskId || loading || selected) return;
    const node = Array.from(document.querySelectorAll("[data-review-task-id]")).find(
      (element) => element.getAttribute("data-review-task-id") === focusTaskId,
    );
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusTaskId, loading, items, extensions, selected]);

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  const openItem = useCallback(async (item: QueueItem) => {
    setOpening(true);
    setError("");
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(item.taskId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "open-review",
          taskId: item.taskId,
          unitId: item.unitId,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !data.ok) {
        setError(data.message || "We could not open that item.");
        return;
      }
      setSelected(item);
      setBanner("");
      setNotes({});
      setRefreshKey((value) => value + 1);
      await load();
    } catch {
      setError("We could not open that item.");
    } finally {
      setOpening(false);
    }
  }, [load]);

  useEffect(() => {
    if (!focusTaskId || loading || selected || autoOpenedTask === focusTaskId) return;
    const item = items.find((row) => row.taskId === focusTaskId);
    if (!item) return;
    queueMicrotask(() => {
      setAutoOpenedTask(focusTaskId);
      void openItem(item);
    });
  }, [focusTaskId, loading, items, selected, autoOpenedTask, openItem]);

  async function decide(item: QueueItem, requirement: QueueRequirement, verdict: "approved" | "returned" | "rejected") {
    const note = notes[requirement.id] ?? "";
    setError("");
    setBanner("");
    try {
      const res = await fetch("/api/tasks/answers", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requirementId: requirement.id,
          unitId: item.unitId,
          verdict,
          note,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        itemStatus?: string;
        message?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.message || "We could not save that decision.");
        return;
      }
      setSelected((current) =>
        current
          ? {
              ...current,
              status: data.itemStatus || current.status,
              requirements: current.requirements.map((row) =>
                row.id === requirement.id ? { ...row, reviewStatus: verdict, reviewNote: note } : row,
              ),
            }
          : current,
      );
      setBanner(
        data.itemStatus && data.itemStatus !== "under_review"
          ? `Decision recorded. Item is now ${data.itemStatus}.`
          : "Decision recorded.",
      );
      setRefreshKey((value) => value + 1);
      await load();
      if (onChanged) await onChanged();
    } catch {
      setError("We could not save that decision.");
    }
  }

  async function decideExtension(extension: QueueExtension, decision: "approved" | "rejected") {
    const note = extensionNotes[extension.id] ?? "";
    setError("");
    try {
      const res = await fetch("/api/tasks/extensions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "decide",
          extensionId: extension.id,
          decision,
          note,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !data.ok) {
        setError(data.message || "We could not decide that extension request.");
        return;
      }
      setBanner("Extension request decided.");
      await load();
      if (onChanged) await onChanged();
    } catch {
      setError("We could not decide that extension request.");
    }
  }

  if (selected) {
    const tone = countdownTone(selected.reviewDueAt, 0, false);
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setSelected(null);
              setBanner("");
              setError("");
              setRefreshKey((value) => value + 1);
            }}
          >
            ← Back to queue
          </Button>
          <StatusBadge status={selected.status as Status} late={selected.late} />
        </div>
        <header className="rounded-2xl border border-line bg-paper/70 p-5">
          <p className="text-xs font-semibold tracking-[0.16em] text-muted uppercase">Item under review</p>
          <h2 className="mt-1 text-xl font-semibold text-ink">{selected.taskTitle}</h2>
          <div className="mt-2 flex flex-wrap gap-2 text-sm text-muted">
            <span>{selected.unitName}</span>
            {selected.campusName ? <span>· {selected.campusName}</span> : null}
            {selected.departmentName ? <span>· {selected.departmentName}</span> : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Submitted {fmt(selected.submittedAt)}</span>
            {selected.submittedBy ? <span className="text-muted">by {selected.submittedBy}</span> : null}
            <span className={cn("rounded-full border px-2.5 py-0.5 text-xs", toneClass(tone))}>
              {reviewDueLabel(selected.reviewDueAt)}
            </span>
            <CountdownChip dueAt={selected.reviewDueAt} />
          </div>
          {selected.note ? <p className="mt-3 text-sm text-ink-soft">LSG note: {selected.note}</p> : null}
          {selected.hasResponse ? (
            <p className="mt-2 text-sm text-muted">
              Response file: {selected.responseName || "Attached document"} {fmtBytes(selected.responseBytes)}
            </p>
          ) : null}
        </header>

        {banner ? <p className="text-sm font-medium text-[#4f6428]">{banner}</p> : null}
        {error ? <p className="text-sm text-[#a5442c]">{error}</p> : null}

        <div className="space-y-3">
          {selected.requirements.map((requirement) => {
            const href = previewHref(selected, requirement);
            const note = notes[requirement.id] ?? "";
            return (
              <section key={requirement.id} className="rounded-2xl border border-line bg-paper/70 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-ink">{requirement.label}</h3>
                      <StatusBadge status={(requirement.reviewStatus || "pending") as Status} />
                      {requirement.required ? (
                        <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">Required</span>
                      ) : null}
                    </div>
                    {requirement.instructions ? (
                      <p className="mt-1 text-sm text-muted">{requirement.instructions}</p>
                    ) : null}
                  </div>
                  <span className="text-xs text-muted">{fmt(requirement.respondedAt)}</span>
                </div>

                <div className="mt-3 text-sm">
                  {href ? (
                    <a
                      href={href}
                      target={href.startsWith("/") ? undefined : "_blank"}
                      rel={href.startsWith("/") ? undefined : "noopener noreferrer"}
                      className="text-[#8a6d2f] underline underline-offset-2 hover:text-ink"
                    >
                      {requirement.linkUrl && requirement.linkUrl.trim()
                        ? "Open submitted link"
                        : `Preview ${requirement.originalName || "submitted file"}`}
                    </a>
                  ) : (
                    <span className="text-muted">No answer submitted</span>
                  )}
                </div>

                {requirement.reviewNote ? (
                  <p className="mt-2 rounded-lg border border-line bg-canvas/70 px-3 py-2 text-sm text-ink-soft">
                    Review remark: {requirement.reviewNote}
                  </p>
                ) : null}

                <label className="mt-4 block text-xs font-semibold tracking-[0.12em] text-muted uppercase">
                  Review remark
                  <textarea
                    value={note}
                    onChange={(event) => setNotes((current) => ({ ...current, [requirement.id]: event.target.value }))}
                    rows={2}
                    maxLength={2000}
                    placeholder="Required for Return and Reject"
                    className="mt-1.5 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm normal-case tracking-normal text-ink outline-none focus:border-line-strong"
                  />
                </label>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" variant="paper" size="sm" onClick={() => decide(selected, requirement, "approved")}>
                    Approve
                  </Button>
                  <Button
                    type="button"
                    variant="brass"
                    size="sm"
                    disabled={note.trim().length < 2}
                    title={note.trim().length < 2 ? "Add a remark before returning this item." : undefined}
                    onClick={() => decide(selected, requirement, "returned")}
                  >
                    Return
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={note.trim().length < 2}
                    title={note.trim().length < 2 ? "Add a remark before rejecting this item." : undefined}
                    onClick={() => decide(selected, requirement, "rejected")}
                  >
                    Reject
                  </Button>
                </div>
              </section>
            );
          })}
        </div>

        <ReviewTimeline taskId={selected.taskId} unitId={selected.unitId} refreshKey={refreshKey} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">USG review queue</h2>
          <p className="text-sm text-muted">Items waiting for review, oldest first, with extension requests.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
          Refresh
        </Button>
      </header>

      <section className="rounded-2xl border border-line bg-paper/70 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">
            Status
            <select
              value={filters.status}
              onChange={(event) => updateFilter("status", event.target.value)}
              className={cn(inputClass, "mt-1.5 normal-case tracking-normal")}
            >
              <option value="under_review">Under review</option>
              <option value="approved">Approved</option>
              <option value="returned">Returned</option>
              <option value="rejected">Rejected</option>
              <option value="draft">Draft</option>
              <option value="all">All statuses</option>
            </select>
          </label>
          <label className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">
            Campus
            <input
              value={filters.campus}
              onChange={(event) => updateFilter("campus", event.target.value)}
              placeholder="All campuses"
              className={cn(inputClass, "mt-1.5 normal-case tracking-normal")}
            />
          </label>
          <label className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">
            Unit
            <select
              value={filters.unitId}
              onChange={(event) => updateFilter("unitId", event.target.value)}
              className={cn(inputClass, "mt-1.5 normal-case tracking-normal")}
            >
              <option value="">All units</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.parentName ? `${unit.parentName} · ` : ""}
                  {unit.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">
            Due from
            <input
              type="date"
              value={filters.dueFrom}
              onChange={(event) => updateFilter("dueFrom", event.target.value)}
              className={cn(inputClass, "mt-1.5 normal-case tracking-normal")}
            />
          </label>
          <label className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">
            Due to
            <input
              type="date"
              value={filters.dueTo}
              onChange={(event) => updateFilter("dueTo", event.target.value)}
              className={cn(inputClass, "mt-1.5 normal-case tracking-normal")}
            />
          </label>
          <label className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">
            Overdue
            <select
              value={filters.overdue}
              onChange={(event) => updateFilter("overdue", event.target.value)}
              className={cn(inputClass, "mt-1.5 normal-case tracking-normal")}
            >
              <option value="">Any</option>
              <option value="true">Overdue</option>
              <option value="false">Not overdue</option>
            </select>
          </label>
          <label className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">
            Late
            <select
              value={filters.late}
              onChange={(event) => updateFilter("late", event.target.value)}
              className={cn(inputClass, "mt-1.5 normal-case tracking-normal")}
            >
              <option value="">Any</option>
              <option value="true">Late</option>
              <option value="false">Not late</option>
            </select>
          </label>
          <div className="flex items-end">
            <Button
              type="button"
              variant="paper"
              size="sm"
              onClick={() => {
                setFilters(initialFilters);
                setSelected(null);
              }}
            >
              Clear filters
            </Button>
          </div>
        </div>
      </section>

      {banner ? <p className="text-sm font-medium text-[#4f6428]">{banner}</p> : null}
      {error ? <p className="text-sm text-[#a5442c]">{error}</p> : null}
      {loading ? <p className="text-sm text-muted">Loading review queue…</p> : null}

      {!loading && items.length === 0 && extensions.length === 0 ? (
        <p className="rounded-2xl border border-line bg-paper/70 p-5 text-sm text-muted">
          No items match these filters.
        </p>
      ) : null}

      {items.length > 0 ? (
        <section className="rounded-2xl border border-line bg-paper/70">
          <div className="border-b border-line px-5 py-3">
            <h3 className="text-sm font-semibold tracking-[0.12em] text-ink-soft uppercase">Items</h3>
          </div>
          <div className="divide-y divide-line">
            {items.map((item) => (
              <div key={`${item.taskId}:${item.unitId}`} data-review-task-id={item.taskId} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-ink">{item.taskTitle}</p>
                    <StatusBadge status={item.status as Status} late={item.late} />
                  </div>
                  <p className="mt-0.5 text-sm text-muted">
                    {item.unitName}
                    {item.campusName ? ` · ${item.campusName}` : ""}
                    {item.submittedAt ? ` · Submitted ${fmt(item.submittedAt)}` : ""}
                  </p>
                </div>
                <CountdownChip dueAt={item.reviewDueAt} />
                <span className="text-xs text-muted">{reviewDueLabel(item.reviewDueAt)}</span>
                <Button
                  type="button"
                  variant="brass"
                  size="sm"
                  disabled={opening}
                  onClick={() => void openItem(item)}
                >
                  {opening ? "Opening…" : "Review"}
                </Button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {extensions.length > 0 ? (
        <section className="rounded-2xl border border-line bg-paper/70">
          <div className="border-b border-line px-5 py-3">
            <h3 className="text-sm font-semibold tracking-[0.12em] text-ink-soft uppercase">Extension requests</h3>
          </div>
          <div className="divide-y divide-line">
            {extensions.map((extension) => {
              const note = extensionNotes[extension.id] ?? "";
              return (
                <div key={extension.id} data-review-task-id={extension.taskId} className="px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-ink">{extension.taskTitle}</p>
                    <span className="text-xs text-muted">Requested {fmt(extension.createdAt)}</span>
                  </div>
                  <p className="mt-0.5 text-sm text-muted">
                    {extension.unitName}
                    {extension.campusName ? ` · ${extension.campusName}` : ""}
                    {" · Requested due "}
                    {fmt(extension.requestedDueAt)}
                  </p>
                  {extension.reason ? <p className="mt-2 text-sm text-ink-soft">{extension.reason}</p> : null}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                      value={note}
                      onChange={(event) =>
                        setExtensionNotes((current) => ({ ...current, [extension.id]: event.target.value }))
                      }
                      placeholder="Decision note (required to reject)"
                      className={cn(inputClass, "max-w-sm")}
                    />
                    <Button
                      type="button"
                      variant="paper"
                      size="sm"
                      onClick={() => void decideExtension(extension, "approved")}
                    >
                      Approve extension
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={note.trim().length < 2}
                      title={note.trim().length < 2 ? "Add a note before rejecting this extension." : undefined}
                      onClick={() => void decideExtension(extension, "rejected")}
                    >
                      Reject extension
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function toneClass(tone: ReturnType<typeof countdownTone>): string {
  if (tone === "overdue") return "border-[#a5442c]/35 bg-[#a5442c]/[0.08] text-[#a5442c]";
  if (tone === "soon") return "border-[#d8c18f]/50 bg-[#d8c18f]/10 text-[#7d6428]";
  if (tone === "normal") return "border-line bg-canvas text-ink-soft";
  return "border-line bg-canvas/50 text-muted";
}
