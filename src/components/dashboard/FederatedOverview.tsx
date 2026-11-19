"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Reveal } from "@/components/fx/Reveal";
import { ButtonLink } from "@/components/ui/Button";
import { useDashboard } from "@/components/dashboard/dashboard-context";
import { NAV_ICONS, type NavItem } from "@/components/dashboard/AppShell";
import { SectionIcon } from "@/components/dashboard/workspace-shared";
import {
  IconArrowRight,
  IconCheck,
  IconClose,
  IconDashboard,
  IconLayers,
  IconPencil,
  IconSubmission,
} from "@/components/ui/Icons";

/**
 * The overview each workspace opens on.
 *
 * It is deliberately built from nav, not from a fixed list of cards. The two
 * workspaces (USG and LSG) share six sections but not their meaning, and the
 * cards here are simply the sections with whatever the section is waiting on.
 * Passing `nav` in means this file names no route of its own -- the same
 * arrangement that keeps `usg-nav.ts` free of LSG routes keeps this overview
 * from ever rendering a link the caller's side does not own.
 *
 * The arrangement is the account's own. A saved layout reorders the tiles and
 * may hide or widen them, but it can only refer to ids that `nav` already
 * carries: a stale row from before a section moved, or a hand-made payload, is
 * dropped on merge rather than turned into a link. That keeps the saved layout
 * a preference about presentation, never a second route table.
 */

type Counts = {
  tasksOpen: number;
  tasksOverdue: number;
  requestsOpen: number;
  eventsPending: number;
  surveysOpen: number;
};

type OverviewPayload = {
  ok: boolean;
  counts?: Counts;
  breakdown?: Record<"tasks" | "requests" | "events" | "surveys", Record<string, number>>;
  message?: string;
};

type TileLayout = { id: string; hidden: boolean; wide: boolean };

type LayoutPayload = { ok: boolean; layout?: unknown; widgets?: unknown; message?: string };

const WIDGETS = [
  { id: "stats", label: "At a glance" },
  { id: "reports", label: "Report summary" },
  { id: "task-chart", label: "Task status" },
  { id: "request-chart", label: "Request status" },
  { id: "flow", label: "Workflow" },
] as const;

const DEFAULT_WIDGETS: string[] = WIDGETS.map((widget) => widget.id);
const WIDGET_IDS = new Set<string>(DEFAULT_WIDGETS);

/** Which counter belongs to which nav section, so a card can badge itself. */
function countFor(id: string, c: NonNullable<OverviewPayload["counts"]>): number | null {
  switch (id) {
    case "request":
      return c.tasksOpen + c.requestsOpen;
    case "events":
      return c.eventsPending;
    case "survey":
      return c.surveysOpen;
    default:
      return null;
  }
}

function isTileLayout(value: unknown): value is TileLayout {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const tile = value as Record<string, unknown>;
  return (
    typeof tile.id === "string" &&
    typeof tile.hidden === "boolean" &&
    typeof tile.wide === "boolean"
  );
}

function isWidgetList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === "string" && WIDGET_IDS.has(id));
}

