"use client";

import { useEffect, type ReactNode } from "react";
import { motion } from "motion/react";

export function Modal({
  open,
  onClose,
  title,
  children,
  width = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18 }}
        className="absolute inset-0 bg-ink-deep/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        className={`relative w-full ${width} max-h-[85vh] overflow-hidden rounded-2xl border border-line bg-paper shadow-lift`}
      >
        <header className="flex items-center justify-between border-b border-line/70 px-5 py-4">
          <h3 className="text-[0.9375rem] font-medium tracking-tight text-ink-deep">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full text-muted transition-colors hover:bg-ink/[0.045] hover:text-ink"
          >
            ✕
          </button>
        </header>
        <div className="thin-scroll max-h-[70vh] overflow-y-auto p-5">{children}</div>
      </motion.div>
    </div>
  );
}