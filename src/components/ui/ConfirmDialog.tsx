"use client";

import {
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Enter } from "@/components/fx/Presence";
import { Button } from "@/components/ui/Button";

/** Short enough to feel like a response, long enough to read the title. */
const DIALOG_MS = 200;

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * False while rendering on the server, true from the first client commit on.
 *
 * A portal needs a real `document`. The obvious `useState` + `useEffect` guard
 * is flagged by react-hooks/set-state-in-effect and is worse anyway: it burns a
 * render pass showing nothing, and it cannot be reasoned about during the
 * hydration render. This is React's own answer to "did I hydrate" -- the server
 * snapshot is false, the client snapshot is true, and React re-renders once
 * after hydration rather than warning about a mismatch.
 */
const noopSubscribe = () => () => {};
const isClient = () => true;
const isServer = () => false;

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * While the action is in flight the dialog stops accepting dismissal. Without
   * this, Escape mid-request tears the dialog down while the write is still
   * running, and the user lands on a page that has no idea the action landed.
   */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Modal confirmation for an action that leaves the page.
 *
 * Nothing in the codebase needed one until sign-out, and there is no Radix or
 * shadcn dialog to reach for -- the component set here is bespoke, so this is
 * the primitive that later destructive actions (deleting a unit, cancelling an
 * invitation) should reuse rather than each inventing its own overlay.
 *
 * Two details it does that a naive overlay does not:
 *
 * It is portalled to `document.body`. `position: fixed` is resolved against the
 * nearest transformed ancestor, and this dashboard animates: `.pressable`
 * scales a button on `transform`, and the drawer panel translates. Rendered in
 * place, a dialog triggered from the sidebar would be positioned relative to
 * that button instead of the viewport and would drift off-screen. The portal
 * sidesteps the whole containing-block question.
 *
 * It manages focus, which is what actually makes it a dialog rather than a
 * picture of one. Focus moves into the panel on open, Tab is trapped inside it,
 * and the trigger gets focus back on close. Without that last one, dismissing a
 * dialog drops focus onto `document.body` and a keyboard user has to tab from
 * the top of the page to find where they were -- the failure the mobile drawer
 * in AppShell still has.
 *
 * The panel itself is focused rather than a button inside it. Focusing "Cancel"
 * by default would be defensible, but focusing the container reads the title
 * and description out on open, which is what someone who opened this to find
 * out what it says actually wants.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const mounted = useSyncExternalStore(noopSubscribe, isClient, isServer);

  // Focus in on open, back to the trigger on close. Captured rather than passed
  // in as a ref so a caller cannot forget: by the time this runs the trigger is
  // still `document.activeElement`, so there is nothing to wire up.
  useEffect(() => {
    if (!open) return;

    restoreRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    return () => {
      restoreRef.current?.focus?.();
      restoreRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!busy) onCancel();
        return;
      }

      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;

      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        event.preventDefault();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      // Focus sitting on the panel is the entry state, so Shift+Tab from there
      // has to wrap to the end -- otherwise it escapes out the top.
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  // Same lock, and for the same reason, as the drawer: a dialog with the page
  // still scrolling behind it reads as broken rather than as modal.
  useEffect(() => {
    if (!open) return;

    const gap = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = document.body.style.overflow;
    const prevPad = document.body.style.paddingRight;

    document.body.style.overflow = "hidden";
    if (gap > 0) document.body.style.paddingRight = `${gap}px`;

    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPad;
    };
  }, [open]);

  if (!mounted) return null;

  return createPortal(
    <Enter open={open} duration={DIALOG_MS} className="fade-in fixed inset-0 z-50">
      <div
        // `target === currentTarget` so the empty space around the panel
        // dismisses, but a press that started inside the panel and drifted out
        // does not. mousedown rather than click for the same reason: a drag that
        // ends over the backdrop was never a dismissal.
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) onCancel();
        }}
        className="absolute inset-0 flex items-center justify-center bg-ink/45 p-6 backdrop-blur-[2px]"
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          tabIndex={-1}
          className="pop-in w-full max-w-md rounded-2xl border border-line bg-paper p-6 shadow-lift outline-none"
        >
          <h2 id={titleId} className="text-[1.125rem] leading-tight font-semibold text-ink">
            {title}
          </h2>
          <div id={descriptionId} className="mt-2 text-[0.9375rem] leading-relaxed text-body">
            {description}
          </div>

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" size="md" onClick={onCancel} disabled={busy}>
              {cancelLabel}
            </Button>
            <Button variant="primary" size="md" onClick={onConfirm} disabled={busy}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </Enter>,
    document.body,
  );
}