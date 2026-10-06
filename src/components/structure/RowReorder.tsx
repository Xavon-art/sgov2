"use client";

/**
 * The grip on a reorderable row, plus the keyboard path beside it.
 *
 * The arrows are the accessible control and the grip is not: dragging cannot be
 * done from a keyboard, so giving the grip a role and an accessible name would
 * announce a control that does nothing when activated. It is therefore hidden
 * from assistive technology and keeps only a `title` for pointer users, and the
 * arrows carry the names -- "Move President up", not just "up" -- so the
 * announcement names the row that will move.
 *
 * `useReorder` is owned by the parent rather than by this component because the
 * drop target is the whole row, not the grip: a row is usually tall, and a
 * drop zone the size of an 8px handle is one nobody aims at.
 */

const gripClass =
  "flex size-8 shrink-0 cursor-grab items-center justify-center rounded-lg border border-line bg-paper text-muted transition-colors hover:border-ink/30 hover:text-ink active:cursor-grabbing";
const gripLockedClass = "flex size-8 shrink-0 items-center justify-center text-muted/40";
const arrowClass =
  "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-line bg-paper text-muted transition-colors hover:border-ink/30 hover:text-ink disabled:cursor-not-allowed disabled:opacity-30";

export function RowReorder({
  label,
  movable,
  canMoveUp,
  canMoveDown,
  onDragStart,
  onDragEnd,
  onNudge,
}: {
  /** Names the row in the arrows' accessible names and the grip's tooltip. */
  label: string;
  movable: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd: () => void;
  onNudge: (delta: number) => void;
}) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      <span
        className={movable ? gripClass : gripLockedClass}
        draggable={movable}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        aria-hidden="true"
        title={movable ? `Drag to reorder ${label}` : `${label} stays first`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" className="h-4 w-4" aria-hidden="true">
          <path d="M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01" />
        </svg>
      </span>

      <div className="flex flex-col">
        <button
          type="button"
          className={arrowClass}
          disabled={!canMoveUp}
          onClick={() => onNudge(-1)}
          aria-label={`Move ${label} up`}
          title={`Move ${label} up`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M6 14.5 12 8.5l6 6" />
          </svg>
        </button>
        <button
          type="button"
          className={arrowClass}
          disabled={!canMoveDown}
          onClick={() => onNudge(1)}
          aria-label={`Move ${label} down`}
          title={`Move ${label} down`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M6 9.5 12 15.5l6-6" />
          </svg>
        </button>
      </div>
    </div>
  );
}