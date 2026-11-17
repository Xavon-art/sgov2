"use client";

import { useTours } from "./tour-context";

type TourHelpButtonProps = {
  className?: string;
  compact?: boolean;
  slot?: boolean;
};

export function TourHelpButton({ className, compact = false, slot = false }: TourHelpButtonProps) {
  const { start } = useTours();

  return (
    <span
      data-tour-help-slot={slot ? "" : undefined}
      className={["inline-flex", className].filter(Boolean).join(" ")}
    >
      <button
        type="button"
        aria-label="Take a tour of this page"
        data-tour="help-button"
        onClick={() => start()}
        className={[
          "pressable inline-flex items-center justify-center gap-2 rounded-full border border-line-strong bg-paper text-ink transition-colors hover:border-brass hover:bg-brass-soft/30",
          compact ? "size-11 text-[1rem] font-semibold" : "px-3 py-2 text-[0.8125rem] font-medium",
        ].join(" ")}
      >
        <span aria-hidden="true" className="grid size-5 place-items-center rounded-full border border-current text-[0.6875rem] leading-none">
          ?
        </span>
        {compact ? null : <span>Help</span>}
      </button>
    </span>
  );
}

export default TourHelpButton;
