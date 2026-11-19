/**
 * Chart geometry.
 *
 * One pure function turns a structure document plus its layout into absolute
 * positions. The DOM renderer and the SVG exporter both read the same result,
 * so what a person sees and what they download cannot drift.
 *
 * This file never decides who is seated. It only decides where a seat is drawn.
 */

import {
  type ChartNodeSize,
  type StructureDocument,
  type StructureHolder,
  type StructureLayout,
  type StructurePosition,
} from "@/lib/structure";
import { holderName } from "@/components/structure/document";

export type ChartNode = {
  key: string;
  title: string;
  tier: number;
  order: number;
  committeeKey: string;
  committeeName: string;
  holders: StructureHolder[];
  primary: StructureHolder | null;
  name: string;
  /** Photo key for the loader: a roster id when known, else the email. */
  photoKey: string | null;
  parentKey: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type ChartEdge = { from: string; to: string };

export type ChartBand = {
  key: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type ChartGeometry = {
  width: number;
  height: number;
  nodes: ChartNode[];
  edges: ChartEdge[];
  bands: ChartBand[];
  template: StructureLayout["template"];
  nodeSize: { w: number; h: number };
};

const PAD = 28;
const GAP_X = 22;
const GAP_Y = 52;
const BAND_H = 30;
const BAND_GAP = 10;

const SIZE: Record<ChartNodeSize, { w: number; h: number }> = {
  sm: { w: 138, h: 58 },
  md: { w: 176, h: 82 },
  lg: { w: 216, h: 102 },
};

function sizeFor(layout: StructureLayout): { w: number; h: number } {
  const base = SIZE[layout.nodeSize] ?? SIZE.md;
  if (layout.template === "compact") {
    return { w: Math.round(base.w * 0.82), h: Math.round(base.h * 0.8) };
  }
  return base;
}

function collect(doc: StructureDocument): ChartNode[] {
  const nodes: ChartNode[] = [];
  for (const committee of doc.committees) {
    for (const position of committee.positions) {
      const holders =
        position.holders && position.holders.length
          ? position.holders
          : position.holder && typeof position.holder === "object"
            ? [position.holder]
            : [];
      const primary = holders[0] ?? null;
      nodes.push({
        key: position.key,
        title: position.title,
        tier: position.tier ?? 0,
        order: position.order ?? 0,
        committeeKey: committee.key,
        committeeName: committee.name,
        holders,
        primary,
        name: holderName(primary),
        photoKey: primary?.rosterId ?? primary?.email?.trim().toLowerCase() ?? null,
        parentKey: position.parentKey ?? null,
        x: 0,
        y: 0,
        w: 0,
        h: 0,
      });
    }
  }
  return nodes;
}

function tiers(nodes: ChartNode[]): number[] {
  return [...new Set(nodes.map((n) => n.tier))].sort((a, b) => a - b);
}

function rows(nodes: ChartNode[], tierList: number[]): ChartNode[][] {
  return tierList.map((tier) =>
    nodes.filter((n) => n.tier === tier).sort((a, b) => a.order - b.order),
  );
}

function widthOf(row: ChartNode[], w: number): number {
  if (!row.length) return 0;
  return row.length * w + (row.length - 1) * GAP_X;
}

function positionEdges(nodes: ChartNode[], tierList: number[]): ChartEdge[] {
  const edges: ChartEdge[] = [];
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const byTier = new Map<number, ChartNode[]>();
  for (const n of nodes) {
    const list = byTier.get(n.tier) ?? [];
    list.push(n);
    byTier.set(n.tier, list);
  }

  for (const n of nodes) {
    const parentKey = n.parentKey;
    if (parentKey && byKey.has(parentKey)) {
      edges.push({ from: parentKey, to: n.key });
      continue;
    }
    // Without an explicit reporting line, connect to the nearest seat in the
    // row above so the chart still reads as one tree rather than floating.
    const index = tierList.indexOf(n.tier);
    if (index <= 0) continue;
    let best: ChartNode | null = null;
    let bestDx = Infinity;
    for (const candidate of byTier.get(tierList[index - 1]) ?? []) {
      const dx = Math.abs(candidate.x + candidate.w / 2 - (n.x + n.w / 2));
      if (dx < bestDx) {
        bestDx = dx;
        best = candidate;
      }
    }
    if (best) edges.push({ from: best.key, to: n.key });
  }
  return edges;
}

export function computeChart(
  doc: StructureDocument,
  layout: StructureLayout,
): ChartGeometry {
  const node = sizeFor(layout);
  const nodes = collect(doc);
  const tierList = tiers(nodes);
  const spacing = Math.min(2, Math.max(0.6, layout.tierSpacing || 1));
  const gapY = Math.round(GAP_Y * spacing);
  const edges: ChartEdge[] = [];
  const bands: ChartBand[] = [];

  if (!nodes.length) {
    return {
      width: PAD * 2,
      height: PAD * 2,
      nodes,
      edges,
      bands,
      template: layout.template,
      nodeSize: node,
    };
  }

  const template = layout.template;
  const vertical = layout.orientation !== "horizontal";

  if (template === "columns") {
    // One column per committee, seats stacked in tier order.
    let x = PAD;
    let maxBottom = PAD;
    for (const committee of doc.committees) {
      const inCommittee = nodes
        .filter((n) => n.committeeKey === committee.key)
        .sort((a, b) => a.tier - b.tier || a.order - b.order);
      if (!inCommittee.length) continue;
      bands.push({
        key: `band:${committee.key}`,
        label: committee.name,
        x,
        y: PAD,
        w: node.w,
        h: BAND_H,
      });
      let y = PAD + BAND_H + BAND_GAP;
      for (const n of inCommittee) {
        n.x = x;
        n.y = y;
        n.w = node.w;
        n.h = node.h;
        y += node.h + 12;
      }
      maxBottom = Math.max(maxBottom, y);
      x += node.w + GAP_X + 8;
    }
    for (const n of nodes) {
      const parentKey = n.parentKey;
      const parent = nodes.find((p) => p.key === parentKey);
      if (parent && parent.x === n.x) edges.push({ from: parent.key, to: n.key });
    }
    return {
      width: Math.max(PAD * 2, x - GAP_X),
      height: maxBottom + PAD,
      nodes,
      edges,
      bands,
      template,
      nodeSize: node,
    };
  }

  if (template === "matrix") {
    let x = PAD;
    const columnX = new Map<string, number>();
    for (const committee of doc.committees) {
      columnX.set(committee.key, x);
      bands.push({
        key: `band:${committee.key}`,
        label: committee.name,
        x,
        y: PAD,
        w: node.w,
        h: BAND_H,
      });
      x += node.w + GAP_X;
    }
    const top = PAD + BAND_H + BAND_GAP;
    for (const n of nodes) {
      const ci = doc.committees.findIndex((c) => c.key === n.committeeKey);
      n.x = columnX.get(n.committeeKey) ?? PAD + Math.max(0, ci) * (node.w + GAP_X);
      n.y = top + tierList.indexOf(n.tier) * (node.h + gapY);
      n.w = node.w;
      n.h = node.h;
    }
    edges.push(...positionEdges(nodes, tierList));
    return {
      width: Math.max(PAD * 2, x - GAP_X),
      height: top + tierList.length * (node.h + gapY) - gapY + PAD,
      nodes,
      edges,
      bands,
      template,
      nodeSize: node,
    };
  }

  if (template === "radial") {
    const cx = 0;
    const cy = 0;
    const maxTier = tierList[tierList.length - 1] ?? 0;
    const perRing = new Map<number, number>();
    const seen = new Map<number, number>();
    for (const n of nodes) perRing.set(n.tier, (perRing.get(n.tier) ?? 0) + 1);
    for (const n of nodes) {
      const ring = tierList.indexOf(n.tier);
      const count = perRing.get(n.tier) ?? 1;
      const at = seen.get(n.tier) ?? 0;
      seen.set(n.tier, at + 1);
      const radius = ring === 0 ? (count === 1 ? 0 : 62) : 96 + (ring - 1) * (node.h + gapY);
      const angle = -Math.PI / 2 + (2 * Math.PI * at) / Math.max(1, count);
      n.x = cx + Math.cos(angle) * radius - node.w / 2;
      n.y = cy + Math.sin(angle) * radius - node.h / 2;
      n.w = node.w;
      n.h = node.h;
    }
    const reach = maxTier === 0 ? Math.max(node.w, node.h) : 96 + (tierList.length - 1) * (node.h + gapY);
    const size = Math.ceil(reach * 2 + Math.max(node.w, node.h) + PAD * 2);
    const offsetX = size / 2;
    const offsetY = size / 2;
    for (const n of nodes) {
      n.x += offsetX;
      n.y += offsetY;
    }
    edges.push(...positionEdges(nodes, tierList));
    return { width: size, height: size, nodes, edges, bands, template, nodeSize: node };
  }

  // hierarchy, pyramid, compact: rows of tiers.
  const rowNodes = rows(nodes, tierList);
  const widest = Math.max(...rowNodes.map((r) => widthOf(r, node.w)), node.w);
  const contentW = widest;
  let cursor = PAD;

  rowNodes.forEach((row, index) => {
    const rowW = widthOf(row, node.w);
    const start = PAD + (contentW - rowW) / 2;
    row.forEach((n, i) => {
      n.x = vertical ? start + i * (node.w + GAP_X) : PAD + index * (node.w + gapY);
      n.y = vertical ? cursor : PAD + i * (node.h + GAP_X);
      n.w = node.w;
      n.h = node.h;
    });
    if (vertical) cursor += node.h + gapY;
  });

  if (!vertical) {
    const tallest = Math.max(
      ...rowNodes.map((r) => r.length * node.h + Math.max(0, r.length - 1) * GAP_X),
      node.h,
    );
    rowNodes.forEach((row, index) => {
      const height = row.length * node.h + Math.max(0, row.length - 1) * GAP_X;
      const start = PAD + (tallest - height) / 2;
      row.forEach((n, i) => {
        n.x = PAD + index * (node.w + gapY);
        n.y = start + i * (node.h + GAP_X);
      });
    });
  }

  // Pyramid draws connectors but no explicit reporting tree; hierarchy does both.
  if (template !== "pyramid") {
    edges.push(...positionEdges(nodes, tierList));
  }

  const width = vertical
    ? PAD * 2 + contentW
    : PAD * 2 + rowNodes.length * node.w + Math.max(0, rowNodes.length - 1) * gapY;
  const height = vertical
    ? PAD * 2 + rowNodes.length * node.h + Math.max(0, rowNodes.length - 1) * gapY
    : PAD * 2 +
      Math.max(...rowNodes.map((r) => r.length * node.h + Math.max(0, r.length - 1) * GAP_X), node.h);

  return { width, height, nodes, edges, bands, template, nodeSize: node };
}

export function holderPhotoKey(holder: StructureHolder | null | undefined): string | null {
  if (!holder) return null;
  return holder.rosterId ?? holder.email?.trim().toLowerCase() ?? null;
}

export function positionIsEmpty(position: StructurePosition): boolean {
  return !(position.holders?.length || position.holder);
}
