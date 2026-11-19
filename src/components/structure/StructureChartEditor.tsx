"use client";

/**
 * Drag-and-drop chart builder.
 *
 * The document is still the single source of truth: dragging writes `tier`,
 * `order` and `parentKey` onto a seat and nothing else. Every mutation goes
 * through the parent's `onChange`, which marks the draft dirty; the workspace
 * autosaves with the optimistic-concurrency token.
 */

import { useMemo, useRef, useState, type CSSProperties } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import {
  CHART_TEMPLATES,
  MAX_PHOTO_BYTES,
  type ChartNodeSize,
  type StructureCommittee,
  type StructureDocument,
  type StructureHolder,
  type StructureLayout,
  type StructurePosition,
} from "@/lib/structure";
import {
  emptyPosition,
  findPosition,
  nextKey,
  normalizeDocument,
} from "@/components/structure/document";
import { computeChart, type ChartNode } from "@/components/structure/chart";
import {
  ChartBands,
  ChartEdges,
  ChartNodeCard,
  chartFrameStyle,
  THEMES,
  useChartPhotos,
} from "@/components/structure/StructureChart";
import { Button } from "@/components/ui/Button";

type Props = {
  doc: StructureDocument;
  onChange: (next: StructureDocument) => void;
  layout: StructureLayout;
  onLayout: (next: StructureLayout) => void;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  busy?: boolean;
};

function withDoc(doc: StructureDocument, committees: StructureCommittee[]): StructureDocument {
  return normalizeDocument({ ...doc, committees });
}

function patchPosition(
  doc: StructureDocument,
  key: string,
  patch: (position: StructurePosition) => StructurePosition,
): StructureDocument {
  return withDoc(
    doc,
    doc.committees.map((committee) => ({
      ...committee,
      positions: committee.positions.map((position) =>
        position.key === key ? patch(position) : position,
      ),
    })),
  );
}

function removePosition(doc: StructureDocument, key: string): StructureDocument {
  const next = withDoc(
    doc,
    doc.committees.map((committee) => ({
      ...committee,
      positions: committee.positions.filter((position) => position.key !== key),
    })),
  );
  // A seat that reported to the removed one must not be left dangling.
  return withDoc(
    next,
    next.committees.map((committee) => ({
      ...committee,
      positions: committee.positions.map((position) =>
        position.parentKey === key ? { ...position, parentKey: null } : position,
      ),
    })),
  );
}

function tierNextOrder(doc: StructureDocument, tier: number): number {
  let max = -1;
  for (const committee of doc.committees) {
    for (const position of committee.positions) {
      if ((position.tier ?? 0) === tier) max = Math.max(max, position.order ?? 0);
    }
  }
  return max + 1;
}

