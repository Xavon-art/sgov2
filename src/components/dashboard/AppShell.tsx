"use client";

import { Suspense, useCallback, useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Seal, Wordmark } from "@/components/ui/Seal";
import { TourHelpButton } from "@/components/tours/HelpButton";
import { loadTourProgress, saveTourProgress } from "@/lib/tours/progress";
import { SignOutButton } from "@/components/dashboard/SignOutButton";
import { useAccount } from "@/components/dashboard/dashboard-context";
import type { NotificationItem } from "@/lib/notifications";
import { useRealtimeSignals } from "@/lib/realtime";
import { Enter } from "@/components/fx/Presence";
import {
  IconArrowLeft,
  IconArrowRight,
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

function WorkspaceUserCard({
  accountName,
  roleLabel,
  compact = false,
}: {
  accountName: string;
  roleLabel: string;
  compact?: boolean;
}) {
  const initial = accountName.trim().charAt(0).toUpperCase() || "W";
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", compact && "justify-center")}>
      <span className="grid size-9 shrink-0 place-items-center rounded-full border border-brass/45 bg-brass-soft/35 text-[0.8125rem] font-semibold text-ink">
        {initial}
      </span>
      {!compact ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[0.8125rem] font-medium text-ink-deep">{accountName}</span>
          <span className="truncate text-[0.6875rem] text-muted">{roleLabel}</span>
        </span>
      ) : null}
    </div>
  );
}

