"use client";

import { cn } from "@/lib/utils";

type SwapTextProps = {
  /** Label while idle. */
  idle: React.ReactNode;
  /** Label while the request is in flight. */
  pending: React.ReactNode;
  isPending: boolean;
  className?: string;
};

/**
 * Crossfades a control between two labels instead of swapping the text outright.
 *
 * A submit button that reads "Add campus" and then instantly reads "Adding..."
 * reports the state change, but it reports it as a hard cut -- and the button
 * is also at its least useful moment, because the control you are watching has
 * just done nothing visible. Crossfading the two strings makes the control look
 * like it is the thing that changed, which is the part that actually reads as
 * responsive.
 *
 * The two labels occupy the same grid cell rather than replacing one another,
 * so the container is always as wide as the wider of the two and the button
 * never changes size mid-request. The alternative -- swapping the string --
 * makes the button twitch a few pixels every time it is pressed, which is the
 * single most obvious way to make a form feel cheap.
 *
 * The spinner is always mounted, hidden by opacity rather than removed, so its
 * width is already reserved by the time the request starts. Rendering it
 * conditionally would reintroduce the same resize one cell later.
 */
export function SwapText({ idle, pending, isPending, className }: SwapTextProps) {
  return (
    <span className={cn("relative inline-grid justify-items-center", className)}>
      <span
        aria-hidden={isPending || undefined}
        className="col-start-1 row-start-1 transition-opacity duration-200 ease-out"
        style={{ opacity: isPending ? 0 : 1 }}
      >
        {idle}
      </span>
      <span
        aria-hidden={!isPending || undefined}
        className="col-start-1 row-start-1 flex items-center gap-2 transition-opacity duration-200 ease-out"
        style={{ opacity: isPending ? 1 : 0 }}
      >
        <span
          className="spin-ring transition-opacity duration-200 ease-out"
          style={{ opacity: isPending ? 1 : 0 }}
        />
        {pending}
      </span>
    </span>
  );
}