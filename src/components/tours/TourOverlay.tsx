"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { PageTour, TourPlacement } from "@/lib/tours";

type Box = { top: number; left: number; width: number; height: number };
type Size = { width: number; height: number };
type Layout = { style: CSSProperties; placement: TourPlacement };

type TourOverlayProps = {
  tour: PageTour;
  stepIndex: number;
  onNext: () => void;
  onBack: () => void;
  onStop: () => void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function findTarget(token: string): Element | null {
  const escaped =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(token)
      : token.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
  return document.querySelector(`[data-tour="${escaped}"]`);
}

function isVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden"
  );
}

function needsCardReserve(element: Element, viewport: Size): boolean {
  if (viewport.width < 768) return true;
  return element.getBoundingClientRect().height > viewport.height * 0.55;
}

function measureTarget(element: Element, viewport: Size, reserveBottom = 0): Box {
  const rect = element.getBoundingClientRect();
  const pad = 8;
  const usableBottom = Math.max(80, viewport.height - reserveBottom - 4);
  const left = clamp(rect.left - pad, 4, viewport.width - 4);
  const top = clamp(rect.top - pad, 4, usableBottom - 8);
  const right = clamp(rect.right + pad, left + 8, viewport.width - 4);
  const bottom = clamp(rect.bottom + pad, top + 8, usableBottom);
  return { left, top, width: right - left, height: bottom - top };
}

function cardLayout(
  box: Box,
  requested: TourPlacement,
  card: Size,
  viewport: Size,
): Layout {
  if (viewport.width < 768) {
    return {
      placement: "bottom",
      style: {
        left: 12,
        right: 12,
        bottom: 12,
        top: undefined,
        maxHeight: "48vh",
        overflowY: "auto",
      },
    };
  }

  const margin = 14;
  const gap = 18;
  const width = card.width || Math.min(384, viewport.width - 32);
  const height = card.height || 210;
  const fits: Record<TourPlacement, boolean> = {
    bottom: box.top + box.height + gap + height <= viewport.height - margin,
    top: box.top - gap - height >= margin,
    right: box.left + box.width + gap + width <= viewport.width - margin,
    left: box.left - gap - width >= margin,
  };
  const order: TourPlacement[] = ["bottom", "top", "right", "left"];
  const placement = fits[requested]
    ? requested
    : order.find((candidate) => fits[candidate]) ?? "bottom";

  const centerX = box.left + box.width / 2;
  const centerY = box.top + box.height / 2;
  let top = box.top + box.height + gap;
  let left = centerX - width / 2;

  if (placement === "top") {
    top = box.top - gap - height;
    left = centerX - width / 2;
  } else if (placement === "right") {
    top = centerY - height / 2;
    left = box.left + box.width + gap;
  } else if (placement === "left") {
    top = centerY - height / 2;
    left = box.left - gap - width;
  }

  return {
    placement,
    style: {
      top: clamp(top, margin, viewport.height - height - margin),
      left: clamp(left, margin, viewport.width - width - margin),
    },
  };
}

function arrowStyle(placement: TourPlacement): CSSProperties {
  if (placement === "top") return { bottom: -7, left: "50%", marginLeft: -7 };
  if (placement === "left") return { right: -7, top: "50%", marginTop: -7 };
  if (placement === "right") return { left: -7, top: "50%", marginTop: -7 };
  return { top: -7, left: "50%", marginLeft: -7 };
}

