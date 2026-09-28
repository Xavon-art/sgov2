"use client";

import { useEffect, useRef, type ElementType, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  children: ReactNode;
  className?: string;
  /** seconds */
  delay?: number;
  variant?: "up" | "scale" | "left" | "right";
  as?: ElementType;
  once?: boolean;
};

/**
 * Stagger ceiling. Landing sections nest Reveal two deep -- a section wrapper
 * around a list of cards -- and delays add up along the chain rather than
 * replacing one another. Capping each hop keeps a nested pair inside a
 * quarter second no matter what a call site asks for, so the page reads as one
 * settle instead of a sequence of arrivals.
 */
const MAX_DELAY = 0.12;

export function Reveal({
  children,
  className,
  delay = 0,
  variant = "up",
  as: Tag = "div",
  once = true,
}: Props) {
  const ref = useRef<HTMLElement>(null);
  const stagger = Math.min(Math.max(delay, 0), MAX_DELAY);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.dataset.shown = "true";
      return;
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.dataset.shown = "true";
          if (once) io.disconnect();
        } else if (!once) {
          el.dataset.shown = "false";
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );

    io.observe(el);
    return () => io.disconnect();
  }, [once]);

  return (
    <Tag
      ref={ref}
      data-shown="false"
      style={{ transitionDelay: `${stagger}s` }}
      className={cn(
        "reveal",
        variant === "scale" && "reveal-scale",
        variant === "left" && "reveal-left",
        variant === "right" && "reveal-left",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
