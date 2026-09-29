"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { Wordmark } from "@/components/ui/Seal";
import type { Role } from "@/lib/mockdashboard/types";
import { TabBar, type Tab } from "./tab-bar";

const roles: Record<Role, { label: string; tag: string; dot: string }> = {
  usg: {
    label: "University Student Government",
    tag: "border border-line bg-paper/70 text-ink",
    dot: "bg-brass",
  },
  lsg: {
    label: "Local Student Council",
    tag: "bg-brass-soft/45 text-brass-deep",
    dot: "bg-brass-deep",
  },
};

export function DashboardShell({
  role,
  tabs,
  active,
  onTab,
  right,
  heading,
  children,
}: {
  role: Role;
  tabs: Tab[];
  active: string;
  onTab: (id: string) => void;
  right?: ReactNode;
  heading: string;
  children: ReactNode;
}) {
  const r = roles[role];
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="min-h-screen bg-canvas">
      <header
        className={`sticky top-0 z-40 transition-[background-color,border-color,box-shadow,backdrop-filter] duration-500 ${
          scrolled
            ? "border-b border-line/80 bg-canvas/85 shadow-[0_1px_24px_-18px_rgba(13,33,53,0.4)] backdrop-blur-xl backdrop-saturate-150"
            : "border-b border-transparent bg-canvas"
        }`}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link
              href="/mockdashboard"
              className="rounded-lg opacity-100 transition-opacity duration-300 hover:opacity-80"
              aria-label="SmartGov demo home"
            >
              <Wordmark compact />
            </Link>
            <span
              className={`ml-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] ${r.tag}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${r.dot}`} />
              {r.label}
            </span>
          </div>
          {right && <div className="flex items-center gap-3">{right}</div>}
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 pt-8 pb-16 sm:px-6">
        <p className="eyebrow">SmartGov demo</p>
        <h1 className="mt-1.5 text-2xl font-medium tracking-[-0.02em] text-ink-deep sm:text-[1.75rem]">
          {heading}
        </h1>

        <div className="mt-6">
          <TabBar tabs={tabs} active={active} onTab={onTab} />
        </div>

        <motion.main
          key={active}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="mt-6"
        >
          {children}
        </motion.main>
      </div>

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="rule mb-6 opacity-60" aria-hidden />
      </div>
      <footer className="pb-8 text-center text-[0.75rem] text-ink-muted">
        SmartGov demo · data is saved locally in this browser only
      </footer>
    </div>
  );
}