function AppShellInner({
  nav,
  orgName,
  badge,
  accountName = "Workspace account",
  roleLabel = "Workspace member",
  initialUnreadCount = 0,
  initialNotifications = [],
  children,
}: {
  nav: NavItem[];
  orgName: string;
  badge?: string;
  accountName?: string;
  roleLabel?: string;
  initialUnreadCount?: number;
  initialNotifications?: NotificationItem[];
  children: React.ReactNode;
}) {
  const account = useAccount();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  // Manual expand/collapse per section. When a key is absent the section follows
  // the URL (its child is active), so deep links still open with their children
  // visible. Once clicked, the user's choice wins until they click again.
  const [sectionOpen, setSectionOpen] = useState<Record<string, boolean>>({});
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentTab = searchParams.get("tab");

  const pathSegments = pathname.split("/").filter(Boolean);
  const workspaceIndex = pathSegments.findIndex((segment) => segment === "usg" || segment === "lsg");
  const sideLabel = workspaceIndex >= 0 ? pathSegments[workspaceIndex].toUpperCase() : "Workspace";
  const hasDeeperSegment = workspaceIndex >= 0 && pathSegments.length > workspaceIndex + 1;
  const parentHref =
    workspaceIndex >= 0
      ? `/${pathSegments[workspaceIndex]}${pathSegments.length > workspaceIndex + 2 ? `/${pathSegments.slice(workspaceIndex + 1, -1).join("/")}` : ""}`
      : "/dashboard";

  useEffect(() => {
    let alive = true;
    void Promise.resolve(loadTourProgress())
      .then((progress) => {
        if (alive && progress?.sidebarCollapsed) setCollapsed(true);
      })
      .catch(() => {
        if (alive) setCollapsed(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function persistCollapsed(next: boolean) {
    let saved = false;
    try {
      saved = (await saveTourProgress({ sidebarCollapsed: next })) === true;
    } catch {
      saved = false;
    }
    if (saved) return;
    try {
      const progress = await loadTourProgress();
      await saveTourProgress({ ...progress, sidebarCollapsed: next });
    } catch {
      return;
    }
  }

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    void persistCollapsed(next);
  }

  const [unread, setUnread] = useState(initialUnreadCount);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState<NotificationItem[]>(initialNotifications);
  const [notifError, setNotifError] = useState<string | null>(null);

  const loadUnread = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications/unread");
      const data = await res.json();
      if (res.ok && data.ok) setUnread(data.count ?? 0);
    } catch {
      // ignore
    }
  }, []);

  const loadNotificationList = useCallback(async () => {
    try {
      // The drawer is a preview: only the three newest matter here. The full
      // list lives on /notifications.
      const res = await fetch("/api/notifications?limit=3");
      const data = await res.json();
      if (res.ok && data.ok) setNotifs(data.notifications ?? []);
    } catch {
      // ignore
    }
  }, []);

  useRealtimeSignals(account.id, ["notification"], () => {
    void loadUnread();
    if (notifOpen) void loadNotificationList();
  });

  useEffect(() => {
    // The first count and preview list are server-rendered; polling only keeps
    // them fresh for tabs that stay open.
    const id = setInterval(() => void loadUnread(), 30000);
    return () => clearInterval(id);
  }, [loadUnread]);

  async function openNotifs() {
    setNotifOpen((v) => !v);
    if (!notifOpen) await loadNotificationList();
  }

  async function markRead(id: string) {
    const target = notifs.find((n) => n.id === id);
    try {
      const res = await fetch(`/api/notifications/${id}/read`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) return;
      // Once the target has been opened, the preview has done its job.
      setNotifs((prev) => prev.filter((n) => n.id !== id));
      if (target && !target.readAt) setUnread((u) => Math.max(0, u - 1));
    } catch {
      // ignore
    }
  }

  async function deleteNotification(id: string) {
    const target = notifs.find((n) => n.id === id);
    setNotifError(null);
    try {
      const res = await fetch(`/api/notifications/${id}/delete`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error("delete");
      setNotifs((prev) => prev.filter((n) => n.id !== id));
      if (target && !target.readAt) setUnread((u) => Math.max(0, u - 1));
    } catch {
      setNotifError("Could not delete that notification. Please try again.");
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

  /**
   * A section title is an expander as well as a link. First click opens its
   * children; clicking the same title again closes them. The drawer stays open
   * while expanding so the child that just appeared can actually be tapped.
   */
  function toggleSection(item: NavItem, inSection: boolean) {
    if (!item.children?.length) return false;
    const wasOpen = sectionOpen[item.id] ?? inSection;
    setSectionOpen((prev) => ({ ...prev, [item.id]: !wasOpen }));
    return true;
  }

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
      <aside
        data-tour="workspace-rail"
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line/80 bg-canvas/85 backdrop-blur-xl lg:flex",
          collapsed ? "w-[4.75rem]" : "w-64",
        )}
      >
        <div className={cn("flex h-16 items-center border-b border-line/70", collapsed ? "justify-center px-2" : "px-5")}>
          <Link
            href="/"
            aria-label="SmartGov home"
            className="flex min-w-0 items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brass focus-visible:ring-offset-2"
          >
            {collapsed ? <Seal size={26} /> : <Wordmark compact />}
          </Link>
        </div>

        <nav aria-label="Workspace" data-tour="workspace-nav" className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
          <button
            type="button"
            data-tour="workspace-collapse"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={toggleCollapsed}
            className={cn(
              "pressable flex min-h-11 items-center rounded-xl text-[0.8125rem] font-medium text-ink-soft transition-colors duration-300 hover:bg-ink/[0.05] hover:text-ink",
              collapsed ? "justify-center px-0" : "gap-3 px-3",
            )}
          >
            {collapsed ? (
              <IconArrowRight className="h-[1.1rem] w-[1.1rem] shrink-0 text-brass-deep" strokeWidth={1.7} aria-hidden />
            ) : (
              <IconArrowLeft className="h-[1.1rem] w-[1.1rem] shrink-0 text-brass-deep" strokeWidth={1.7} aria-hidden />
            )}
            {!collapsed ? <span className="min-w-0 flex-1 truncate text-left">Collapse sidebar</span> : null}
          </button>

          {nav.map((item) => {
            const Icon = NAV_ICONS[item.icon];
            const selected = item.href === pathname;
            const inSection =
              pathname === item.href ||
              pathname.startsWith(`${item.href}/`) ||
              Boolean(item.children?.some((child) => childIsActive(child.href, pathname, currentTab)));
            const expanded = item.children?.length ? (sectionOpen[item.id] ?? inSection) : false;
            return (
              <div key={item.id} className="flex flex-col">
                <Link
                  href={item.href}
                  title={item.label}
                  aria-label={item.label}
                  aria-current={selected ? "page" : undefined}
                  aria-expanded={item.children?.length ? expanded : undefined}
                  onClick={(event) => {
                    if (toggleSection(item, inSection)) {
                      event.preventDefault();
                      router.push(item.href);
                    }
                  }}
                  className={cn(
                    "group flex min-h-11 items-center rounded-xl py-2.5 text-[0.875rem] font-medium transition-colors duration-300",
                    collapsed ? "justify-center px-0" : "gap-3 px-3",
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
                  {!collapsed ? <span className="min-w-0 flex-1 truncate">{item.label}</span> : null}
                </Link>
                {!collapsed && item.children && expanded ? (
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

        <div className="flex flex-col gap-2 border-t border-line/70 p-3">
          <WorkspaceUserCard accountName={accountName} roleLabel={roleLabel} compact={collapsed} />
          <div
            className={cn(
              "min-w-0",
              collapsed && "[&>button]:h-11 [&>button]:w-11 [&>button]:justify-start [&>button]:overflow-hidden [&>button]:pl-3.5 [&>button]:pr-0",
            )}
          >
            <SignOutButton />
          </div>
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
            const expanded = item.children?.length ? (sectionOpen[item.id] ?? inSection) : false;
            return (
              <div key={item.id} className="flex flex-col">
                <Link
                  href={item.href}
                  aria-current={selected ? "page" : undefined}
                  aria-expanded={item.children?.length ? expanded : undefined}
                  onClick={(event) => {
                    if (toggleSection(item, inSection)) {
                      event.preventDefault();
                      router.push(item.href);
                      // Keep the drawer open so the newly revealed children
                      // are actually tappable.
                      return;
                    }
                    setOpen(false);
                  }}
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
                {item.children && expanded ? (
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

        <div className="flex flex-col gap-2 border-t border-line/70 p-3">
          <WorkspaceUserCard accountName={accountName} roleLabel={roleLabel} />
          <SignOutButton />
        </div>
      </Enter>

      {/* Content column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header data-tour="workspace-topbar" className="sticky top-0 z-20 border-b border-line/80 bg-canvas/80 backdrop-blur-xl">
          <div className="flex h-16 items-center gap-2 px-3 sm:gap-3 sm:px-6">
            <button
              type="button"
              aria-label="Open menu"
              onClick={() => setOpen(true)}
              className="pressable grid size-10 shrink-0 cursor-pointer place-items-center rounded-full text-ink-soft hover:bg-ink/[0.05] hover:text-ink lg:hidden"
            >
              <IconMenu className="h-5 w-5" strokeWidth={1.7} />
            </button>

            {hasDeeperSegment ? (
              <button
                type="button"
                data-tour="workspace-back"
                aria-label="Back"
                title="Back"
                onClick={() => router.push(parentHref)}
                className="pressable grid size-9 shrink-0 place-items-center rounded-full text-ink-soft hover:bg-ink/[0.05] hover:text-ink"
              >
                <IconArrowLeft className="h-5 w-5" strokeWidth={1.7} />
              </button>
            ) : null}

            <div data-tour="workspace-breadcrumbs" className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              <span className="hidden min-w-0 max-w-40 truncate text-[0.8125rem] text-muted sm:inline">
                {sideLabel} · {orgName}
              </span>
              <span aria-hidden className="hidden shrink-0 text-muted sm:inline">
                /
              </span>
              <span className="min-w-0 truncate text-[0.8125rem] font-medium text-ink-deep">{active.label}</span>
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-2.5">
              <span data-tour-help-slot data-tour="workspace-help" className="inline-flex size-9 shrink-0 items-center justify-center">
                <TourHelpButton compact slot />
              </span>
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
                  <div className="absolute right-0 top-11 z-50 max-h-96 w-72 overflow-y-auto rounded-2xl border border-line bg-paper shadow-lift sm:w-80">
                    <div className="flex items-center justify-between border-b border-line px-4 py-2">
                      <p className="text-[0.8125rem] font-semibold text-ink">Notifications</p>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const res = await fetch("/api/notifications/read-all", { method: "POST" });
                            const data = await res.json();
                            if (!res.ok || !data.ok) return;
                            setNotifs([]);
                            setUnread(0);
                          } catch {
                            // ignore
                          }
                        }}
                        className="text-[0.75rem] text-muted hover:text-ink"
                      >
                        Mark all read
                      </button>
                    </div>
                    {notifError ? (
                      <p className="border-b border-line px-4 py-2 text-[0.75rem] text-[#a5442c]">{notifError}</p>
                    ) : null}
                    {notifs.length === 0 ? (
                      <p className="px-4 py-6 text-[0.8125rem] text-muted">No notifications yet.</p>
                    ) : (
                      <>
                        <ul className="flex flex-col divide-y divide-line">
                          {notifs.map((n) => (
                            <li key={n.id} className={n.readAt ? "bg-paper" : "bg-brass-soft/20"}>
                              <div className="flex items-start gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    void markRead(n.id);
                                    setNotifOpen(false);
                                    if (n.link) {
                                      const cMatch = n.link.match(/[?&]c=([^&]+)/);
                                      const mMatch = n.link.match(/[?&]m=([^&]+)/);
                                      if (cMatch) {
                                        const conversationId = decodeURIComponent(cMatch[1]);
                                        const messageId = mMatch ? decodeURIComponent(mMatch[1]) : null;
                                        window.dispatchEvent(
                                          new CustomEvent("smartgov:open-conversation", {
                                            detail: { conversationId, messageId },
                                          }),
                                        );
                                      }
                                      if (n.link.startsWith("/")) router.push(n.link);
                                      else window.open(n.link, "_blank", "noopener,noreferrer");
                                    }
                                  }}
                                  className={`min-w-0 flex-1 px-4 py-3 text-left transition-colors hover:bg-canvas ${
                                    n.readAt ? "opacity-70" : ""
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    {!n.readAt ? (
                                      <span aria-label="Unread" className="size-1.5 shrink-0 rounded-full bg-brass" />
                                    ) : null}
                                    <p className="text-[0.875rem] font-medium text-ink-deep">{n.title}</p>
                                  </div>
                                  {n.body ? <p className="mt-0.5 text-[0.75rem] text-body">{n.body}</p> : null}
                                  <p className="mt-1 text-[0.625rem] text-muted">{new Date(n.createdAt).toLocaleString()}</p>
                                </button>
                                <button
                                  type="button"
                                  aria-label="Delete notification"
                                  onClick={() => void deleteNotification(n.id)}
                                  className="mr-3 mt-3 shrink-0 rounded-full px-2 py-1 text-[0.625rem] text-muted hover:bg-[#a5442c]/[0.06] hover:text-[#a5442c]"
                                >
                                  ✕
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                        <Link
                          href="/notifications"
                          onClick={() => setNotifOpen(false)}
                          className="block border-t border-line px-4 py-2.5 text-center text-[0.75rem] font-semibold text-ink hover:bg-canvas"
                        >
                          See more
                        </Link>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
              {badge ? (
                <span className="hidden max-w-56 truncate rounded-full border border-brass/45 bg-brass-soft/35 px-3 py-1 text-[0.625rem] font-semibold tracking-[0.12em] text-ink uppercase sm:inline-flex">
                  {badge}
                </span>
              ) : null}
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

        <main
          data-tour="workspace-main"
          className="mx-auto w-full min-w-0 max-w-[82rem] flex-1 px-4 pb-24 pt-8 sm:px-6 sm:pt-10 md:pb-10"
        >
          {children}
        </main>
      </div>

      <nav
        aria-label="Mobile workspace navigation"
        className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-line/80 bg-canvas/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      >
        {nav.slice(0, 4).map((item) => {
          const Icon = NAV_ICONS[item.icon];
          const selected = item.href === pathname;
          return (
            <Link
              key={item.id}
              href={item.href}
              title={item.label}
              aria-label={item.label}
              aria-current={selected ? "page" : undefined}
              className={cn(
                "flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-[0.625rem] font-medium transition-colors",
                selected ? "text-ink" : "text-muted hover:text-ink",
              )}
            >
              <Icon
                className={cn("h-5 w-5 shrink-0", selected ? "text-brass" : "text-brass-deep/80")}
                strokeWidth={1.7}
                aria-hidden
              />
              <span className="w-full truncate text-center">{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          aria-label="More navigation"
          title="More navigation"
          onClick={() => setOpen(true)}
          className="flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-[0.625rem] font-medium text-muted transition-colors hover:text-ink"
        >
          <IconMenu className="h-5 w-5 shrink-0 text-brass-deep/80" strokeWidth={1.7} aria-hidden />
          <span className="w-full truncate text-center">More</span>
        </button>
      </nav>
    </div>
  );
}

export function AppShell(props: Parameters<typeof AppShellInner>[0]) {
  return (
    <Suspense fallback={<div className="min-h-dvh px-4 py-6 sm:px-8">{props.children}</div>}>
      <AppShellInner {...props} />
    </Suspense>
  );
}
