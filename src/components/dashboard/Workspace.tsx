"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { IconCheck, IconClock } from "@/components/ui/Icons";
import type { Account } from "@/lib/auth/session";
import type { InviteRow } from "@/app/api/invites/route";

const UNIT_TYPES = [
  { value: "lsg", label: "Local Student Government" },
  { value: "college", label: "College" },
  { value: "campus", label: "Campus" },
  { value: "council", label: "Council" },
];

const selectClass =
  "h-12 w-full appearance-none rounded-xl border border-line bg-paper/70 px-3.5 text-[0.9375rem] text-ink-deep outline-none transition-[border-color,box-shadow,background-color] duration-300 hover:border-line-strong focus:border-ink/25 focus:bg-paper";

function StatusBadge({ status }: { status: InviteRow["status"] }) {
  if (status === "activated") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-ink px-2.5 py-1 text-[0.6875rem] font-semibold tracking-[0.06em] text-canvas uppercase">
        <IconCheck className="h-3 w-3" strokeWidth={2.6} />
        Activated
      </span>
    );
  }

  if (status === "expired") {
    return (
      <span className="inline-flex items-center rounded-full border border-line px-2.5 py-1 text-[0.6875rem] font-semibold tracking-[0.06em] text-muted uppercase">
        Expired
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-brass-soft/45 px-2.5 py-1 text-[0.6875rem] font-semibold tracking-[0.06em] text-brass-deep uppercase">
      <IconClock className="h-3 w-3" strokeWidth={2.4} />
      Pending
    </span>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Shared body of both dashboards.
 *
 * The framing differs by `variant` -- a decentralized USG sits above its
 * campuses, while the centralized office sits above the units directly and the
 * individual USGs are not in the chain -- but the invitation mechanics are the
 * same, so they live in one component.
 *
 * Only owners get the invitation form. An invited member sees their own scope
 * and nothing else.
 */
export function Workspace({
  account,
  variant,
}: {
  account: Account;
  variant: "usg" | "central";
}) {
  const isOwner = account.accountScope === "owner";

  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [campusName, setCampusName] = useState("");
  const [unitType, setUnitType] = useState("lsg");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const fetchInvites = useCallback(async (): Promise<InviteRow[]> => {
    try {
      const res = await fetch("/api/invites");
      const data = await res.json();
      if (res.ok && data.ok) return (data.invites ?? []) as InviteRow[];
    } catch {
      // Fall through to the empty list; the counters already show a zero state.
    }
    return [];
  }, []);

  useEffect(() => {
    if (!isOwner) return;

    let cancelled = false;
    void (async () => {
      const rows = await fetchInvites();
      if (cancelled) return;
      setInvites(rows);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [isOwner, fetchInvites]);

  async function onInvite(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSentTo(null);
    setSending(true);

    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, campusName, unitType }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setError(data.message ?? "We could not send that invitation.");
        return;
      }

      setSentTo(`Invitation sent to ${data.email}.`);
      setEmail("");
      setCampusName("");
      setUnitType("lsg");
      setInvites(await fetchInvites());
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  const pending = invites.filter((i) => i.status === "pending").length;
  const activated = invites.filter((i) => i.status === "activated").length;

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Invitations", value: invites.length },
          { label: "Pending", value: pending },
          { label: "Activated", value: activated },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-line bg-paper/70 px-5 py-4"
          >
            <p className="text-[0.6875rem] font-semibold tracking-[0.1em] text-muted uppercase">
              {stat.label}
            </p>
            <p className="mt-1.5 text-[1.75rem] leading-none font-semibold text-ink">
              {loading ? "—" : stat.value}
            </p>
          </div>
        ))}
      </div>

      {isOwner ? (
        <section className="rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
          <p className="eyebrow">
            {variant === "usg" ? "Invite a campus" : "Invite a unit"}
          </p>
          <p className="mt-2 text-[0.875rem] leading-relaxed text-body">
            {variant === "usg"
              ? "Enter someone's email and the campus they belong to. They will sit under your umbrella once they activate."
              : "Enter someone's email and the unit they belong to. The central office records them directly."}
          </p>

          <form onSubmit={onInvite} noValidate className="mt-6 flex flex-col gap-5">
            <TextField
              id="invite-email"
              label="Email"
              type="email"
              placeholder="officer@campus.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <TextField
              id="invite-campus"
              label="Campus or unit"
              placeholder="College of Engineering"
              value={campusName}
              onChange={(e) => setCampusName(e.target.value)}
              optional
              hint="Leave blank if this person represents the whole organization."
            />

            <div className="flex flex-col gap-2">
              <label
                htmlFor="invite-type"
                className="text-[0.8125rem] font-medium text-ink"
              >
                Unit type
              </label>
              <select
                id="invite-type"
                value={unitType}
                onChange={(e) => setUnitType(e.target.value)}
                className={selectClass}
              >
                {UNIT_TYPES.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>

            {error ? (
              <p
                role="alert"
                className="animate-float-in rounded-xl border border-[#d9a99c] bg-[#a5442c]/[0.06] px-3.5 py-2.5 text-[0.8125rem] font-medium text-[#a5442c]"
              >
                {error}
              </p>
            ) : null}

            {sentTo ? (
              <p
                role="status"
                className="flex items-center gap-2 rounded-xl border border-brass/40 bg-brass-soft/25 px-3.5 py-2.5 text-[0.8125rem] font-medium text-ink"
              >
                <IconCheck className="h-4 w-4 shrink-0 text-brass-deep" strokeWidth={2.2} />
                {sentTo}
              </p>
            ) : null}

            <Button type="submit" size="md" disabled={sending} className="w-full sm:w-auto">
              {sending ? "Sending…" : "Send invitation"}
            </Button>
          </form>
        </section>
      ) : (
        <section className="rounded-2xl border border-brass/40 bg-brass-soft/20 px-5 py-4">
          <p className="text-[0.8125rem] leading-relaxed text-ink">
            You were invited by {account.universityName || "your student government"} and
            your workspace is scoped to {account.campusName || "your unit"}. Only an
            account owner can send invitations.
          </p>
        </section>
      )}

      {isOwner ? (
        <section className="rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
          <p className="eyebrow">
            {variant === "usg" ? "Campuses under you" : "Units on record"}
          </p>

          {loading ? (
            <p className="mt-4 text-[0.875rem] text-muted">Loading…</p>
          ) : invites.length === 0 ? (
            <p className="mt-4 text-[0.875rem] leading-relaxed text-muted">
              No invitations yet. Send the first one above and it will appear here the
              moment it is delivered.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[34rem] border-collapse text-left">
                <thead>
                  <tr className="border-b border-line">
                    {["Email", "Campus or unit", "Status", "Invited", "Activated"].map(
                      (h) => (
                        <th
                          key={h}
                          scope="col"
                          className="pb-2.5 text-[0.6875rem] font-semibold tracking-[0.1em] text-muted uppercase"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {invites.map((invite) => (
                    <tr key={invite.id} className="border-b border-line/70 last:border-b-0">
                      <td className="py-3 pr-4 text-[0.875rem] text-ink-deep">
                        {invite.email}
                      </td>
                      <td className="py-3 pr-4 text-[0.875rem] text-body">
                        {invite.campusName || "—"}
                      </td>
                      <td className="py-3 pr-4">
                        <StatusBadge status={invite.status} />
                      </td>
                      <td className="py-3 pr-4 text-[0.8125rem] text-muted">
                        {formatDate(invite.createdAt)}
                      </td>
                      <td className="py-3 text-[0.8125rem] text-muted">
                        {formatDate(invite.activatedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
