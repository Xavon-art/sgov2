"use client";

/**
 * Export from the same geometry the screen uses.
 *
 * The SVG is built directly rather than screenshotting the DOM: a screenshot
 * depends on fonts, zoom and whatever is scrolled into view, and a structure
 * that prints differently on another machine is not a record. Text wraps by a
 * measured-enough character budget, photos are embedded as data URLs, and the
 * result is one self-contained file.
 */

import type { StructureLayout } from "@/lib/structure";
import type { ChartGeometry } from "@/components/structure/chart";

const COLORS: Record<
  StructureLayout["theme"],
  { bg: string; node: string; border: string; ink: string; muted: string; accent: string; edge: string; band: string; bandInk: string }
> = {
  parchment: {
    bg: "#f7f1e4", node: "#fffdf7", border: "#d9cdb4", ink: "#2d2418",
    muted: "#7a6a52", accent: "#a8792c", edge: "rgba(120,100,70,0.55)",
    band: "#efe4cd", bandInk: "#5c4a2e",
  },
  ink: {
    bg: "#12161c", node: "#1b222c", border: "#33404f", ink: "#eef2f7",
    muted: "#93a1b3", accent: "#e2b865", edge: "rgba(180,200,225,0.4)",
    band: "#232d3a", bandInk: "#c6d2e0",
  },
  brass: {
    bg: "#22201b", node: "#2d2a23", border: "#5a4d34", ink: "#f6efdf",
    muted: "#b9a784", accent: "#d3a24c", edge: "rgba(211,162,76,0.45)",
    band: "#3a3427", bandInk: "#e5d3ac",
  },
  slate: {
    bg: "#eef2f6", node: "#ffffff", border: "#c6d2dd", ink: "#1a2735",
    muted: "#5d7285", accent: "#3d6b96", edge: "rgba(61,107,150,0.4)",
    band: "#dde6ef", bandInk: "#33506d",
  },
};

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function clip(value: string, max: number): string {
  const text = value.trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function chartToSvg({
  geometry,
  layout,
  photos,
  title,
  subtitle,
}: {
  geometry: ChartGeometry;
  layout: StructureLayout;
  photos: Record<string, string | null>;
  title?: string;
  subtitle?: string;
}): string {
  const c = COLORS[layout.theme] ?? COLORS.parchment;
  const byKey = new Map(geometry.nodes.map((n) => [n.key, n]));
  const compact = layout.template === "compact";
  const leader = Math.round(geometry.nodeSize.w * 0.32);
  const header = title ? 52 : 12;
  const head = title
    ? `<text x="${geometry.width / 2}" y="26" text-anchor="middle" font-family="Georgia, serif" font-size="18" font-weight="600" fill="${c.ink}">${esc(title)}</text>${
        subtitle
          ? `<text x="${geometry.width / 2}" y="43" text-anchor="middle" font-family="Inter, sans-serif" font-size="10" fill="${c.muted}">${esc(subtitle)}</text>`
          : ""
      }`
    : "";

  const defs = geometry.nodes
    .map((n) => {
      const url = n.photoId ? photos[n.photoId] : null;
      return url ? `<clipPath id="clip-${esc(n.key)}"><circle cx="${leader / 2}" cy="${leader / 2}" r="${leader / 2}"/></clipPath>` : "";
    })
    .join("");

  const bands = geometry.bands
    .map(
      (band) =>
        `<g><rect x="${band.x}" y="${band.y + header}" rx="6" width="${band.w}" height="${band.h}" fill="${c.band}"/>` +
        `<text x="${band.x + band.w / 2}" y="${band.y + header + band.h / 2 + 3}" text-anchor="middle" font-family="Inter, sans-serif" font-size="8" font-weight="600" letter-spacing="1" fill="${c.bandInk}">${esc(clip(band.label, 26))}</text></g>`,
    )
    .join("");

  const edges = geometry.edges
    .map((edge) => {
      const from = byKey.get(edge.from);
      const to = byKey.get(edge.to);
      if (!from || !to) return "";
      const fx = from.x + from.w / 2;
      const fy = from.y + from.h / 2 + header;
      const tx = to.x + to.w / 2;
      const ty = to.y + to.h / 2 + header;
      if (layout.template === "radial") {
        return `<line x1="${fx}" y1="${fy}" x2="${tx}" y2="${ty}" stroke="${c.edge}" stroke-width="1.4"/>`;
      }
      const vertical = Math.abs(ty - fy) >= Math.abs(tx - fx);
      if (vertical) {
        const sy = ty > fy ? from.y + from.h + header : from.y + header;
        const ey = ty > fy ? to.y + header : to.y + to.h + header;
        const mid = (sy + ey) / 2;
        return `<path d="M ${fx} ${sy} C ${fx} ${mid}, ${tx} ${mid}, ${tx} ${ey}" fill="none" stroke="${c.edge}" stroke-width="1.4"/>`;
      }
      const sx = tx > fx ? from.x + from.w : from.x;
      const ex = tx > fx ? to.x : to.x + to.w;
      const mid = (sx + ex) / 2;
      return `<path d="M ${sx} ${fy} C ${mid} ${fy}, ${mid} ${ty}, ${ex} ${ty}" fill="none" stroke="${c.edge}" stroke-width="1.4"/>`;
    })
    .join("");

  const nodes = geometry.nodes
    .map((n) => {
      const y = n.y + header;
      const url = n.photoId ? photos[n.photoId] : null;
      const name = clip(n.name || (n.primary ? "Unnamed" : "Vacant"), compact ? 18 : 22);
      const role = clip(n.title, compact ? 24 : 30);
      const avatar = layout.showPhotos
        ? url
          ? `<g transform="translate(${n.x + 10}, ${y + (n.h - leader) / 2})"><image href="${esc(url)}" width="${leader}" height="${leader}" clip-path="url(#clip-${esc(n.key)})" preserveAspectRatio="xMidYMid slice"/></g>`
          : `<g transform="translate(${n.x + 10}, ${y + (n.h - leader) / 2})"><circle cx="${leader / 2}" cy="${leader / 2}" r="${leader / 2}" fill="${c.band}"/><text x="${leader / 2}" y="${leader / 2 + 4}" text-anchor="middle" font-family="Inter, sans-serif" font-size="${Math.max(9, Math.round(leader * 0.32))}" font-weight="600" fill="${c.bandInk}">${esc(initials(n.name || n.title))}</text></g>`
        : "";
      const textX = layout.showPhotos ? n.x + 10 + leader + 8 : n.x + 10;
      return (
        `<g>` +
        `<rect x="${n.x}" y="${y}" rx="10" width="${n.w}" height="${n.h}" fill="${c.node}" stroke="${c.border}"/>` +
        avatar +
        `<text x="${textX}" y="${y + (layout.showTitles ? n.h / 2 - 2 : n.h / 2 + 4)}" font-family="Georgia, serif" font-size="${compact ? 10 : 11.5}" font-weight="600" fill="${c.ink}">${esc(name)}</text>` +
        (layout.showTitles
          ? `<text x="${textX}" y="${y + n.h / 2 + 11}" font-family="Inter, sans-serif" font-size="${compact ? 8.5 : 9.5}" fill="${c.muted}">${esc(role)}</text>`
          : "") +
        `</g>`
      );
    })
    .join("");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${geometry.width}" height="${geometry.height + header}" viewBox="0 0 ${geometry.width} ${geometry.height + header}">` +
    `<defs>${defs}</defs>` +
    `<rect width="100%" height="100%" fill="${c.bg}"/>` +
    head +
    bands +
    edges +
    nodes +
    `</svg>`
  );
}

export function downloadSvg(svg: string, filename: string) {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  triggerDownload(URL.createObjectURL(blob), `${filename}.svg`, true);
}

export async function downloadPng(svg: string, filename: string, scale = 2) {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "sync";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The chart could not be drawn."));
      image.src = url;
    });
    const ratio = Math.min(3, Math.max(1, scale));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * ratio);
    canvas.height = Math.round(image.height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot export an image.");
    ctx.scale(ratio, ratio);
    ctx.drawImage(image, 0, 0);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) throw new Error("This browser cannot export an image.");
    triggerDownload(URL.createObjectURL(png), `${filename}.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function printSvg(svg: string, title: string) {
  const win = window.open("", "_blank", "noopener,noreferrer,width=1100,height=800");
  if (!win) return;
  win.document.write(
    `<!doctype html><html><head><title>${esc(title)}</title><style>@page{size:auto;margin:12mm}body{margin:0;display:grid;place-items:center}svg{max-width:100%;height:auto}</style></head><body>${svg}<script>window.onload=function(){window.print()}</script></body></html>`,
  );
  win.document.close();
}

function triggerDownload(url: string, filename: string, revoke = false) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  if (revoke) setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
