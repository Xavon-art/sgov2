"use client";

import { useState } from "react";

/**
 * Reordering the builder's rows.
 *
 * Committee order and position order are both part of what gets published, so
 * reordering is a real edit rather than a cosmetic one, and it has to be
 * reachable without a pointer. Native drag events carry the mouse path; the
 * per-row up/down buttons carry the keyboard and touch path. Both go through the
 * same `apply(from, to)`, so the two paths cannot disagree about the result.
 *
 * No dependency earns its place here: the interaction is a list move, HTML5 drag
 * events cover it, and the keyboard path is a pair of buttons either way.
 *
 * `lockFirst` exists because the first committee is the council itself.
 * `gov_document_valid` accepts `isUnit` on that row and nowhere else, so the
 * council is not ours to move -- dragging a committee above it would silently
 * change which committee holds the unit's own seats.
 */

export type ReorderRow = {
  /** True when the row may be dragged. A locked row is still a drop target. */
  draggable: boolean;
  "data-dragging": boolean;
  "data-drop": boolean;
  onDragStart: (event: React.DragEvent) => void;
  onDragOver: (event: React.DragEvent) => void;
  onDragEnd: () => void;
  onDrop: (event: React.DragEvent) => void;
};

export function useReorder(
  keys: string[],
  apply: (from: number, to: number) => void,
  lockFirst = false,
) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const floor = lockFirst ? 1 : 0;

  function move(from: number, to: number) {
    if (from === to) return;
    if (from < floor || to < floor) return;
    if (from < 0 || to < 0 || from >= keys.length || to >= keys.length) return;
    apply(from, to);
  }

  /** The keyboard path, expressed in key terms so a row can call it by identity. */
  function nudge(key: string, delta: number) {
    const from = keys.indexOf(key);
    if (from < floor) return;
    move(from, from + delta);
  }

  function rowProps(key: string, index: number): ReorderRow {
    const movable = index >= floor;
    return {
      draggable: movable,
      "data-dragging": dragging === key,
      "data-drop": over === key && dragging !== key,
      onDragStart: (event) => {
        event.dataTransfer.effectAllowed = "move";
        // Firefox will not start a drag unless some data is set, even when the
        // payload is never read.
        event.dataTransfer.setData("text/plain", key);
        setDragging(key);
      },
      onDragOver: (event) => {
        // Without a preventDefault the drop event never fires, so this is the line
        // that makes the row a drop target at all.
        if (!dragging || dragging === key) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setOver(key);
      },
      onDragEnd: () => {
        setDragging(null);
        setOver(null);
      },
      onDrop: (event) => {
        event.preventDefault();
        const from = keys.indexOf(dragging ?? "");
        setDragging(null);
        setOver(null);
        if (from < floor) return;
        move(from, index);
      },
    };
  }

  return { rowProps, nudge };
}