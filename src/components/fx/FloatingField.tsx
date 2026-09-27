"use client";

import {
  useEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

export type FloatingChip = {
  id: string;
  label: string;
  sub?: string;
  icon?: ReactNode;
  /** percentage offsets within the container */
  left: number;
  top: number;
  /** parallax depth multiplier */
  depth?: number;
  drift?: "soft" | "wide" | "none";
  duration?: number;
  delay?: number;
  scale?: number;
  tone?: "paper" | "ink" | "brass";
  delayIn?: number;
};

type Props = {
  chips: FloatingChip[];
  className?: string;
  /** how far a chip travels at full pointer deflection, in px */
  range?: number;
  hideBelow?: "sm" | "md" | "lg";
};

export function FloatingField({
  chips,
  className,
  range = 26,
  hideBelow = "sm",
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const pointer = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });
  const visible = useRef(true);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const fine = window.matchMedia("(pointer: fine)").matches;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches;

    if (!fine) return;

    let raf = 0;

    const onMove = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2;
      pointer.current.y = (e.clientY / Math.max(window.innerHeight, 1) - 0.5) * 2;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const io = new IntersectionObserver(
      ([entry]) => {
        visible.current = entry.isIntersecting;
      },
      { threshold: 0 },
    );
    io.observe(root);

    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!visible.current || document.hidden) return;
      const c = current.current;
      c.x += (pointer.current.x - c.x) * 0.055;
      c.y += (pointer.current.y - c.y) * 0.055;

      for (let i = 0; i < itemRefs.current.length; i++) {
        const el = itemRefs.current[i];
        if (!el) continue;
        const depth = chips[i]?.depth ?? 0.6;
        const dx = c.x * range * depth;
        const dy = c.y * range * 0.72 * depth;
        el.style.transform = `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(
          2,
        )}px, 0)`;
      }
    };

    if (reduced) {
      for (const el of itemRefs.current) {
        if (el) el.style.transform = "translate3d(0,0,0)";
      }
    } else {
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
    };
  }, [chips, range]);

  const hideClass =
    hideBelow === "sm"
      ? "hidden sm:block"
      : hideBelow === "md"
        ? "hidden md:block"
        : "hidden lg:block";

  return (
    <div
      ref={rootRef}
      aria-hidden
      className={cn("pointer-events-none absolute inset-0", className)}
    >
      {chips.map((chip, i) => {
        const drift = chip.drift ?? "soft";
        return (
          <div
            key={chip.id}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            className={cn("absolute", hideClass)}
            style={{
              left: `${chip.left}%`,
              top: `${chip.top}%`,
              opacity: 0,
              animation: `sg-float-in 0.9s cubic-bezier(0.22,1,0.36,1) ${(
                chip.delayIn ?? 0.6 + i * 0.14
              ).toFixed(2)}s forwards`,
              willChange: "transform",
            }}
          >
            <div
              className={cn(
                drift === "soft" && "animate-drift",
                drift === "wide" && "animate-drift-wide",
              )}
              style={
                {
                  "--drift-duration": `${chip.duration ?? 11 + i * 1.7}s`,
                  "--drift-delay": `${chip.delay ?? i * -1.9}s`,
                  transform: `scale(${chip.scale ?? 1})`,
                } as CSSProperties
              }
            >
              <ChipShell tone={chip.tone ?? "paper"}>
                {chip.icon ? (
                  <span className="grid size-6 place-items-center rounded-full bg-ink/[0.06] text-ink [&>svg]:h-3.5 [&>svg]:w-3.5">
                    {chip.icon}
                  </span>
                ) : null}
                <span className="flex flex-col leading-tight">
                  <span className="text-[0.6875rem] font-semibold tracking-[-0.005em] whitespace-nowrap text-ink-deep">
                    {chip.label}
                  </span>
                  {chip.sub ? (
                    <span className="text-[0.5625rem] font-medium tracking-wide whitespace-nowrap text-muted">
                      {chip.sub}
                    </span>
                  ) : null}
                </span>
              </ChipShell>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ChipShell({
  children,
  tone = "paper",
}: {
  children: ReactNode;
  tone?: "paper" | "ink" | "brass";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border py-1.5 pr-3.5 pl-1.5 shadow-float backdrop-blur-md",
        tone === "paper" &&
          "border-line-strong/70 bg-paper/85 text-ink-deep",
        tone === "ink" && "border-ink/15 bg-ink text-white",
        tone === "brass" &&
          "border-brass/40 bg-brass-soft/70 text-ink-deep [&>span]:text-ink",
      )}
    >
      {children}
    </span>
  );
}
