"use client";

import { useState } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/ui/Seal";
import { SignOutButton } from "@/components/dashboard/SignOutButton";
import {
  IconDashboard,
  IconClose,
  IconLock,
  IconMenu,
  IconPyramid,
  IconUser,
} from "@/components/ui/Icons";
import { cn } from "@/lib/utils";

export type NavIcon = "dashboard" | "pyramid" | "user" | "lock";

const NAV_ICONS: Record<NavIcon, typeof IconDashboard> = {
  dashboard: IconDashboard,
  pyramid: IconPyramid,
  user: IconUser,
  lock: IconLock,
};

export type NavItem = {
  id: string;
  label: string;
  hint: string;
  // A key, not a component: this prop crosses from the server component that
  // builds `nav` into this client component, and functions cannot cross that
  // boundary -- passing the component threw "Functions cannot be passed directly
  // to Client Components" and crashed the whole dashboard. The icon is resolved
  // here instead.
  icon: NavIcon;
  active?: boolean;
};

/**
 * App shell for the workspace.
 *
 * Layout structure lifted from a Next.js-native shadcn-admin dashboard template
 * (sidebar + top bar + scrollable content), but every surface is SmartGov's own
 * ink/brass/ivory tokens and the bespoke component set — no shadcn or Radix
 * primitives were brought in, so the charter visual language is the only one on
 * screen.
 *
 * The sidebar is fixed on desktop and becomes a slide-over on mobile, driven by
 * a plain menu toggle so it works without a focus-trap library. Links are
 * same-page anchors against `#id` sections so navigation never reloads the
 * server-gated data.
 */
export function AppShell({
  nav,
  orgName,
  badge,
  children,
}: {
  nav: NavItem[];
  orgName: string;
  badge?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const active = nav.find((n) => n.active) ?? nav[0];

  return (
    <div className="relative isolate flex min-h-dvh">
      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line/80 bg-canvas/85 backdrop-blur-xl lg:flex">
        <div className="flex h-16 items-center gap-3 border-b border-line/70 px-5">
          <Link href="/" aria-label="SmartGov home" className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brass focus-visible:ring-offset-2">
            <Wordmark compact />
          </Link>
        </div>

        <nav aria-label="Workspace" className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
          {nav.map((item) => {
            const Icon = NAV_ICONS[item.icon];
            const selected = item.active;
            return (
              <a
                key={item.id}
                href={`#${item.id}`}
                aria-current={selected ? "page" : undefined}
                className={cn(
                  "group flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-[0.875rem] font-medium transition-colors duration-300",
                  selected
                    ? "bg-ink text-white shadow-[0_1px_0_rgba(255,255,255,0.12)_inset]"
                    : "text-ink-soft hover:bg-ink/[0.05] hover:text-ink",
                )}
              >
                <Icon
                  className={cn(
                    "h-[1.1rem] w-[1.1rem] shrink-0",
                    selected ? "text-brass" : "text-brass-deep/80 group-hover:text-brass-deep",
                  )}
                  strokeWidth={1.7}
                />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </a>
            );
          })}
        </nav>

        <div className="border-t border-line/70 p-3">
          <SignOutButton />
        </div>
      </aside>

      {/* Mobile slide-over */}
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Workspace menu">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 cursor-pointer bg-ink/30 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col border-r border-line bg-canvas shadow-2xl">
            <div className="flex h-16 items-center justify-between border-b border-line/70 px-5">
              <Link href="/" aria-label="SmartGov home" onClick={() => setOpen(false)}>
                <Wordmark compact />
              </Link>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="grid size-10 cursor-pointer place-items-center rounded-full text-ink-soft transition-colors hover:bg-ink/[0.05] hover:text-ink"
              >
                <IconClose className="h-5 w-5" strokeWidth={1.7} />
              </button>
            </div>

            <nav aria-label="Workspace" className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
              {nav.map((item) => {
                const Icon = NAV_ICONS[item.icon];
                const selected = item.active;
                return (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    aria-current={selected ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex min-h-12 items-center gap-3 rounded-xl px-3 py-2.5 text-[0.9375rem] font-medium transition-colors duration-300",
                      selected
                        ? "bg-ink text-white"
                        : "text-ink-soft hover:bg-ink/[0.05] hover:text-ink",
                    )}
                  >
                    <Icon
                      className={cn("h-5 w-5 shrink-0", selected ? "text-brass" : "text-brass-deep/80")}
                      strokeWidth={1.7}
                    />
                    {item.label}
                  </a>
                );
              })}
            </nav>

            <div className="border-t border-line/70 p-3">
              <SignOutButton />
            </div>
          </div>
        </div>
      ) : null}

      {/* Content column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-line/80 bg-canvas/80 backdrop-blur-xl">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
            <button
              type="button"
              aria-label="Open menu"
              onClick={() => setOpen(true)}
              className="grid size-10 cursor-pointer place-items-center rounded-full text-ink-soft transition-colors hover:bg-ink/[0.05] hover:text-ink lg:hidden"
            >
              <IconMenu className="h-5 w-5" strokeWidth={1.7} />
            </button>

            <div className="hidden min-w-0 items-center gap-3 lg:flex">
              <IconDashboard
                className="h-4 w-4 shrink-0 text-brass-deep"
                strokeWidth={1.8}
                aria-hidden
              />
              <p className="truncate text-[0.8125rem] font-medium text-ink-soft">
                {active.label} · <span className="text-muted">{active.hint}</span>
              </p>
            </div>

            <div className="ml-auto flex min-w-0 items-center gap-2.5">
              {badge ? (
                <span className="hidden max-w-56 truncate rounded-full border border-brass/45 bg-brass-soft/35 px-3 py-1 text-[0.625rem] font-semibold tracking-[0.12em] text-ink uppercase sm:inline-flex">
                  {badge}
                </span>
              ) : null}
              <p className="hidden truncate text-[0.8125rem] font-medium text-ink sm:block">
                {orgName}
              </p>
              <div className="hidden sm:block">
                <SignOutButton />
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[82rem] flex-1 px-4 py-8 sm:px-6 sm:py-10">{children}</main>
      </div>
    </div>
  );
}