function reindexTiers(doc: StructureDocument): StructureDocument {
  const byTier = new Map<number, string[]>();
  for (const committee of doc.committees) {
    for (const position of committee.positions) {
      const tier = position.tier ?? 0;
      const list = byTier.get(tier) ?? [];
      list.push(position.key);
      byTier.set(tier, list);
    }
  }
  const orders = new Map<string, number>();
  for (const list of byTier.values()) {
    list
      .map((key) => ({ key, at: findPosition(doc, key)?.position.order ?? 0 }))
      .sort((a, b) => a.at - b.at)
      .forEach((entry, index) => orders.set(entry.key, index));
  }
  return withDoc(
    doc,
    doc.committees.map((committee) => ({
      ...committee,
      positions: committee.positions.map((position) => ({
        ...position,
        order: orders.get(position.key) ?? position.order ?? 0,
      })),
    })),
  );
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function StructureChartEditor({
  doc,
  onChange,
  layout,
  onLayout,
  selectedKey,
  onSelect,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  busy,
}: Props) {
  const geometry = useMemo(() => computeChart(doc, layout), [doc, layout]);
  const photos = useChartPhotos(geometry.nodes, layout.showPhotos);
  const [active, setActive] = useState<string | null>(null);
  const [wizard, setWizard] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const selected = selectedKey ? findPosition(doc, selectedKey) : null;

  function onDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    if (id.startsWith("pos:")) setActive(id.slice(4));
  }

  function onDragEnd(event: DragEndEvent) {
    setActive(null);
    const id = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!id.startsWith("pos:") || !overId) return;
    const key = id.slice(4);

    if (overId.startsWith("tier:")) {
      const tier = Number(overId.slice(5));
      onChange(
        reindexTiers(
          patchPosition(doc, key, (position) => ({
            ...position,
            tier,
            order: tierNextOrder(doc, tier),
            parentKey: null,
          })),
        ),
      );
      return;
    }

    if (overId.startsWith("node:")) {
      const targetKey = overId.slice(5);
      if (targetKey === key) return;
      const target = findPosition(doc, targetKey);
      if (!target) return;
      const tier = Math.min(12, (target.position.tier ?? 0) + 1);
      onChange(
        reindexTiers(
          patchPosition(doc, key, (position) => ({
            ...position,
            tier,
            order: tierNextOrder(doc, tier),
            parentKey: targetKey,
          })),
        ),
      );
    }
  }

  function addSeat(committeeKey?: string) {
    const target =
      doc.committees.find((c) => c.key === committeeKey) ??
      doc.committees[0];
    if (!target) return;
    const position = emptyPosition(0, tierNextOrder(doc, 0));
    onChange(
      withDoc(
        doc,
        doc.committees.map((committee) =>
          committee.key === target.key
            ? { ...committee, positions: [...committee.positions, position] }
            : committee,
        ),
      ),
    );
    onSelect(position.key);
  }

  function addChild(parentKey: string) {
    const at = findPosition(doc, parentKey);
    if (!at) return;
    const tier = Math.min(12, (at.position.tier ?? 0) + 1);
    const position = {
      ...emptyPosition(tier, tierNextOrder(doc, tier)),
      parentKey,
    };
    onChange(
      withDoc(
        doc,
        doc.committees.map((committee) =>
          committee.key === at.committee.key
            ? { ...committee, positions: [...committee.positions, position] }
            : committee,
        ),
      ),
    );
    onSelect(position.key);
  }

  function duplicate(key: string) {
    const at = findPosition(doc, key);
    if (!at) return;
    const copy: StructurePosition = {
      ...at.position,
      key: nextKey("pos"),
      title: `${at.position.title} (copy)`,
      order: tierNextOrder(doc, at.position.tier ?? 0),
    };
    onChange(
      withDoc(
        doc,
        doc.committees.map((committee) =>
          committee.key === at.committee.key
            ? { ...committee, positions: [...committee.positions, copy] }
            : committee,
        ),
      ),
    );
    onSelect(copy.key);
  }

  function nudge(key: string, delta: -1 | 1) {
    const at = findPosition(doc, key);
    if (!at) return;
    const tier = at.position.tier ?? 0;
    const siblings = doc.committees
      .flatMap((committee) => committee.positions)
      .filter((position) => (position.tier ?? 0) === tier)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const index = siblings.findIndex((position) => position.key === key);
    const target = siblings[index + delta];
    if (!target) return;
    const order = at.position.order ?? 0;
    const theirOrder = target.order ?? 0;
    onChange(
      withDoc(
        doc,
        doc.committees.map((committee) => ({
          ...committee,
          positions: committee.positions.map((position) => {
            if (position.key === key) return { ...position, order: theirOrder };
            if (position.key === target.key) return { ...position, order };
            return position;
          }),
        })),
      ),
    );
  }

  // Droppable lanes: one per tier, sized to that tier's row.
  const lanes = useMemo(() => {
    const byTier = new Map<number, ChartNode[]>();
    for (const node of geometry.nodes) {
      const list = byTier.get(node.tier) ?? [];
      list.push(node);
      byTier.set(node.tier, list);
    }
    return [...byTier.entries()].map(([tier, nodes]) => {
      const left = Math.min(...nodes.map((n) => n.x));
      const right = Math.max(...nodes.map((n) => n.x + n.w));
      const top = Math.min(...nodes.map((n) => n.y));
      const bottom = Math.max(...nodes.map((n) => n.y + n.h));
      return { tier, left, top, width: right - left, height: bottom - top };
    });
  }, [geometry]);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-line bg-paper/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {CHART_TEMPLATES.map((template) => (
              <button
                key={template.key}
                type="button"
                title={template.hint}
                onClick={() => onLayout({ ...layout, template: template.key })}
                className={clsx(
                  "rounded-full border px-3 py-1 text-[0.6875rem] font-medium transition-colors",
                  layout.template === template.key
                    ? "border-ink bg-ink text-paper"
                    : "border-line bg-paper text-ink-soft hover:border-ink/30 hover:text-ink",
                )}
              >
                {template.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button type="button" variant="ghost" size="sm" onClick={onUndo} disabled={!canUndo || busy}>
              Undo
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onRedo} disabled={!canRedo || busy}>
              Redo
            </Button>
            <Button type="button" variant="paper" size="sm" onClick={() => setWizard(true)} disabled={busy}>
              Add officer
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => addSeat(selected?.committee.key)} disabled={busy}>
              Add seat
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <label className="flex items-center gap-2 text-[0.75rem] text-ink-soft">
            <span className="font-medium">Theme</span>
            <span className="flex items-center gap-1">
              {(Object.keys(THEMES) as Array<StructureLayout["theme"]>).map((theme) => (
                <button
                  key={theme}
                  type="button"
                  aria-label={theme}
                  onClick={() => onLayout({ ...layout, theme })}
                  className={clsx(
                    "size-6 rounded-full border-2",
                    layout.theme === theme ? "border-ink" : "border-transparent",
                  )}
                  style={{ background: THEMES[theme].bg, boxShadow: `inset 0 0 0 1px ${THEMES[theme].band}` }}
                />
              ))}
            </span>
          </label>
          <label className="flex items-center gap-2 text-[0.75rem] text-ink-soft">
            <span className="font-medium">Direction</span>
            <select
              value={layout.orientation}
              onChange={(e) => onLayout({ ...layout, orientation: e.target.value as StructureLayout["orientation"] })}
              className="rounded-lg border border-line bg-paper px-2 py-1 text-[0.75rem]"
            >
              <option value="vertical">Top down</option>
              <option value="horizontal">Left to right</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-[0.75rem] text-ink-soft">
            <span className="font-medium">Size</span>
            <select
              value={layout.nodeSize}
              onChange={(e) => onLayout({ ...layout, nodeSize: e.target.value as ChartNodeSize })}
              className="rounded-lg border border-line bg-paper px-2 py-1 text-[0.75rem]"
            >
              <option value="sm">Small</option>
              <option value="md">Medium</option>
              <option value="lg">Large</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-[0.75rem] text-ink-soft">
            <input
              type="checkbox"
              checked={layout.showPhotos}
              onChange={(e) => onLayout({ ...layout, showPhotos: e.target.checked })}
            />
            Photos
          </label>
          <label className="flex items-center gap-2 text-[0.75rem] text-ink-soft">
            <input
              type="checkbox"
              checked={layout.showTitles}
              onChange={(e) => onLayout({ ...layout, showTitles: e.target.checked })}
            />
            Titles
          </label>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="overflow-auto rounded-2xl border border-line bg-canvas/40 p-2" style={{ maxHeight: 680 }}>
            <div className="relative" style={chartFrameStyle(geometry, layout)}>
              <ChartEdges geometry={geometry} layout={layout} />
              <ChartBands geometry={geometry} layout={layout} />

              {lanes.map((lane) => (
                <TierLane key={lane.tier} lane={lane} />
              ))}

              {geometry.nodes.map((node) => (
                <DraggableNode
                  key={node.key}
                  node={node}
                  layout={layout}
                  photo={node.primary?.rosterId ? photos[node.primary.rosterId] : null}
                  selected={selectedKey === node.key}
                  onSelect={onSelect}
                />
              ))}

              <DragOverlay dropAnimation={null}>
                {active ? (() => {
                  const node = geometry.nodes.find((n) => n.key === active);
                  if (!node) return null;
                  return (
                    <div style={{ width: node.w, height: node.h }} className="opacity-90 shadow-2xl">
                      <ChartNodeCard
                        node={node}
                        layout={layout}
                        photo={node.primary?.rosterId ? photos[node.primary.rosterId] : null}
                        cardStyle={{ position: "relative", left: 0, top: 0 }}
                      />
                    </div>
                  );
                })() : null}
              </DragOverlay>
            </div>
          </div>
        </DndContext>

        <Inspector
          doc={doc}
          selected={selected}
          onChange={onChange}
          onSelect={onSelect}
          onDelete={(key) => {
            onChange(removePosition(doc, key));
            onSelect(null);
          }}
          onDuplicate={duplicate}
          onAddChild={addChild}
          onNudge={nudge}
          busy={busy}
        />
      </div>

      {wizard ? (
        <OfficerWizard
          doc={doc}
          onClose={() => setWizard(false)}
          onAdd={(committeeName, position, newCommittee) => {
            const committee =
              doc.committees.find((c) => c.name === committeeName) ??
              doc.committees[0];
            let next = doc;
            if (newCommittee) {
              const created: StructureCommittee = {
                key: nextKey("cmt"),
                name: newCommittee,
                positions: [],
              };
              next = withDoc(doc, [...doc.committees, created]);
              next = withDoc(
                next,
                next.committees.map((c) =>
                  c.key === created.key ? { ...c, positions: [position] } : c,
                ),
              );
            } else if (committee) {
              next = withDoc(
                doc,
                doc.committees.map((c) =>
                  c.key === committee.key ? { ...c, positions: [...c.positions, position] } : c,
                ),
              );
            }
            onChange(next);
            onSelect(position.key);
            setWizard(false);
          }}
        />
      ) : null}
    </div>
  );
}

