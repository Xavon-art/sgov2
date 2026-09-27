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

export function Reveal({
  children,
  className,
  delay = 0,
  variant = "up",
  as: Tag = "div",
  once = true,
}: Props) {
  const ref = useRef<HTMLElement>(null);

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
      style={{ transitionDelay: `${delay}s` }}
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
