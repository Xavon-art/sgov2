"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "@/components/ui/Seal";
import { SignOutButton } from "@/components/dashboard/SignOutButton";
import { Enter } from "@/components/fx/Presence";
import {
  IconDashboard,
  IconClose,
  IconLock,
  IconMenu,
  IconPyramid,
  IconSubmission,
  IconUser,
} from "@/components/ui/Icons";
import { cn } from "@/lib/utils";

export type NavIcon = "dashboard" | "pyramid" | "user" | "lock" | "submission";

const NAV_ICONS: Record<NavIcon, typeof IconDashboard> = {
  dashboard: IconDashboard,
  pyramid: IconPyramid,
  user: IconUser,
  lock: IconLock,
  submission: IconSubmission,
};

export type NavItem = {
  id: string;
  label: string;
  hint: string;
  /**
   * A route, not an `#id` anchor.
   *
   * Sections used to be anchors into one long page, which meant the whole
   * document shipped every section whether or not the reader scrolled to it, and
   * `active` had to be passed in from the server because only the server knew
   * which section was on screen. Real routes fix both: each section is its own
   * entry in the build, and `AppShell` can work out `active` from the pathname
   * by itself rather than being told.
   *
   * Kept as `<Link>` rather than `<a>` deliberately -- it is what gets the
   * prefetch. An anchor costs nothing to click; a route costs a server render
   * unless something has already fetched it.
   */
  href: string;
  // A key, not a component: this prop crosses from the server component that
  // builds `nav` into this client component, and functions cannot cross that
  // boundary -- passing the component threw "Functions cannot be passed directly
  // to Client Components" and crashed the whole dashboard. The icon is resolved
  // here instead.
  icon: NavIcon;
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
 * a plain menu toggle so it works without a focus-trap library. Nav items are
 * routes under `/dashboard`, so switching sections is a client transition rather
 * than a jump inside one long document.
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
  const pathname = usePathname();

  // Read from the URL rather than passed in. The server can know which section a
  // page is, but making it responsible for that meant every nav change was a
  // round trip to find out something the client already has, and it made the
  // highlight flicker through `active={false}` on anything that was not a
  // hardcoded link.
  const active = nav.find((n) => n.href === pathname) ?? nav[0];

  // Escape to dismiss, plus a scroll lock while it is up.
  //
  // Both belong to the drawer rather than to the animation, but neither is
  // optional once it animates: a slide-over that closes only by hitting the dim
  // area is not a dialog, it is a decoration. And without the lock the page
  // behind scrolls under the panel on touch, which reads as the drawer being
  // broken rather than as the page being scrollable.
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);

    // Padding compensates for the scrollbar that `overflow: hidden` removes,
    // otherwise the whole page jumps sideways as the drawer opens.
    const gap = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = document.body.style.overflow;
    const prevPad = document.body.style.paddingRight;
    document.body.style.overflow = "hidden";
    if (gap > 0) document.body.style.paddingRight = `${gap}px`;

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPad;
    };
  }, [open]);

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
            const selected = item.href === pathname;
            return (
              <Link
                key={item.id}
                href={item.href}
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
                    "h-[1.1rem] w-[1.1rem] shrink-0 transition-transform duration-200 ease-out",
                    selected
                      ? "text-brass"
                      : "text-brass-deep/80 group-hover:translate-x-0.5 group-hover:text-brass-deep",
                  )}
                  strokeWidth={1.7}
                />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-line/70 p-3">
          <SignOutButton />
        </div>
      </aside>

      {/* Mobile slide-over.

          Two separate <Enter> surfaces rather than one wrapper containing both.
          A single wrapper would have to unmount on a timer while its children
          were running their own timers, and whichever lost the race would take
          the other down with it mid-slide. Letting each own its own presence
          also means the dim area can be gone a beat before the panel finishes
          travelling, which is how a layered surface actually behaves.

          The panel carries the dialog role rather than a wrapper around both,
          so `aria-modal` describes the thing the user is actually meant to be
          inside. */}

      <Enter
        open={open}
        as="button"
        type="button"
        aria-label="Close menu"
        onClick={() => setOpen(false)}
        duration={300}
        className="fade-in fixed inset-0 z-40 cursor-pointer bg-ink/30 backdrop-blur-sm lg:hidden"
        style={{ "--presence-exit-transform": "translate3d(0, 0, 0)" } as CSSProperties}
      />

      <Enter
        open={open}
        duration={300}
        role="dialog"
        aria-modal="true"
        aria-label="Workspace menu"
        className="drawer-in fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-line bg-canvas shadow-2xl lg:hidden"
        style={{ "--presence-exit-transform": "translate3d(-100%, 0, 0)" } as CSSProperties}
      >
        <div className="flex h-16 items-center justify-between border-b border-line/70 px-5">
          <Link href="/" aria-label="SmartGov home" onClick={() => setOpen(false)}>
            <Wordmark compact />
          </Link>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="pressable grid size-10 cursor-pointer place-items-center rounded-full text-ink-soft hover:bg-ink/[0.05] hover:text-ink"
          >
            <IconClose className="h-5 w-5" strokeWidth={1.7} />
          </button>
        </div>

        <nav aria-label="Workspace" className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
          {nav.map((item) => {
            const Icon = NAV_ICONS[item.icon];
            const selected = item.href === pathname;
            return (
              <Link
                key={item.id}
                href={item.href}
                aria-current={selected ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={cn(
                  // `group` was missing here. The icon below asks for
                  // group-hover:translate-x-0.5, and without the parent class
                  // that selector matches nothing at all -- the nudge was
                  // silently dead on mobile, which is the only place this
                  // drawer exists.
                  "group flex min-h-12 items-center gap-3 rounded-xl px-3 py-2.5 text-[0.9375rem] font-medium transition-colors duration-300",
                  selected
                    ? "bg-ink text-white"
                    : "text-ink-soft hover:bg-ink/[0.05] hover:text-ink",
                )}
              >
                <Icon
                  className={cn(
                    "h-5 w-5 shrink-0 transition-transform duration-200 ease-out",
                    selected
                      ? "text-brass"
                      : "text-brass-deep/80 group-hover:translate-x-0.5",
                  )}
                  strokeWidth={1.7}
                />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-line/70 p-3">
          <SignOutButton />
        </div>
      </Enter>

      {/* Content column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-line/80 bg-canvas/80 backdrop-blur-xl">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
            <button
              type="button"
              aria-label="Open menu"
              onClick={() => setOpen(true)}
              className="pressable grid size-10 cursor-pointer place-items-center rounded-full text-ink-soft hover:bg-ink/[0.05] hover:text-ink lg:hidden"
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