export function TourOverlay({ tour, stepIndex, onNext, onBack, onStop }: TourOverlayProps) {
  const step = tour.steps[stepIndex];
  const cardRef = useRef<HTMLDivElement | null>(null);
  const cardSizeRef = useRef<Size>({ width: 384, height: 210 });
  const [viewport, setViewport] = useState<Size>(() => ({
    width: typeof window === "undefined" ? 1440 : window.innerWidth,
    height: typeof window === "undefined" ? 900 : window.innerHeight,
  }));
  const [box, setBox] = useState<Box | null>(null);
  const [card, setCard] = useState<Size>({ width: 384, height: 210 });
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const update = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  useEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        cardSizeRef.current = { width: rect.width, height: rect.height };
        setCard({ width: rect.width, height: rect.height });
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [box, stepIndex, step.title]);

  useEffect(() => {
    let frame = 0;
    let poll = 0;
    let attached: Element | null = null;
    let cleanupTarget: (() => void) | null = null;
    let cancelled = false;

    const centerFallback = () => {
      setMissing(true);
      setBox({
        top: Math.max(12, viewport.height / 2 - 60),
        left: Math.max(12, viewport.width / 2 - 90),
        width: 180,
        height: 120,
      });
    };

    const attach = () => {
      const target = findTarget(step.target);
      if (!target) return false;
      const element = isVisible(target)
        ? target
        : Array.from(target.querySelectorAll("*")).find((child) => isVisible(child));
      if (!element) return false;

      attached = element;
      setMissing(false);
      const reserveBottom = needsCardReserve(element, viewport)
        ? Math.min(Math.round(viewport.height * 0.52), Math.max(cardSizeRef.current.height + 24, 220))
        : 0;
      const measure = () => setBox(measureTarget(element, viewport, reserveBottom));
      measure();
      frame = window.requestAnimationFrame(measure);
      element.scrollIntoView({ behavior: "instant", block: "center", inline: "center" });
      window.addEventListener("scroll", measure, true);
      window.addEventListener("resize", measure);
      window.addEventListener("orientationchange", measure);
      cleanupTarget = () => {
        window.cancelAnimationFrame(frame);
        window.removeEventListener("scroll", measure, true);
        window.removeEventListener("resize", measure);
        window.removeEventListener("orientationchange", measure);
      };
      return true;
    };

    if (!attach()) {
      centerFallback();
      poll = window.setInterval(() => {
        if (cancelled || attached) return;
        if (attach()) window.clearInterval(poll);
      }, 100);
    }

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      cleanupTarget?.();
    };
  }, [step.target, stepIndex, viewport]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusTimer = window.setTimeout(() => {
      cardRef.current?.querySelector<HTMLElement>("button")?.focus();
    }, 0);

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onStop();
        return;
      }
      if (event.key === "ArrowRight" || (event.key === "Enter" && !(event.target as HTMLElement)?.closest("button"))) {
        event.preventDefault();
        onNext();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onBack();
        return;
      }
      if (event.key !== "Tab") return;
      const buttons = Array.from(cardRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []).filter(
        (button) => !button.disabled,
      );
      if (buttons.length === 0) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKey, true);
      previous?.focus();
    };
  }, [onNext, onBack, onStop]);

  const handleTargetClick = useCallback(() => {
    if (step.advanceOnClick) onNext();
  }, [step.advanceOnClick, onNext]);

  if (!box) return null;
  const layout = cardLayout(box, step.placement ?? "bottom", card, viewport);
  const last = stepIndex === tour.steps.length - 1;
  const scrims: CSSProperties[] = [
    { top: 0, left: 0, width: viewport.width, height: Math.max(0, box.top) },
    { top: box.top, left: 0, width: Math.max(0, box.left), height: box.height },
    {
      top: box.top,
      left: box.left + box.width,
      width: Math.max(0, viewport.width - box.left - box.width),
      height: box.height,
    },
    {
      top: box.top + box.height,
      left: 0,
      width: viewport.width,
      height: Math.max(0, viewport.height - box.top - box.height),
    },
  ];

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[90]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      aria-describedby="tour-body"
      data-tour-target={step.target}
    >
      {scrims.map((style, index) => (
        <div key={index} className="tour-scrim pointer-events-auto fixed bg-ink/65" style={style} />
      ))}
      <div
        className="tour-spotlight pointer-events-none fixed rounded-[1.25rem] border-2 border-brass shadow-[0_0_0_1px_rgba(255,255,255,0.55)_inset]"
        style={box}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={step.advanceOnClick ? "Continue the tour" : "Tour spotlight"}
        className="pointer-events-auto fixed cursor-default rounded-[1.25rem] bg-transparent"
        style={{ ...box, zIndex: 92 }}
        onClick={handleTargetClick}
      />
      <div
        ref={cardRef}
        className="tour-card pointer-events-auto fixed z-[93] w-[min(24rem,calc(100vw-1.5rem))] rounded-2xl border border-line-strong bg-paper p-5 text-left shadow-float"
        style={layout.style}
      >
        <div
          aria-hidden="true"
          className="tour-card-arrow absolute size-3 rotate-45 border border-line-strong bg-paper"
          style={arrowStyle(layout.placement)}
        />
        <div className="relative flex items-start gap-3">
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-brass-soft text-[0.75rem] font-semibold text-brass-deep">
            ?
          </span>
          <div className="min-w-0 flex-1">
            <p id="tour-title" className="text-[1.0625rem] font-semibold leading-tight text-ink">
              {step.title}
            </p>
            <p id="tour-body" aria-live="polite" className="mt-2 text-[0.875rem] leading-relaxed text-body">
              {missing ? "We couldn't find this item on the page, so we've highlighted where it would be." : step.body}
            </p>
          </div>
        </div>
        <div className="relative mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <span className="text-[0.75rem] font-medium tabular-nums text-muted">
            Step {stepIndex + 1} of {tour.steps.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              disabled={stepIndex === 0}
              className="pressable rounded-full px-3 py-2 text-[0.8125rem] font-medium text-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              Back
            </button>
            <button
              type="button"
              onClick={onStop}
              className="pressable rounded-full px-3 py-2 text-[0.8125rem] font-medium text-muted transition-colors hover:text-ink"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={onNext}
              className="pressable rounded-full bg-ink px-4 py-2 text-[0.8125rem] font-semibold text-paper transition-colors hover:bg-ink-deep"
            >
              {last ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default TourOverlay;
