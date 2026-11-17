"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Reveal } from "@/components/fx/Reveal";
import { ButtonLink } from "@/components/ui/Button";
import { useDashboard } from "@/components/dashboard/dashboard-context";
import type { NavItem } from "@/components/dashboard/AppShell";

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

type OverviewPayload = {
  ok: boolean;
  counts?: {
    tasksOpen: number;
    tasksOverdue: number;
    requestsOpen: number;
    eventsPending: number;
    surveysOpen: number;
  };
  message?: string;
};

type TileLayout = { id: string; hidden: boolean; wide: boolean };

type LayoutPayload = { ok: boolean; layout?: unknown; message?: string };

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
  const [counts, setCounts] = useState<OverviewPayload["counts"] | null>(null);
  const [error, setError] = useState("");

  const [saved, setSaved] = useState<TileLayout[]>([]);
  const [draft, setDraft] = useState<TileLayout[] | null>(null);
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

  function beginEditing() {
    setDraft(mergeLayout(nav, saved));
    setEditing(true);
    setLayoutNotice("");
  }

  function cancelEditing() {
    setDraft(null);
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

  async function persist(next: TileLayout[]) {
    setSaving(true);
    setLayoutNotice("");
    try {
      const res = await fetch("/api/dashboard/layout", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ layout: next }),
      });
      const body = (await res.json().catch(() => ({}))) as LayoutPayload;
      if (!res.ok || !body.ok) {
        setLayoutNotice(body.message ?? "We could not save your dashboard. Try again.");
        return false;
      }
      setSaved(next);
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
    const ok = await persist(draft);
    if (ok) {
      setDraft(null);
      setEditing(false);
      setLayoutNotice("Dashboard saved.");
    }
  }

  async function resetLayout() {
    const defaults = mergeLayout(
      nav,
      nav.map((item) => ({ id: item.id, hidden: false, wide: false })),
    );
    const ok = await persist(defaults);
    if (ok) {
      setDraft(null);
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

  return (
    <section className="flex flex-col gap-8">
      <Reveal className="flex flex-col gap-3">
        <p className="eyebrow">{side === "usg" ? "Office desk" : "Unit desk"}</p>
        <h1 className="text-[1.875rem] leading-tight sm:text-[2.25rem]">{heading}</h1>
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
                  className="rounded-full bg-ink px-4 py-2 text-[0.75rem] font-semibold text-paper transition-opacity disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save layout"}
                </button>
                <button
                  type="button"
                  onClick={cancelEditing}
                  disabled={saving}
                  className="rounded-full border border-line px-4 py-2 text-[0.75rem] font-semibold text-ink transition-colors hover:border-line-strong disabled:opacity-50"
                >
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
                type="button"
                onClick={beginEditing}
                className="rounded-full border border-line px-4 py-2 text-[0.75rem] font-semibold text-ink transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-lift"
              >
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

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleTiles.map((tile) => {
            const item = byId.get(tile.id);
            if (!item) return null;
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
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-[1.0625rem] leading-snug font-medium text-ink">
                      {item.label}
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
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-[1.0625rem] leading-snug font-medium text-ink">
                    {item.label}
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

      <Reveal delay={0.1}>
        <div className="rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
          <p className="eyebrow">{side === "usg" ? "Your umbrella" : "Your standing"}</p>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-body">
            {side === "usg"
              ? "Manage holds the units under you, the invitations you send, and your own profile and look. Request is where you push a task down and read what comes back."
              : "Manage holds your own profile and government structure. Request is where the USG's tasks land, and where you send a request of your own back up."}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <ButtonLink href={nav[1]?.href ?? nav[0].href} variant="primary" size="sm">
              Open Manage
            </ButtonLink>
            <ButtonLink href={nav[2]?.href ?? nav[0].href} variant="paper" size="sm">
              Go to Request
            </ButtonLink>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
