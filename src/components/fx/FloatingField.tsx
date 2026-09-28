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
    let running = false;

    const start = () => {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(loop);
    };

    const onMove = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2;
      pointer.current.y = (e.clientY / Math.max(window.innerHeight, 1) - 0.5) * 2;
      start();
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const io = new IntersectionObserver(
      ([entry]) => {
        visible.current = entry.isIntersecting;
        if (visible.current) start();
      },
      { threshold: 0 },
    );
    io.observe(root);

    /*
     * Motion this small cannot be seen, and past it the eased transform stops
     * changing at the two decimals the chips are written with. Scaled by the
     * widest offset a chip can take, so a chip parked here sits within 0.05px
     * of where the pointer left it.
     */
    const STILL = 0.05 / (range * 1.2);

    const loop = () => {
      raf = 0;
      running = false;
      if (document.hidden || !visible.current) return;

      const c = current.current;
      const gapX = pointer.current.x - c.x;
      const gapY = pointer.current.y - c.y;
      c.x += gapX * 0.055;
      c.y += gapY * 0.055;

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

      /*
       * Re-arm only while the eased offset is still travelling. The chips sit
       * above a live WebGL canvas and a stack of backdrop blurs, so a 60Hz loop
       * rewriting six identical transform strings keeps invalidating style for
       * the whole section long after the pointer has settled. `running` is
       * cleared above, which is what lets the next pointermove or intersection
       * change pick the field back up.
       */
      if (Math.abs(gapX) > STILL || Math.abs(gapY) > STILL) start();
    };

    // A tab restored from the background can leave the chips parked part-way
    // through an eased move, so resume rather than wait for the next pointer
    // event to correct them.
    const onVisibility = () => {
      if (!document.hidden) start();
    };
    document.addEventListener("visibilitychange", onVisibility);

    if (reduced) {
      for (const el of itemRefs.current) {
        if (el) el.style.transform = "translate3d(0,0,0)";
      }
    } else {
      start();
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
      running = false;
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVisibility);
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
