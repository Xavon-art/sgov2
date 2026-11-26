// @ts-nocheck
"use client";

import { useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import type { StructureDocument, StructurePosition } from "@/lib/structure";
import { POS_PREFIX, ROOT_ID, toOrgData, applyOrgMove } from "@/components/structure/orgchart-editor/orgchart-adapter";
import "orgchart/dist/css/orgchart.min.css";
import "@/components/structure/orgchart-editor/orgchart-theme.css";

const OrgChartLib = dynamic(
  () => import("orgchart").then((mod) => mod.default || mod),
  { ssr: false },
);

type OrgChartCanvasProps = {
  doc: StructureDocument;
  unitName: string;
  canEdit: boolean;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onChange: (doc: StructureDocument) => void;
  photoUrls: Record<string, string | null>;
};

function escapeHtml(value: string | null | undefined): string {
  if (!value) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const first = String(name).trim().split(/\s+/).find(Boolean);
  return first ? first[0].toUpperCase() : "?";
}

function nodeTemplate(data: any, canEdit: boolean, selectedKey: string | null): string {
  const id = data.id || "";
  const email = (data.email || "").trim();
  const name = escapeHtml(data.name || "Vacant");
  const title = escapeHtml(data.title || "");
  const course = escapeHtml(data.course || "");
  const year = escapeHtml(data.yearLevel || "");
  const section = escapeHtml(data.section || "");
  const photo = data.photo || null;
  const hasPhoto = data.hasPhoto || !!photo;
  const avatar = hasPhoto && photo
    ? `<img class="org-avatar-img" src="${escapeHtml(photo)}" alt="">`
    : `<span class="org-initials">${initials(name)}</span>`;
  const meta = [course, year, section].filter(Boolean).join(" · ");
  const editButton = canEdit
    ? `<button type="button" class="org-edit" aria-label="Edit ${name}">Edit</button>`
    : "";
  const selectedClass = data.id === selectedKey ? " org-selected" : "";
  return `
    <div class="org-node${selectedClass}" data-id="${escapeHtml(id)}">
      <div class="org-avatar">${avatar}</div>
      <div class="org-name">${name}</div>
      <div class="org-position">${title}</div>
      ${meta ? `<div class="org-meta">${meta}</div>` : ""}
      ${email ? `<div class="org-email">${escapeHtml(email)}</div>` : ""}
      ${editButton}
    </div>
  `;
}

export function OrgChartCanvas({
  doc,
  unitName,
  canEdit,
  selectedKey,
  onSelect,
  onChange,
  photoUrls,
}: OrgChartCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<any>(null);

  const handleDrop = useCallback(
    (event: CustomEvent) => {
      event.preventDefault();
      const detail = event.detail || {};
      const draggedNode = detail.draggedNode;
      const dropZone = detail.dropZone;
      const sourceId = draggedNode?.id;
      const targetId = dropZone?.id;
      if (!sourceId || !targetId || sourceId === targetId) return;
      if (sourceId === ROOT_ID) return;
      const next = applyOrgMove(doc, sourceId, targetId, unitName);
      if (next !== doc) onChange(next);
    },
    [doc, unitName, onChange],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const OrgChart = OrgChartLib as any;
    if (!OrgChart) return undefined;

    container.innerHTML = "";
    const org = new OrgChart({
      chartContainer: container,
      data: toOrgData(doc, unitName, photoUrls),
      nodeTitle: "name",
      nodeId: "id",
      draggable: canEdit,
      direction: "t2b",
      nodeTemplate: (data: any) =>
        nodeTemplate(data, canEdit, selectedKey),
      createNode: (nodeElement: HTMLElement, data: any) => {
        const editButton = nodeElement.querySelector(".org-edit");
        if (editButton) {
          editButton.addEventListener("click", (event: MouseEvent) => {
            event.stopPropagation();
            onSelect(data.id ?? null);
          });
        }
        nodeElement.addEventListener("keydown", (event: KeyboardEvent) => {
          if ((event.key === "Enter" || event.key === " ") && !event.target?.closest(".org-edit")) {
            event.preventDefault();
            onSelect(data.id ?? null);
          }
        });
      },
    });
    instanceRef.current = org;

    container.addEventListener("nodedrop.orgchart", handleDrop);

    return () => {
      container.removeEventListener("nodedrop.orgchart", handleDrop);
      container.innerHTML = "";
      instanceRef.current = undefined;
    };
  }, [doc, unitName, canEdit, selectedKey, photoUrls, onSelect, onChange, handleDrop]);

  return (
    <div className="orgchart-wrap" ref={containerRef}>
      <div className="org-empty" style={{ display: "contents" }} />
    </div>
  );
}

export type { StructurePosition };
