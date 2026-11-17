"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Wordmark } from "@/components/ui/Seal";
import { SignOutButton } from "@/components/dashboard/SignOutButton";
import { Enter } from "@/components/fx/Presence";
import {
  IconBudget,
  IconClock,
  IconCompass,
  IconDashboard,
  IconClose,
  IconEvents,
  IconLayers,
  IconLock,
  IconMenu,
  IconMonitoring,
  IconPyramid,
  IconSubmission,
  IconUser,
} from "@/components/ui/Icons";
import { cn } from "@/lib/utils";

export type NavIcon =
  | "dashboard"
  | "pyramid"
  | "user"
  | "lock"
  | "submission"
  | "clock"
  | "events"
  | "budget"
  | "layers"
  | "compass"
  | "monitoring";

export const NAV_ICONS: Record<NavIcon, typeof IconDashboard> = {
  dashboard: IconDashboard,
  pyramid: IconPyramid,
  user: IconUser,
  lock: IconLock,
  submission: IconSubmission,
  // Added for the /usg and /lsg split. The two navs are separate modules, so each
  // side only ever names the icons it actually draws -- there is no shared list
  // with USG entries an LSG could render.
  clock: IconClock,
  events: IconEvents,
  budget: IconBudget,
  layers: IconLayers,
  compass: IconCompass,
  // Added for the federated remodel: the bar-chart glyph reads as "survey
  // results" better than any of the document icons above.
  monitoring: IconMonitoring,
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
  /**
   * The floors inside a section. Manage and Request are each one job with
   * several rooms, so they carry their own sub-nav instead of inflating the
   * top level to eight entries. A child is a real route (optionally with a
   * `?tab=` query) so the browser's back button keeps working.
   */
  children?: Array<{ label: string; href: string }>;
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
function childIsActive(href: string, pathname: string, tab: string | null): boolean {
  const [childPath, childQuery] = href.split("?");
  if (pathname !== childPath) return false;
  const childTab = childQuery ? new URLSearchParams(childQuery).get("tab") : null;
  return childTab ? childTab === tab : !tab;
}

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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentTab = searchParams.get("tab");

  const [unread, setUnread] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState<{ id: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string }[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/notifications/unread");
        const data = await res.json();
        if (alive && res.ok && data.ok) setUnread(data.count ?? 0);
      } catch {
        // ignore
      }
    };
    void load();
    const id = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  async function openNotifs() {
    setNotifOpen((v) => !v);
    if (!notifOpen) {
      try {
        const res = await fetch("/api/notifications?limit=20");
        const data = await res.json();
        if (res.ok && data.ok) setNotifs(data.notifications ?? []);
      } catch {
        // ignore
      }
    }
  }

  async function markRead(id: string) {
    try {
      await fetch(`/api/notifications/${id}/read`, { method: "POST" });
      setNotifs((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
      setUnread((u) => Math.max(0, u - 1));
    } catch {
      // ignore
    }
  }

  // Whether the drawer owns the screen, including while it slides back out.
  //
  // The header's sign-out has to yield to the drawer's, and gating on `open`
  // alone does not work: `open` flips false the instant the user dismisses,
  // which is the instant the exit animation *starts*, so the header copy would
  // reappear behind a panel that is still travelling and there would be two
  // on screen for the full 300ms.
  //
  // On a phone in portrait this never shows up -- the header copy is `sm:block`
  // and a phone is under `sm` -- but rotate one and the header appears while the
  // drawer is up, and the scrim is only `bg-ink/30`, so both stayed readable
  // through it. Holding until the panel has actually left is what makes the
  // handover real rather than approximately true.
  //
  // 300 matches the `duration={300}` on both `Enter` surfaces below.
  //
  // The two transitions are handled differently on purpose. Showing it is a
  // pure function of `open`, so it happens during render and costs no frame --
  // letting it wait for an effect would paint the header copy for one frame with
  // the drawer already up. Hiding it is the one that genuinely needs to wait for
  // an external system (the animation), so that half lives in the effect, where
  // the cleanup clears the timer if the drawer is reopened mid-exit.
  const [drawerPresent, setDrawerPresent] = useState(false);
  if (open && !drawerPresent) setDrawerPresent(true);
  useEffect(() => {
    if (open) return;
    const id = setTimeout(() => setDrawerPresent(false), 300);
    return () => clearTimeout(id);
  }, [open]);

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
            const inSection =
              pathname === item.href ||
              pathname.startsWith(`${item.href}/`) ||
              Boolean(item.children?.some((child) => childIsActive(child.href, pathname, currentTab)));
            return (
              <div key={item.id} className="flex flex-col">
                <Link
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
                {item.children && inSection ? (
                  <div className="ml-5 flex flex-col gap-0.5 border-l border-line/70 pl-2.5 pt-0.5">
                    {item.children.map((child) => {
                      const childSelected = childIsActive(child.href, pathname, currentTab);
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={cn(
                            "rounded-lg px-2.5 py-1.5 text-[0.8125rem] transition-colors",
                            childSelected
                              ? "bg-ink/[0.06] font-semibold text-ink"
                              : "text-muted hover:bg-ink/[0.04] hover:text-ink",
                          )}
                        >
                          {child.label}
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </div>
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
            const inSection =
              pathname === item.href ||
              pathname.startsWith(`${item.href}/`) ||
              Boolean(item.children?.some((child) => childIsActive(child.href, pathname, currentTab)));
            return (
              <div key={item.id} className="flex flex-col">
                <Link
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
                {item.children && inSection ? (
                  <div className="ml-7 flex flex-col gap-0.5 border-l border-line/70 pl-3 pb-1">
                    {item.children.map((child) => {
                      const childSelected = childIsActive(child.href, pathname, currentTab);
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          onClick={() => setOpen(false)}
                          className={cn(
                            "rounded-lg px-2.5 py-1.5 text-[0.875rem] transition-colors",
                            childSelected
                              ? "bg-ink/[0.06] font-semibold text-ink"
                              : "text-muted hover:bg-ink/[0.04] hover:text-ink",
                          )}
                        >
                          {child.label}
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </div>
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
              <div className="relative">
                <button
                  type="button"
                  aria-label="Notifications"
                  onClick={() => void openNotifs()}
                  className="pressable grid size-9 place-items-center rounded-full text-ink-soft hover:bg-ink/[0.05] hover:text-ink"
                >
                  <span className="text-[1.1rem]">🔔</span>
                  {unread > 0 ? (
                    <span className="absolute -right-0.5 -top-0.5 grid min-w-[1.1rem] place-items-center rounded-full bg-brass px-1 text-[0.625rem] font-bold text-ink">
                      {unread > 9 ? "9+" : unread}
                    </span>
                  ) : null}
                </button>
                {notifOpen ? (
                  <div className="absolute right-0 top-11 z-50 w-80 max-h-96 overflow-y-auto rounded-2xl border border-line bg-paper shadow-lift">
                    <div className="flex items-center justify-between border-b border-line px-4 py-2">
                      <p className="text-[0.8125rem] font-semibold text-ink">Notifications</p>
                      <button
                        type="button"
                        onClick={async () => {
                          await fetch("/api/notifications/read-all", { method: "POST" });
                          setNotifs((prev) => prev.map((n) => ({ ...n, readAt: new Date().toISOString() })));
                          setUnread(0);
                        }}
                        className="text-[0.75rem] text-muted hover:text-ink"
                      >
                        Mark all read
                      </button>
                    </div>
                    {notifs.length === 0 ? (
                      <p className="px-4 py-6 text-[0.8125rem] text-muted">No notifications yet.</p>
                    ) : (
                      <ul className="flex flex-col">
                        {notifs.map((n) => (
                          <li key={n.id}>
                            <button
                              type="button"
                              onClick={() => {
                                void markRead(n.id);
                                if (n.link) {
                                  if (n.link.startsWith("/")) router.push(n.link);
                                  else window.location.href = n.link;
                                }
                              }}
                              className={`w-full px-4 py-3 text-left transition-colors hover:bg-canvas ${
                                n.readAt ? "opacity-60" : ""
                              }`}
                            >
                              <p className="text-[0.875rem] font-medium text-ink-deep">{n.title}</p>
                              {n.body ? <p className="mt-0.5 text-[0.75rem] text-body">{n.body}</p> : null}
                              <p className="mt-1 text-[0.625rem] text-muted">{new Date(n.createdAt).toLocaleString()}</p>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </div>
              {badge ? (
                <span className="hidden max-w-56 truncate rounded-full border border-brass/45 bg-brass-soft/35 px-3 py-1 text-[0.625rem] font-semibold tracking-[0.12em] text-ink uppercase sm:inline-flex">
                  {badge}
                </span>
              ) : null}
              <p className="hidden truncate text-[0.8125rem] font-medium text-ink sm:block">
                {orgName}
              </p>
              {/* This is a range, not a floor, and that is the whole fix.

                  The desktop rail is `hidden lg:flex`, so below `lg` this header
                  is the only way to sign out on a tablet and it has to show from
                  `sm`. At `lg` the rail appears carrying its own, and rendering
                  this one as well put two "Sign out" on one screen -- one pinned
                  bottom-left, one top-right. Same action, two places to look, so
                  the pair read as two different controls.

                  `lg:hidden` is what retires it there. Each breakpoint now has
                  exactly one: drawer under `sm`, header from `sm` to `lg`, rail
                  from `lg` up.

                  The `drawerPresent` term is the other half. This range keeps
                  the control from colliding with the *rail*; it does nothing
                  about the *drawer*, which is a separate surface with its own
                  copy that only appears below `lg`. Rotated phone or tablet:
                  the drawer is open, the header still has one, and at
                  `bg-ink/30` the scrim is not dark enough to hide the pair. */}
              {drawerPresent ? null : (
                <div className="hidden sm:block lg:hidden">
                  <SignOutButton />
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[82rem] flex-1 px-4 py-8 sm:px-6 sm:py-10">{children}</main>
      </div>
    </div>
  );
}