function DraggableNode({
  node,
  layout,
  photo,
  selected,
  onSelect,
}: {
  node: ChartNode;
  layout: StructureLayout;
  photo: string | null | undefined;
  selected: boolean;
  onSelect: (key: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `pos:${node.key}`,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `node:${node.key}` });

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.35 : 1,
    zIndex: isDragging ? 40 : undefined,
  };

  return (
    <ChartNodeCard
      node={node}
      layout={layout}
      photo={photo}
      selected={selected || isOver}
      interactive
      onSelect={onSelect}
      cardRef={(element) => {
        setNodeRef(element);
        setDropRef(element);
      }}
      cardStyle={style}
      dragHandle={
        <span
          {...attributes}
          {...listeners}
          aria-label={`Move ${node.title}`}
          className="absolute right-1 top-1 cursor-grab rounded p-1 text-[0.625rem] opacity-40 transition-opacity hover:opacity-100 active:cursor-grabbing"
          style={{ touchAction: "none", color: "inherit" }}
        >
          ⠿
        </span>
      }
    />
  );
}

function TierLane({
  lane,
}: {
  lane: { tier: number; left: number; top: number; width: number; height: number };
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `tier:${lane.tier}` });
  return (
    <div
      ref={setNodeRef}
      className={clsx(
        "pointer-events-auto absolute rounded-xl border border-dashed transition-colors",
        isOver ? "border-brass bg-brass-soft/20" : "border-transparent",
      )}
      style={{
        left: lane.left - 10,
        top: lane.top - 10,
        width: lane.width + 20,
        height: lane.height + 20,
      }}
      aria-label={`Tier ${lane.tier + 1}`}
    />
  );
}

