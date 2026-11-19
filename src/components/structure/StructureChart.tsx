"use client";

/**
 * The one chart renderer.
 *
 * The builder, the published view, the reviewer's queue and the organization
 * chart all draw with this component, so a format chosen by one person is the
 * same picture wherever the structure is looked at.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import clsx from "clsx";
import type { StructureLayout } from "@/lib/structure";
import { fetchMemberPhoto } from "@/lib/structure";
import type { ChartGeometry, ChartNode } from "@/components/structure/chart";

export type ThemeTokens = {
  bg: string;
  grid: string;
  node: string;
  nodeBorder: string;
  ink: string;
  muted: string;
  accent: string;
  edge: string;
  band: string;
  bandInk: string;
};

export const THEMES: Record<StructureLayout["theme"], ThemeTokens> = {
  parchment: {
    bg: "#f7f1e4",
    grid: "rgba(80, 64, 43, 0.06)",
    node: "#fffdf7",
    nodeBorder: "#d9cdb4",
    ink: "#2d2418",
    muted: "#7a6a52",
    accent: "#a8792c",
    edge: "rgba(120, 100, 70, 0.55)",
    band: "#efe4cd",
    bandInk: "#5c4a2e",
  },
  ink: {
    bg: "#12161c",
    grid: "rgba(255, 255, 255, 0.04)",
    node: "#1b222c",
    nodeBorder: "#33404f",
    ink: "#eef2f7",
    muted: "#93a1b3",
    accent: "#e2b865",
    edge: "rgba(180, 200, 225, 0.4)",
    band: "#232d3a",
    bandInk: "#c6d2e0",
  },
  brass: {
    bg: "#22201b",
    grid: "rgba(255, 255, 255, 0.035)",
    node: "#2d2a23",
    nodeBorder: "#5a4d34",
    ink: "#f6efdf",
    muted: "#b9a784",
    accent: "#d3a24c",
    edge: "rgba(211, 162, 76, 0.45)",
    band: "#3a3427",
    bandInk: "#e5d3ac",
  },
  slate: {
    bg: "#eef2f6",
    grid: "rgba(30, 55, 80, 0.05)",
    node: "#ffffff",
    nodeBorder: "#c6d2dd",
    ink: "#1a2735",
    muted: "#5d7285",
    accent: "#3d6b96",
    edge: "rgba(61, 107, 150, 0.4)",
    band: "#dde6ef",
    bandInk: "#33506d",
  },
};

/** Uploaded photos are fetched once per roster id and kept for the session. */
const photoCache = new Map<string, string | null>();
const photoInflight = new Map<string, Promise<string | null>>();

async function loadPhoto(rosterId: string): Promise<string | null> {
  if (photoCache.has(rosterId)) return photoCache.get(rosterId) ?? null;
  const existing = photoInflight.get(rosterId);
  if (existing) return existing;
  const promise = fetchMemberPhoto(rosterId)
    .then((url) => {
      photoCache.set(rosterId, url);
      return url;
    })
    .catch(() => {
      photoCache.set(rosterId, null);
      return null;
    })
    .finally(() => {
      photoInflight.delete(rosterId);
    });
  photoInflight.set(rosterId, promise);
  return promise;
}