function ranked(bucket: Record<string, number> | undefined): Array<[string, number]> {
  return Object.entries(bucket ?? {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/**
 * Saved order first, nav order after. Ids the nav does not know are dropped,
 * duplicates collapse to their first appearance, and every tile the nav *does*
 * know but the saved row forgot is appended visible -- so adding a section in a
 * later release shows up for people who had already arranged their desk.
 */
function mergeLayout(nav: NavItem[], saved: TileLayout[]): TileLayout[] {
  const known = new Set(nav.map((item) => item.id));
  const seen = new Set<string>();
  const merged: TileLayout[] = [];

  for (const tile of saved) {
    if (!known.has(tile.id) || seen.has(tile.id)) continue;
    seen.add(tile.id);
    merged.push({ id: tile.id, hidden: tile.hidden, wide: tile.wide });
  }
  for (const item of nav) {
    if (seen.has(item.id)) continue;
    merged.push({ id: item.id, hidden: false, wide: false });
  }
  return merged;
}

export function FederatedOverview({
  nav,
  side,
}: {
  nav: NavItem[];
  side: "usg" | "lsg";
}) {
  const { account, meta } = useDashboard();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [breakdown, setBreakdown] = useState<NonNullable<OverviewPayload["breakdown"]> | null>(null);
  const [error, setError] = useState("");

  const [saved, setSaved] = useState<TileLayout[]>([]);
  const [draft, setDraft] = useState<TileLayout[] | null>(null);
  const [savedWidgets, setSavedWidgets] = useState<string[]>(DEFAULT_WIDGETS);
  const [widgetDraft, setWidgetDraft] = useState<string[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [layoutNotice, setLayoutNotice] = useState("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/overview");
        const body = (await res.json().catch(() => ({}))) as OverviewPayload;
        if (!alive) return;
        if (res.ok && body.ok) {
          setCounts(body.counts ?? null);
          setBreakdown(body.breakdown ?? null);
          setError("");
        } else {
          setError(body.message ?? "We could not load your overview.");
        }
      } catch {
        if (alive) setError("We could not load your overview.");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/dashboard/layout");
        const body = (await res.json().catch(() => ({}))) as LayoutPayload;
        if (!alive || !res.ok || !body.ok || !Array.isArray(body.layout)) return;
        setSaved(body.layout.filter(isTileLayout));
        if (isWidgetList(body.widgets)) setSavedWidgets(body.widgets);
      } catch {
        // A layout that cannot be read is not worth an alert: the nav order is
        // a perfectly good dashboard, and the next save will repair the row.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const activeLayout = useMemo(
    () => mergeLayout(nav, draft ?? saved),
    [nav, draft, saved],
  );

  const byId = useMemo(() => new Map(nav.map((item) => [item.id, item])), [nav]);

  const visibleTiles = activeLayout.filter((tile) => editing || !tile.hidden);
  const activeWidgetIds = widgetDraft ?? savedWidgets;
  const visibleWidgets = WIDGETS.filter((widget) => activeWidgetIds.includes(widget.id));

  function beginEditing() {
    setDraft(mergeLayout(nav, saved));
    setWidgetDraft(savedWidgets.slice());
    setEditing(true);
    setLayoutNotice("");
  }

  function cancelEditing() {
    setDraft(null);
    setWidgetDraft(null);
    setEditing(false);
    setLayoutNotice("");
  }

  function moveTile(index: number, delta: -1 | 1) {
    if (!draft) return;
    const target = index + delta;
    if (target < 0 || target >= draft.length) return;
    const next = draft.slice();
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    setDraft(next);
  }

  function toggleTile(id: string, key: "hidden" | "wide") {
    if (!draft) return;
    setDraft(
      draft.map((tile) => (tile.id === id ? { ...tile, [key]: !tile[key] } : tile)),
    );
  }

  function toggleWidget(id: string) {
    setWidgetDraft((current) => {
      const base = current ?? savedWidgets;
      return base.includes(id) ? base.filter((entry) => entry !== id) : [...base, id];
    });
  }

  async function persist(next: TileLayout[], nextWidgets: string[]) {
    setSaving(true);
    setLayoutNotice("");
    try {
      const res = await fetch("/api/dashboard/layout", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ layout: next, widgets: nextWidgets }),
      });
      const body = (await res.json().catch(() => ({}))) as LayoutPayload;
      if (!res.ok || !body.ok) {
        setLayoutNotice(body.message ?? "We could not save your dashboard. Try again.");
        return false;
      }
      setSaved(next);
      setSavedWidgets(nextWidgets.slice());
      return true;
    } catch {
      setLayoutNotice("We could not save your dashboard. Try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveEditing() {
    if (!draft) return;
    const ok = await persist(draft, widgetDraft ?? savedWidgets);
    if (ok) {
      setDraft(null);
      setWidgetDraft(null);
      setEditing(false);
      setLayoutNotice("Dashboard saved.");
    }
  }

  async function resetLayout() {
    const defaults = mergeLayout(
      nav,
      nav.map((item) => ({ id: item.id, hidden: false, wide: false })),
    );
    const ok = await persist(defaults, DEFAULT_WIDGETS);
    if (ok) {
      setDraft(null);
      setWidgetDraft(null);
      setEditing(false);
      setLayoutNotice("Dashboard reset to the default arrangement.");
    }
  }

  const roleWord = account.accountScope === "owner" ? "owner" : "officer";
  const unitName = account.campusName || account.universityName || null;

  // The heading says who is looking at it. A USG owner sees the office; an LSG
  // officer sees their own unit, because the whole point of the LSG side is
  // that it is one unit's desk rather than the university's.
  const heading =
    side === "usg"
      ? meta.organizationName || "Student government office"
      : unitName || "Your unit";

  function barList(bucket: Record<string, number> | undefined) {
    const rows = ranked(bucket);
    if (rows.length === 0) {
      return <p className="text-[0.8125rem] leading-relaxed text-muted">No data yet.</p>;
    }
    const max = Math.max(1, ...rows.map((row) => row[1]));
    return (
      <div className="flex flex-col gap-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3 text-[0.75rem] font-medium text-body">
              <span className="truncate">{label}</span>
              <span className="shrink-0 text-muted">{value}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-line/50">
              <div
                className="h-full rounded-full bg-brass-deep"
                style={{ width: `${Math.max(4, Math.round((value / max) * 100))}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  function renderWidget(id: string) {
    if (id === "stats") {
      const stats = [
        ["Open tasks", counts?.tasksOpen],
        ["Overdue", counts?.tasksOverdue],
        ["Open requests", counts?.requestsOpen],
        ["Pending events", counts?.eventsPending],
        ["Open surveys", counts?.surveysOpen],
      ] as const;
      return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {stats.map(([label, value]) => (
            <div key={label} className="rounded-xl border border-line/70 bg-paper/60 p-3">
              <p className="text-[0.6875rem] font-medium text-muted">{label}</p>
              <p className="mt-1 text-[1.375rem] font-semibold leading-none text-ink">
                {value ?? "—"}
              </p>
            </div>
          ))}
        </div>
      );
    }
    if (id === "reports") {
      return (
        <div className="flex flex-col gap-2 text-[0.8125rem] leading-relaxed text-body">
          <p>
            {counts
              ? `${counts.tasksOpen} task${counts.tasksOpen === 1 ? "" : "s"} are open, including ${counts.tasksOverdue} overdue.`
              : "Task totals are loading."}
          </p>
          <p>
            {counts
              ? `${counts.requestsOpen} request${counts.requestsOpen === 1 ? "" : "s"} are waiting for review, with ${counts.eventsPending} event${counts.eventsPending === 1 ? "" : "s"} and ${counts.surveysOpen} survey${counts.surveysOpen === 1 ? "" : "s"} in progress.`
              : "Request, event, and survey totals are loading."}
          </p>
        </div>
      );
    }
    if (id === "task-chart") return barList(breakdown?.tasks);
    if (id === "request-chart") return barList(breakdown?.requests);
    return (
      <div className="flex flex-wrap items-center gap-2 text-[0.75rem] font-medium text-body">
        {["Filed", "Triaged", "Assigned", "Reviewed"].map((step, index) => (
          <span key={step} className="flex items-center gap-2">
            <span className="rounded-full border border-brass/30 bg-brass-soft/25 px-3 py-1.5 text-brass-deep">
              {step}
            </span>
            {index < 3 ? (
              <IconArrowRight className="h-3.5 w-3.5 text-muted" strokeWidth={1.8} aria-hidden="true" />
            ) : null}
          </span>
        ))}
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-8">
      <Reveal className="flex flex-col gap-3">
        <div data-tour="workspace-header" className="flex items-center gap-3">
          <SectionIcon>
            <IconDashboard className="h-5 w-5" strokeWidth={1.7} />
          </SectionIcon>
          <div className="flex flex-col gap-1">
            <p className="eyebrow">{side === "usg" ? "Office desk" : "Unit desk"}</p>
            <h1 className="text-[1.875rem] leading-tight sm:text-[2.25rem]">{heading}</h1>
          </div>
        </div>
        <p className="max-w-2xl text-[0.9375rem] leading-relaxed text-body">
          {side === "usg"
            ? "You oversee every unit underneath you: their tasks, their requests back up, the events they file, and the surveys you run together. Start anywhere below."
            : `What ${unitName ?? "your unit"} owes the USG, and what it has sent back. Start anywhere below.`}
        </p>
        <p className="text-[0.75rem] text-muted">
          Signed in as {account.displayName} - {roleWord}
        </p>
      </Reveal>

      {error ? (
        <p role="alert" className="text-[0.9375rem] font-medium text-[#a5442c]">
          {error}
        </p>
      ) : null}

      <Reveal delay={0.06} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="eyebrow">Your sections</p>
          <div className="flex flex-wrap items-center gap-2">
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={() => void saveEditing()}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[0.75rem] font-semibold text-paper transition-opacity disabled:opacity-50"
                >
                  <IconCheck className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
                  {saving ? "Saving..." : "Save layout"}
                </button>
                <button
                  type="button"
                  onClick={cancelEditing}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[0.75rem] font-semibold text-ink transition-colors hover:border-line-strong disabled:opacity-50"
                >
                  <IconClose className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void resetLayout()}
                  disabled={saving}
                  className="rounded-full px-3 py-2 text-[0.75rem] font-medium text-muted transition-colors hover:text-ink disabled:opacity-50"
                >
                  Reset
                </button>
              </>
            ) : (
              <button
                data-tour="workspace-customize"
                type="button"
                onClick={beginEditing}
                className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[0.75rem] font-semibold text-ink transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-lift"
              >
                <IconPencil className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                Customize
              </button>
            )}
          </div>
        </div>

        {layoutNotice ? (
          <p role="status" className="text-[0.8125rem] leading-relaxed text-muted">
            {layoutNotice}
          </p>
        ) : null}

        {editing ? (
          <p className="text-[0.8125rem] leading-relaxed text-muted">
            Move a tile with the arrows, hide the ones you do not use, or let a tile
            take two columns. Hidden tiles stay here dimmed while you edit.
          </p>
        ) : null}

        <div data-tour="workspace-tiles" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleTiles.map((tile) => {
            const item = byId.get(tile.id);
            if (!item) return null;
            const TileIcon = NAV_ICONS[item.icon];
            const badge = counts ? countFor(item.id, counts) : null;
            const span = tile.wide ? " sm:col-span-2" : "";
            const position = activeLayout.findIndex((entry) => entry.id === tile.id);

            if (editing) {
              return (
                <div
                  key={item.id}
                  className={`flex flex-col gap-3 rounded-2xl border border-dashed border-line-strong bg-paper/50 p-5${span}${
                    tile.hidden ? " opacity-55" : ""
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <TileIcon className="h-4 w-4 shrink-0 text-brass-deep" strokeWidth={1.7} aria-hidden="true" />
                      <span className="text-[1.0625rem] leading-snug font-medium text-ink">
                        {item.label}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      {tile.hidden ? (
                        <span className="rounded-full bg-line/60 px-2 py-0.5 text-[0.6875rem] font-semibold text-muted">
                          Hidden
                        </span>
                      ) : null}
                      {tile.wide ? (
                        <span className="rounded-full bg-brass-soft/50 px-2 py-0.5 text-[0.6875rem] font-semibold text-brass-deep">
                          Wide
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <span className="text-[0.8125rem] leading-relaxed text-muted">{item.hint}</span>
                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => moveTile(position, -1)}
                      disabled={position <= 0}
                      aria-label={`Move ${item.label} up`}
                      className="rounded-full border border-line px-3 py-1.5 text-[0.75rem] font-medium text-ink transition-colors hover:border-line-strong disabled:opacity-40"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveTile(position, 1)}
                      disabled={position < 0 || position >= activeLayout.length - 1}
                      aria-label={`Move ${item.label} down`}
                      className="rounded-full border border-line px-3 py-1.5 text-[0.75rem] font-medium text-ink transition-colors hover:border-line-strong disabled:opacity-40"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleTile(item.id, "wide")}
                      aria-pressed={tile.wide}
                      className="rounded-full border border-line px-3 py-1.5 text-[0.75rem] font-medium text-ink transition-colors hover:border-line-strong"
                    >
                      {tile.wide ? "Normal width" : "Wide"}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleTile(item.id, "hidden")}
                      aria-pressed={tile.hidden}
                      className="rounded-full border border-line px-3 py-1.5 text-[0.75rem] font-medium text-ink transition-colors hover:border-line-strong"
                    >
                      {tile.hidden ? "Show" : "Hide"}
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <Link
                key={item.id}
                href={item.href}
                className={`group flex flex-col gap-2 rounded-2xl border border-line bg-paper/70 p-5 transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lift${span}`}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-brass/25 bg-brass-soft/20 text-brass-deep">
                      <TileIcon className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />
                    </span>
                    <span className="text-[1.0625rem] leading-snug font-medium text-ink">
                      {item.label}
                    </span>
                  </span>
                  {badge && badge > 0 ? (
                    <span className="shrink-0 rounded-full bg-brass-soft/50 px-2.5 py-1 text-[0.6875rem] font-semibold text-brass-deep">
                      {badge}
                    </span>
                  ) : null}
                </span>
                <span className="text-[0.8125rem] leading-relaxed text-muted">{item.hint}</span>
              </Link>
            );
          })}
        </div>

        {!editing && visibleTiles.length === 0 ? (
          <p className="rounded-2xl border border-line bg-paper/70 p-6 text-[0.875rem] leading-relaxed text-muted">
            Every tile is hidden. Choose Customize to bring one back.
          </p>
        ) : null}
      </Reveal>

      <Reveal delay={0.08}>
        <div data-tour="workspace-widgets" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="flex flex-col gap-1">
              <p className="eyebrow">Reports and signals</p>
              <p className="text-[0.8125rem] leading-relaxed text-muted">
                {editing
                  ? "Choose which summaries stay on your desk."
                  : "A quick read of the work moving through the office."}
              </p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {editing
              ? WIDGETS.map((widget) => {
                  const shown = activeWidgetIds.includes(widget.id);
                  return (
                    <div
                      key={widget.id}
                      data-widget={widget.id}
                      className={`flex flex-col gap-3 rounded-2xl border border-dashed border-line-strong bg-paper/50 p-5${
                        shown ? "" : " opacity-55"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[1.0625rem] leading-snug font-medium text-ink">
                          {widget.label}
                        </span>
                        {shown ? (
                          <span className="rounded-full bg-brass-soft/50 px-2 py-0.5 text-[0.6875rem] font-semibold text-brass-deep">
                            Shown
                          </span>
                        ) : (
                          <span className="rounded-full bg-line/60 px-2 py-0.5 text-[0.6875rem] font-semibold text-muted">
                            Hidden
                          </span>
                        )}
                      </div>
                      <div className="mt-auto flex justify-end pt-1">
                        <button
                          type="button"
                          onClick={() => toggleWidget(widget.id)}
                          aria-pressed={shown}
                          className="rounded-full border border-line px-3 py-1.5 text-[0.75rem] font-medium text-ink transition-colors hover:border-line-strong"
                        >
                          {shown ? "Hide" : "Show"}
                        </button>
                      </div>
                    </div>
                  );
                })
              : visibleWidgets.map((widget) => (
                  <div
                    key={widget.id}
                    data-widget={widget.id}
                    className={`rounded-2xl border border-line bg-paper/70 p-5 sm:p-6${
                      widget.id === "flow" ? " sm:col-span-2" : ""
                    }`}
                  >
                    <p className="mb-4 text-[0.9375rem] font-semibold text-ink">{widget.label}</p>
                    {renderWidget(widget.id)}
                  </div>
                ))}
          </div>
          {!editing && visibleWidgets.length === 0 ? (
            <p className="rounded-2xl border border-line bg-paper/70 p-6 text-[0.875rem] leading-relaxed text-muted">
              Every widget is hidden. Choose Customize to bring one back.
            </p>
          ) : null}
        </div>
      </Reveal>

      <Reveal delay={0.1}>
        <div data-tour="workspace-shortcuts" className="rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
          <p className="eyebrow">{side === "usg" ? "Your umbrella" : "Your standing"}</p>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-body">
            {side === "usg"
              ? "Manage holds the units under you, the invitations you send, and your own profile and look. Request is where you push a task down and read what comes back."
              : "Manage holds your own profile and government structure. Request is where the USG's tasks land, and where you send a request of your own back up."}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <ButtonLink href={nav[1]?.href ?? nav[0].href} variant="primary" size="sm">
              <IconLayers className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              Open Manage
            </ButtonLink>
            <ButtonLink href={nav[2]?.href ?? nav[0].href} variant="paper" size="sm">
              <IconSubmission className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              Go to Request
              <IconArrowRight className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            </ButtonLink>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