function Inspector({
  doc,
  selected,
  onChange,
  onSelect,
  onDelete,
  onDuplicate,
  onAddChild,
  onNudge,
  busy,
}: {
  doc: StructureDocument;
  selected: ReturnType<typeof findPosition>;
  onChange: (next: StructureDocument) => void;
  onSelect: (key: string | null) => void;
  onDelete: (key: string) => void;
  onDuplicate: (key: string) => void;
  onAddChild: (key: string) => void;
  onNudge: (key: string, delta: -1 | 1) => void;
  busy?: boolean;
}) {
  if (!selected) {
    return (
      <aside className="rounded-2xl border border-line bg-paper/70 p-4">
        <p className="text-[0.8125rem] leading-relaxed text-muted">
          Select a seat to edit it, or drag one onto another to set who it reports to.
        </p>
        <p className="mt-2 text-[0.75rem] leading-relaxed text-muted">
          {doc.committees.length} committee{doc.committees.length === 1 ? "" : "s"} ·{" "}
          {doc.committees.reduce((sum, c) => sum + c.positions.length, 0)} seats
        </p>
      </aside>
    );
  }

  const { committee, position } = selected;
  const holders =
    position.holders && position.holders.length
      ? position.holders
      : position.holder && Object.keys(position.holder).length
        ? [position.holder]
        : [];
  const primary = holders[0] ?? null;

  function patch(next: Partial<StructurePosition>) {
    onChange(
      withDoc(
        doc,
        doc.committees.map((c) =>
          c.key === committee.key
            ? {
                ...c,
                positions: c.positions.map((p) =>
                  p.key === position.key ? { ...p, ...next } : p,
                ),
              }
            : c,
        ),
      ),
    );
  }

  function patchHolder(index: number, next: Partial<StructureHolder>) {
    const merged = { ...holders[index], ...next };
    // Keep the display name in step with the name parts; only an explicit
    // fullName edit wins.
    if ("fullName" in next) {
      merged.fullName = next.fullName?.trim() || undefined;
    } else if (next.firstName !== undefined || next.lastName !== undefined || next.middleName !== undefined || next.suffix !== undefined) {
      const composed = [merged.firstName, merged.middleName, merged.lastName, merged.suffix]
        .map((part) => (part ?? "").trim())
        .filter(Boolean)
        .join(" ");
      merged.fullName = composed || undefined;
    }
    const list = holders.slice();
    list[index] = merged;
    patch({
      holders: list,
      holder: index === 0 ? list[0] : position.holder,
    });
  }

  function addHolder() {
    const next = [...holders, { email: "", firstName: "", lastName: "" }];
    patch({ holders: next, holder: next[0] ?? null, maxHolders: Math.max(position.maxHolders ?? 1, next.length) });
  }

  function removeHolder(index: number) {
    const next = holders.filter((_, i) => i !== index);
    patch({ holders: next, holder: next[0] ?? null });
  }

  return (
    <aside className="flex flex-col gap-3 rounded-2xl border border-line bg-paper/70 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-muted">
          {committee.name}
        </span>
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="text-[0.6875rem] text-muted hover:text-ink"
        >
          Close
        </button>
      </div>

      <label className="block">
        <span className="text-[0.6875rem] font-medium text-ink-soft">Title</span>
        <input
          value={position.title}
          onChange={(e) => patch({ title: e.target.value })}
          className="mt-1 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[0.8125rem]"
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[0.6875rem] font-medium text-ink-soft">Tier</span>
          <input
            type="number"
            min={0}
            max={12}
            value={position.tier ?? 0}
            onChange={(e) => patch({ tier: Math.max(0, Math.min(12, Number(e.target.value) || 0)) })}
            className="mt-1 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[0.8125rem]"
          />
        </label>
        <label className="block">
          <span className="text-[0.6875rem] font-medium text-ink-soft">Max holders</span>
          <input
            type="number"
            min={0}
            max={20}
            value={position.maxHolders ?? 1}
            onChange={(e) => patch({ maxHolders: Math.max(0, Math.min(20, Number(e.target.value) || 0)) })}
            className="mt-1 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[0.8125rem]"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-[0.6875rem] font-medium text-ink-soft">Reports to</span>
        <select
          value={position.parentKey ?? ""}
          onChange={(e) => {
            const parentKey = e.target.value || null;
            const parent = parentKey ? findPosition(doc, parentKey) : null;
            patch({
              parentKey,
              tier: parent ? Math.min(12, (parent.position.tier ?? 0) + 1) : (position.tier ?? 0),
            });
          }}
          className="mt-1 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[0.8125rem]"
        >
          <option value="">No parent</option>
          {doc.committees.flatMap((c) =>
            c.positions
              .filter((p) => p.key !== position.key)
              .map((p) => (
                <option key={p.key} value={p.key}>
                  {p.title} — {c.name}
                </option>
              )),
          )}
        </select>
      </label>

      <label className="block">
        <span className="text-[0.6875rem] font-medium text-ink-soft">Committee</span>
        <select
          value={committee.key}
          onChange={(e) => {
            const targetKey = e.target.value;
            if (targetKey === committee.key) return;
            onChange(
              withDoc(
                doc,
                doc.committees.map((c) => {
                  if (c.key === committee.key) {
                    return { ...c, positions: c.positions.filter((p) => p.key !== position.key) };
                  }
                  if (c.key === targetKey) {
                    return {
                      ...c,
                      positions: [...c.positions, { ...position, order: tierNextOrder(doc, position.tier ?? 0) }],
                    };
                  }
                  return c;
                }),
              ),
            );
          }}
          className="mt-1 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[0.8125rem]"
        >
          {doc.committees.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-[0.6875rem] font-medium text-ink-soft">Group</span>
        <input
          value={position.group ?? ""}
          onChange={(e) => patch({ group: e.target.value || null })}
          placeholder="Optional cluster label"
          className="mt-1 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[0.8125rem]"
        />
      </label>

      <div className="border-t border-line pt-3">
        <div className="flex items-center justify-between">
          <span className="text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-muted">
            Holders
          </span>
          <button
            type="button"
            onClick={addHolder}
            disabled={(position.maxHolders ?? 1) === 0}
            className="text-[0.6875rem] text-brass hover:underline disabled:opacity-40"
          >
            + Co-holder
          </button>
        </div>

        {holders.length === 0 ? (
          <p className="mt-2 text-[0.75rem] text-muted">Vacant. Add a holder to name someone.</p>
        ) : null}

        {holders.map((holder, index) => (
          <div key={index} className="mt-2 rounded-xl border border-line bg-canvas/40 p-2.5">
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <input
                  value={holder.fullName ?? ""}
                  onChange={(e) => patchHolder(index, { fullName: e.target.value })}
                  placeholder="Display name"
                  className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[0.8125rem]"
                />
                {holders.length > 1 || index > 0 ? (
                  <button
                    type="button"
                    onClick={() => removeHolder(index)}
                    className="text-[0.6875rem] text-[#8c3126] hover:underline"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
              <input
                value={holder.email}
                onChange={(e) => patchHolder(index, { email: e.target.value })}
                placeholder="Email (required)"
                type="email"
                className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[0.8125rem]"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={holder.firstName ?? ""}
                  onChange={(e) => patchHolder(index, { firstName: e.target.value })}
                  placeholder="First name"
                  className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[0.8125rem]"
                />
                <input
                  value={holder.lastName ?? ""}
                  onChange={(e) => patchHolder(index, { lastName: e.target.value })}
                  placeholder="Last name"
                  className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[0.8125rem]"
                />
              </div>
              <input
                value={holder.termNote ?? ""}
                onChange={(e) => patchHolder(index, { termNote: e.target.value })}
                placeholder="Term note (optional)"
                className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[0.8125rem]"
              />
              <label className="block text-[0.6875rem] text-muted">
                Photo
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="mt-1 block w-full text-[0.6875rem] file:mr-2 file:rounded-full file:border file:border-line file:bg-paper file:px-2 file:py-1 file:text-[0.6875rem]"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    if (file.size > MAX_PHOTO_BYTES) return;
                    const base64 = await toBase64(file);
                    patchHolder(index, { photo: base64, hasPhoto: true });
                  }}
                />
                {index === 0 && primary?.hasPhoto && !primary.photo ? (
                  <span className="mt-1 block text-[0.625rem] text-muted">A photo is on file.</span>
                ) : null}
              </label>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5 border-t border-line pt-3">
        <Button type="button" variant="ghost" size="sm" onClick={() => onNudge(position.key, -1)} disabled={busy}>
          ← Move
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onNudge(position.key, 1)} disabled={busy}>
          Move →
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onAddChild(position.key)} disabled={busy}>
          Add report
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onDuplicate(position.key)} disabled={busy}>
          Duplicate
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onDelete(position.key)} disabled={busy}>
          Delete
        </Button>
      </div>
    </aside>
  );
}