export function useChartPhotos(nodes: ChartNode[], enabled: boolean) {
  const [photos, setPhotos] = useState<Record<string, string | null>>({});
  const signature = nodes
    .map((node) => `${node.photoId ?? ""}:${node.primary?.hasPhoto ? 1 : 0}`)
    .join("|");

  useEffect(() => {
    if (!enabled) return;
    const wanted = new Set<string>();
    for (const node of nodes) {
      const rosterId = node.photoId;
      if (rosterId && node.primary?.hasPhoto) wanted.add(rosterId);
    }
    if (!wanted.size) return;

    let cancelled = false;
    const ids = [...wanted];
    void (async () => {
      for (let i = 0; i < ids.length; i += 4) {
        if (cancelled) return;
        const batch = ids.slice(i, i + 4);
        const loaded = await Promise.all(batch.map((id) => loadPhoto(id)));
        if (cancelled) return;
        setPhotos((prev) => {
          let changed = false;
          const next = { ...prev };
          batch.forEach((id, index) => {
            if (!(id in next)) {
              next[id] = loaded[index];
              changed = true;
            }
          });
          return changed ? next : prev;
        });
      }
    })();

    return () => {
      cancelled = true;
    };
    // The signature captures exactly the inputs this effect reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, enabled]);

  return photos;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function edgePath(
  from: ChartNode,
  to: ChartNode,
  template: StructureLayout["template"],
): string {
  const fx = from.x + from.w / 2;
  const fy = from.y + from.h / 2;
  const tx = to.x + to.w / 2;
  const ty = to.y + to.h / 2;

  if (template === "radial") {
    return `M ${fx} ${fy} L ${tx} ${ty}`;
  }

  const vertical = Math.abs(ty - fy) >= Math.abs(tx - fx);
  if (vertical) {
    const sy = ty > fy ? from.y + from.h : from.y;
    const ey = ty > fy ? to.y : to.y + to.h;
    const mid = (sy + ey) / 2;
    return `M ${fx} ${sy} C ${fx} ${mid}, ${tx} ${mid}, ${tx} ${ey}`;
  }
  const sx = tx > fx ? from.x + from.w : from.x;
  const ex = tx > fx ? to.x : to.x + to.w;
  const mid = (sx + ex) / 2;
  return `M ${sx} ${fy} C ${mid} ${fy}, ${mid} ${ty}, ${ex} ${ty}`;
}

export function chartFrameStyle(
  geometry: ChartGeometry,
  layout: StructureLayout,
): CSSProperties {
  const theme = THEMES[layout.theme] ?? THEMES.parchment;
  return {
    width: geometry.width,
    height: geometry.height,
    background: theme.bg,
    backgroundImage: `radial-gradient(${theme.grid} 1px, transparent 1px)`,
    backgroundSize: "18px 18px",
  };
}

export function ChartEdges({
  geometry,
  layout,
}: {
  geometry: ChartGeometry;
  layout: StructureLayout;
}) {
  const theme = THEMES[layout.theme] ?? THEMES.parchment;
  const byKey = new Map(geometry.nodes.map((n) => [n.key, n]));
  return (
    <svg
      width={geometry.width}
      height={geometry.height}
      className="pointer-events-none absolute inset-0"
      aria-hidden
    >
      {geometry.edges.map((edge) => {
        const from = byKey.get(edge.from);
        const to = byKey.get(edge.to);
        if (!from || !to) return null;
        return (
          <path
            key={`${edge.from}->${edge.to}`}
            d={edgePath(from, to, layout.template)}
            fill="none"
            stroke={theme.edge}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}

export function ChartBands({
  geometry,
  layout,
}: {
  geometry: ChartGeometry;
  layout: StructureLayout;
}) {
  const theme = THEMES[layout.theme] ?? THEMES.parchment;
  return (
    <>
      {geometry.bands.map((band) => (
        <div
          key={band.key}
          className="absolute flex items-center justify-center rounded-lg px-2 text-center text-[0.625rem] font-semibold uppercase tracking-[0.14em]"
          style={{
            left: band.x,
            top: band.y,
            width: band.w,
            height: band.h,
            background: theme.band,
            color: theme.bandInk,
          }}
          title={band.label}
        >
          <span className="truncate">{band.label}</span>
        </div>
      ))}
    </>
  );
}

/** One seat. Exported so the drag-and-drop editor can wrap the same card. */
export function ChartNodeCard({
  node,
  layout,
  photo,
  selected = false,
  interactive = false,
  onSelect,
  cardRef,
  cardStyle,
  dragHandle,
  ariaLabel,
  children,
}: {
  node: ChartNode;
  layout: StructureLayout;
  photo: string | null | undefined;
  selected?: boolean;
  interactive?: boolean;
  onSelect?: (key: string) => void;
  cardRef?: (element: HTMLButtonElement | null) => void;
  cardStyle?: CSSProperties;
  dragHandle?: ReactNode;
  ariaLabel?: string;
  children?: ReactNode;
}) {
  const theme = THEMES[layout.theme] ?? THEMES.parchment;
  const compact = layout.template === "compact";
  const leader = Math.round(Math.min(node.w, node.h) * 0.32);
  const vacant = !node.primary;
  const coHolders = node.holders.length > 1 ? node.holders.length - 1 : 0;

  return (
    <button
      ref={cardRef}
      type="button"
      onClick={interactive && onSelect ? () => onSelect(node.key) : undefined}
      className={clsx(
        "group absolute flex items-center gap-2 overflow-hidden rounded-xl text-left transition-shadow",
        interactive && "cursor-pointer hover:shadow-lg",
        selected && "ring-2 ring-offset-1",
      )}
      style={{
        left: node.x,
        top: node.y,
        width: node.w,
        height: node.h,
        padding: compact ? 8 : 10,
        background: theme.node,
        border: `1px solid ${selected ? theme.accent : theme.nodeBorder}`,
        boxShadow: selected ? `0 0 0 2px ${theme.accent}33` : undefined,
        outlineColor: theme.accent,
        color: theme.ink,
        touchAction: dragHandle ? undefined : "manipulation",
        ...cardStyle,
      }}
      title={`${node.title}${node.name ? ` — ${node.name}` : ""}`}
      aria-label={ariaLabel ?? `${node.title}${node.name ? `, ${node.name}` : ", vacant"}`}
      tabIndex={interactive ? 0 : -1}
    >
      {layout.showPhotos ? (
        <span
          className="grid shrink-0 place-items-center overflow-hidden rounded-full"
          style={{
            width: leader,
            height: leader,
            background: theme.band,
            color: theme.bandInk,
            fontSize: Math.max(10, leader * 0.32),
            fontWeight: 600,
          }}
        >
          {photo ? (
            // The data URL came from our own scoped photo route.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" className="size-full object-cover" />
          ) : (
            initials(node.name || node.title)
          )}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span
          className="block truncate font-semibold"
          style={{ fontSize: compact ? 11 : 12.5, lineHeight: 1.2 }}
        >
          {node.name || (vacant ? "Vacant" : "Unnamed")}
        </span>
        {layout.showTitles ? (
          <span
            className="mt-0.5 block truncate"
            style={{ fontSize: compact ? 9.5 : 10.5, color: theme.muted, lineHeight: 1.25 }}
          >
            {node.title}
          </span>
        ) : null}
        {coHolders > 0 && !compact ? (
          <span className="mt-0.5 block text-[0.5625rem]" style={{ color: theme.accent }}>
            +{coHolders} co-holder{coHolders > 1 ? "s" : ""}
          </span>
        ) : null}
      </span>
      {dragHandle}
      {children}
    </button>
  );
}

export function ChartCanvas({
  geometry,
  layout,
  photos,
  selectedKey,
  onSelect,
  className,
  interactive = false,
}: {
  geometry: ChartGeometry;
  layout: StructureLayout;
  photos: Record<string, string | null>;
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <div className={clsx("relative overflow-hidden rounded-2xl", className)} style={chartFrameStyle(geometry, layout)}>
      <ChartEdges geometry={geometry} layout={layout} />
      <ChartBands geometry={geometry} layout={layout} />
      {geometry.nodes.map((node) => {
        const photo = node.photoId ? photos[node.photoId] : null;
        return (
          <ChartNodeCard
            key={node.key}
            node={node}
            layout={layout}
            photo={photo}
            selected={selectedKey === node.key}
            interactive={interactive}
            onSelect={onSelect}
          />
        );
      })}
    </div>
  );
}

/** A canvas with zoom, fit, and a light/dark aware frame. */
export function ZoomableChart({
  geometry,
  layout,
  photos,
  selectedKey,
  onSelect,
  interactive = false,
  maxHeight = 620,
}: {
  geometry: ChartGeometry;
  layout: StructureLayout;
  photos: Record<string, string | null>;
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  interactive?: boolean;
  maxHeight?: number;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  function fit() {
    const width = frame.current?.clientWidth ?? geometry.width;
    const next = Math.min(1, Math.max(0.3, (width - 16) / geometry.width));
    setScale(Number(next.toFixed(2)));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <ZoomButton label="−" onClick={() => setScale((s) => Math.max(0.25, Number((s - 0.1).toFixed(2))))} />
        <span className="w-11 text-center text-[0.6875rem] tabular-nums text-muted">
          {Math.round(scale * 100)}%
        </span>
        <ZoomButton label="+" onClick={() => setScale((s) => Math.min(1.8, Number((s + 0.1).toFixed(2))))} />
        <ZoomButton label="Fit" onClick={fit} wide />
      </div>
      <div
        ref={frame}
        className="overflow-auto rounded-2xl border border-line bg-canvas/40 p-2"
        style={{ maxHeight }}
      >
        <div style={{ width: geometry.width * scale, height: geometry.height * scale }}>
          <div style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}>
            <ChartCanvas
              geometry={geometry}
              layout={layout}
              photos={photos}
              selectedKey={selectedKey}
              onSelect={onSelect}
              interactive={interactive}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ZoomButton({ label, onClick, wide }: { label: string; onClick: () => void; wide?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "rounded-full border border-line bg-paper px-3 py-1 text-[0.6875rem] font-medium text-ink-soft transition-colors hover:border-ink/30 hover:text-ink",
        wide && "px-3.5",
      )}
    >
      {label}
    </button>
  );
}
