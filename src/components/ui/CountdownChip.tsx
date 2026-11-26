"use client";

import { cn } from "@/lib/utils";
import { countdownText, countdownTone } from "@/lib/deadlines";

type CountdownChipProps = {
  dueAt: string | null | undefined;
  gracePeriodMinutes?: number | null;
  autoClose?: boolean;
  closed?: boolean;
  className?: string;
};

const toneClass: Record<ReturnType<typeof countdownTone>, string> = {
  none: "border-line bg-canvas/50 text-muted",
  normal: "border-line bg-paper text-ink-soft",
  soon: "border-[#d8c18f] bg-[#d8c18f]/10 text-[#7d6428]",
  overdue: "border-[#a5442c] bg-[#a5442c]/[0.12] text-[#a5442c] font-semibold",
};

export function CountdownChip({
  dueAt,
  gracePeriodMinutes,
  autoClose,
  closed,
  className,
}: CountdownChipProps) {
  const grace = gracePeriodMinutes ?? 0;
  const tone = countdownTone(dueAt, grace, closed);
  return (
    <span
      title={autoClose && !closed ? "This task locks after its grace period." : undefined}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs",
        toneClass[tone],
        className,
      )}
    >
      {countdownText(dueAt, grace, closed)}
    </span>
  );
}