function OfficerWizard({
  doc,
  onClose,
  onAdd,
}: {
  doc: StructureDocument;
  onClose: () => void;
  onAdd: (committeeName: string, position: StructurePosition, newCommittee?: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [committeeChoice, setCommitteeChoice] = useState(doc.committees[0]?.name ?? "__new");
  const [newCommittee, setNewCommittee] = useState("");
  const [tier, setTier] = useState(1);
  const [parentKey, setParentKey] = useState("");
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [suffix, setSuffix] = useState("");
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [termNote, setTermNote] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function submit() {
    if (!title.trim()) return setProblem("Give the seat a title.");
    if (!email.includes("@")) return setProblem("A valid email is required.");
    if (!firstName.trim() || !lastName.trim()) return setProblem("First and last name are required.");
    if (committeeChoice === "__new" && !newCommittee.trim()) {
      return setProblem("Name the new committee.");
    }

    const holder: StructureHolder = {
      email: email.trim(),
      firstName: firstName.trim(),
      middleName: middleName.trim() || undefined,
      lastName: lastName.trim(),
      suffix: suffix.trim() || undefined,
      nickname: nickname.trim() || undefined,
      fullName:
        [firstName, middleName, lastName, suffix]
          .map((part) => part.trim())
          .filter(Boolean)
          .join(" ") || undefined,
      termNote: termNote.trim() || undefined,
      ...(photo ? { photo, hasPhoto: true } : {}),
    };

    const position: StructurePosition = {
      key: nextKey("pos"),
      title: title.trim(),
      tier: Math.max(0, Math.min(12, tier)),
      order: 0,
      parentKey: parentKey || null,
      maxHolders: 1,
      holder,
      holders: [holder],
    };

    onAdd(committeeChoice, position, committeeChoice === "__new" ? newCommittee.trim() : undefined);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4">
      <div className="max-h-[90dvh] w-full max-w-lg overflow-auto rounded-2xl border border-line bg-paper p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[1rem] leading-snug text-ink-deep">Add an officer</h3>
            <p className="mt-0.5 text-[0.75rem] text-muted">
              The seat is placed now; drag it anywhere afterwards.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-[0.75rem] text-muted hover:text-ink">
            Close
          </button>
        </div>

        <div className="mt-4 grid gap-3">
          <label className="block">
            <span className="text-[0.6875rem] font-medium text-ink-soft">Position title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="President"
              className="mt-1 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[0.8125rem]"
            />
          </label>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="text-[0.6875rem] font-medium text-ink-soft">Committee</span>
              <select
                value={committeeChoice}
                onChange={(e) => setCommitteeChoice(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[0.8125rem]"
              >
                {doc.committees.map((c) => (
                  <option key={c.key} value={c.name}>
                    {c.name}
                  </option>
                ))}
                <option value="__new">New committee…</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[0.6875rem] font-medium text-ink-soft">Tier</span>
              <input
                type="number"
                min={0}
                max={12}
                value={tier}
                onChange={(e) => setTier(Number(e.target.value) || 0)}
                className="mt-1 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[0.8125rem]"
              />
            </label>
          </div>

          {committeeChoice === "__new" ? (
            <input
              value={newCommittee}
              onChange={(e) => setNewCommittee(e.target.value)}
              placeholder="New committee name"
              className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[0.8125rem]"
            />
          ) : null}

          <label className="block">
            <span className="text-[0.6875rem] font-medium text-ink-soft">Reports to</span>
            <select
              value={parentKey}
              onChange={(e) => setParentKey(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[0.8125rem]"
            >
              <option value="">No parent</option>
              {doc.committees.flatMap((c) =>
                c.positions.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.title} — {c.name}
                  </option>
                )),
              )}
            </select>
          </label>

          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
              className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[0.8125rem]"
            />
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
              className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[0.8125rem]"
            />
            <input
              value={middleName}
              onChange={(e) => setMiddleName(e.target.value)}
              placeholder="Middle name"
              className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[0.8125rem]"
            />
            <input
              value={suffix}
              onChange={(e) => setSuffix(e.target.value)}
              placeholder="Suffix"
              className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[0.8125rem]"
            />
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Nickname"
              className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[0.8125rem]"
            />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              type="email"
              className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[0.8125rem]"
            />
          </div>

          <input
            value={termNote}
            onChange={(e) => setTermNote(e.target.value)}
            placeholder="Term note (optional)"
            className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[0.8125rem]"
          />

          <label className="block text-[0.6875rem] text-muted">
            Photo (optional)
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="mt-1 block w-full text-[0.6875rem] file:mr-2 file:rounded-full file:border file:border-line file:bg-paper file:px-2 file:py-1 file:text-[0.6875rem]"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (file.size > MAX_PHOTO_BYTES) {
                  setProblem("That photo is larger than the 512 KiB limit.");
                  return;
                }
                setProblem(null);
                setPhoto(await toBase64(file));
              }}
            />
          </label>
        </div>

        {problem ? <p className="mt-3 text-[0.8125rem] text-[#8c3126]">{problem}</p> : null}

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={submit}>
            Add officer
          </Button>
        </div>
      </div>
    </div>
  );
}
