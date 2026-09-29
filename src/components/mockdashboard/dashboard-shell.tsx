"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { Role } from "@/lib/mockdashboard/types";
import { TabBar, type Tab } from "./tab-bar";

const roles: Record<Role, { label: string; badge: string; tile: string; tone: "indigo" | "emerald" }> = {
  usg: {
    label: "USG",
    badge: "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200",
    tile: "bg-indigo-600",
    tone: "indigo",
  },
  lsg: {
    label: "LSG",
    badge: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
    tile: "bg-emerald-600",
    tone: "emerald",
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
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link href="/mockdashboard" className="flex items-center gap-2">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold text-white ${r.tile}`}
              >
                SG
              </span>
              <span className="text-sm font-semibold text-slate-900">SmartGov</span>
              <span className={`ml-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.badge}`}>
                {r.label}
              </span>
            </Link>
          </div>
          {right && <div className="flex items-center gap-3">{right}</div>}
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="mb-4">
          <h1 className="text-lg font-semibold text-slate-900">{heading}</h1>
        </div>
        <TabBar tabs={tabs} active={active} onTab={onTab} tone={r.tone} />
        <main className="mt-5">{children}</main>
      </div>
      <footer className="py-6 text-center text-xs text-slate-400">
        SmartGov demo · data is saved locally in this browser only
      </footer>
    </div>
  );
}