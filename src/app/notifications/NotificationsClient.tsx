"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Seal } from "@/components/ui/Seal";
import { Button } from "@/components/ui/Button";
import type { NotificationItem } from "@/lib/notifications";
import { useRealtimeSignals } from "@/lib/realtime";

export function NotificationsClient({
  accountId,
  accountName,
  initialNotifications,
  initialUnreadCount,
}: {
  accountId: string;
  accountName: string;
  initialNotifications: NotificationItem[];
  initialUnreadCount: number;
}) {
  const router = useRouter();
  const [notifs, setNotifs] = useState<NotificationItem[]>(initialNotifications);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  // Data arrives in the server render, so there is no first-paint fetch to wait for.
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=10");
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error("load");
      setNotifs(data.notifications ?? []);
      setUnreadCount(data.unreadCount ?? 0);
      setError(null);
    } catch {
      setError("We could not reach the server. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, []);

  useRealtimeSignals(accountId, ["notification"], () => void load());

  async function markRead(id: string, link?: string | null) {
    const target = notifs.find((n) => n.id === id);
    setNotifs((prev) => prev.filter((n) => n.id !== id));
    if (target && !target.readAt) setUnreadCount((count) => Math.max(0, count - 1));
    try {
      await fetch(`/api/notifications/${id}/read`, { method: "POST" });
    } catch {
      // ignore
    }
    if (link) {
      if (link.startsWith("/")) router.push(link);
      else window.open(link, "_blank", "noopener,noreferrer");
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/notifications/${id}/delete`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error("delete");
      setNotifs((prev) => prev.filter((n) => n.id !== id));
    } catch {
      setError("Could not delete that notification. Please try again.");
    }
  }

  async function markAll() {
    const ids = notifs.filter((n) => !n.readAt).map((n) => n.id);
    setNotifs((prev) => prev.map((n) => ({ ...n, readAt: new Date().toISOString() })));
    setUnreadCount(0);
    try {
      await fetch("/api/notifications/read-all", { method: "POST" });
    } catch {
      await load();
    }
    if (ids.length === 0) return;
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-5 py-8 sm:px-8">
      <div data-tour="notifications-header" className="flex items-center gap-3">
        <Seal size={36} />
        <div>
          <h1 className="text-xl font-semibold text-ink-deep">Notifications</h1>
          <p className="text-[0.8125rem] text-muted">
            {accountName} · {unreadCount} unread
          </p>
        </div>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => router.push("/dashboard")}>
          Back
        </Button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow">Latest ten</p>
        <button type="button" onClick={() => void markAll()} className="text-[0.75rem] text-muted hover:text-ink">
          Mark all read
        </button>
      </div>
      <p className="-mt-4 text-[0.75rem] text-muted">
        Only the ten newest are kept. Older signals are removed automatically.
      </p>
      {error ? <p className="text-[0.875rem] text-[#a5442c]">{error}</p> : null}

      {loading ? (
        <p className="text-[0.9375rem] text-muted">Loading…</p>
      ) : notifs.length === 0 ? (
        <div className="rounded-2xl border border-line bg-paper/70 p-8 text-center">
          <p className="text-[0.9375rem] text-muted">No notifications yet.</p>
          <Link href="/dashboard" className="mt-3 inline-block text-[0.8125rem] font-semibold text-ink underline">
            Go to dashboard
          </Link>
        </div>
      ) : (
        <ul data-tour="notifications-list" className="flex flex-col gap-2">
          {notifs.map((n) => (
            <li
              key={n.id}
              className={`flex items-start gap-2 rounded-2xl border p-4 ${
                n.readAt ? "border-line bg-paper/60" : "border-brass/45 bg-brass-soft/25"
              }`}
            >
              <button
                type="button"
                onClick={() => void markRead(n.id, n.link)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex items-center gap-2">
                  {!n.readAt ? <span aria-label="Unread" className="size-2 shrink-0 rounded-full bg-brass" /> : null}
                  <p className="text-[0.9375rem] font-semibold text-ink-deep">{n.title}</p>
                  <span className="ml-auto shrink-0 text-[0.625rem] text-muted">
                    {new Date(n.createdAt).toLocaleString()}
                  </span>
                </div>
                {n.body ? <p className="mt-1 text-[0.8125rem] text-body">{n.body}</p> : null}
                {n.readAt ? <p className="mt-1 text-[0.625rem] text-muted">Read</p> : null}
              </button>
              <button
                type="button"
                data-tour="notifications-delete"
                aria-label="Delete notification"
                onClick={() => void remove(n.id)}
                className="shrink-0 rounded-full px-2 py-1 text-[0.75rem] text-muted hover:bg-[#a5442c]/[0.06] hover:text-[#a5442c]"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
