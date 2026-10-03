"use client";

import { useEffect, useState, type ComponentProps, type ElementType, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Kept in step with the `.presence` transition duration in globals.css. */
const EXIT_MS = 240;

type EnterProps = {
  open: boolean;
  children: ReactNode;
  className?: string;
  as?: ElementType;
} & Omit<ComponentProps<"div">, "className" | "children">;

/**
 * Holds a node on screen while it animates out, then removes it.
 *
 * CSS can animate an element into place on its own -- the `rise-in` family in
 * globals.css all key off mount. It cannot animate the *end* of one, because
 * unmounting is the absence of a node and there is nothing left to transition.
 * So a confirmation that slid in nicely and then vanished on the next render is
 * the usual outcome, and it is worse than having no animation at all: the
 * arrival sets an expectation of continuity that the departure then breaks.
 *
 * Only the departure costs anything here. Entering stays a mount-time keyframe
 * with no JavaScript involved, and `leaving` is not state at all -- it is just
 * `!open`, which means it can never disagree with the prop that caused it.
 *
 * Only mount this where something is genuinely arriving and leaving on its own.
 * A row in a list that can be reordered should animate from its key instead;
 * holding a reordering list on a timer is how tables end up flickering.
 *
 * Props pass straight through to the rendered element, and `as` changes what
 * that element is. The reason to care: a banner here is a `<p role="alert">`,
 * and wrapping that in a `<div>` to animate it would put a block element inside
 * a paragraph and break the document outline for anyone reading it as one. It
 * renders as the paragraph itself instead.
 */
export function Enter({
  open,
  children,
  className,
  as: Tag = "div",
  ...rest
}: EnterProps) {
  const [shown, setShown] = useState(open);

  // Re-opening before the exit finished. Adjusted during render rather than in
  // an effect on purpose: the node has to come back in this same pass, and
  // setting it from an effect would spend a render showing nothing in between.
  // This is React's documented "adjust state when a prop changes" form.
  if (open && !shown) {
    setShown(true);
  }

  useEffect(() => {
    if (open) return;

    // The only setState in here is inside the timer callback, which is the
    // case an effect is actually for. Nothing is set synchronously.
    const id = window.setTimeout(() => setShown(false), EXIT_MS);
    return () => window.clearTimeout(id);
  }, [open, shown]);

  if (!shown) return null;

  return (
    <Tag
      {...rest}
      // Hidden from assistive tech the moment it starts leaving, so a
      // confirmation is not still being described while it slides away.
      aria-hidden={!open || undefined}
      data-leaving={!open || undefined}
      className={cn("presence", className)}
    >
      {children}
    </Tag>
  );
}