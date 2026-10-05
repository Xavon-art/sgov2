"use client";

import { useCallback, useEffect, useState } from "react";

type Grant = {
  email: string;
  displayName: string | null;
  permission: string;
  grantedAt: string;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; grants: Grant[] };

const PERMISSION_LABEL: Record<string, string> = {
  can_invite: "Can invite officers",
};

/**
 * Who may invite officers.
 *
 * The USG Admin always can. This screen is the only way anybody else ever does,
 * which is the point: `can_invite` is an explicit, visible grant rather than
 * something inferred from holding a position.
 *
 * This route lives under `/usg`, so the layout guard has already refused an LSG
 * account before it renders, and the RPC refuses a non-owner on its own.
 */
export default function UsgAccessPage() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/permissions");
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setState({ kind: "error", message: data.message ?? "We could not load permissions." });
        return;
      }
      setState({ kind: "ready", grants: data.grants ?? [] });
    } catch {
      setState({ kind: "error", message: "We could not reach the server. Check your connection." });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/permissions");
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setState({ kind: "error", message: data.message ?? "We could not load permissions." });
          return;
        }
        setState({ kind: "ready", grants: data.grants ?? [] });
      } catch {
        if (cancelled) return;
        setState({
          kind: "error",
          message: "We could not reach the server. Check your connection.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setNotice(null);

    if (!email.trim()) {
      setNotice({ tone: "bad", text: "Enter the officer's email address." });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), permission: "can_invite" }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setNotice({ tone: "bad", text: data.message ?? "We could not save that." });
        return;
      }

      setEmail("");
      setNotice({ tone: "ok", text: `${data.email} can now invite officers.` });
      await load();
    } catch {
      setNotice({ tone: "bad", text: "We could not reach the server. Check your connection." });
    } finally {
      setSaving(false);
    }
  }

  async function revoke(target: Grant) {
    setNotice(null);
    setSaving(true);
    try {
      const res = await fetch("/api/permissions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: target.email, permission: target.permission }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setNotice({ tone: "bad", text: data.message ?? "We could not remove that." });
        return;
      }

      setNotice({
        tone: "ok",
        text: `${target.email} can no longer invite officers.`,
      });
      await load();
    } catch {
      setNotice({ tone: "bad", text: "We could not reach the server. Check your connection." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-3xl">
      <header className="border-b border-line/80 pb-4">
        <p className="eyebrow">Access</p>
        <h1 className="mt-1 text-[1.5rem] leading-tight sm:text-[1.75rem]">Who is allowed to invite</h1>
        <p className="mt-1 max-w-prose text-[0.9375rem] leading-relaxed text-body">
          Inviting officers is a USG Admin permission. You can hand it to a USG officer when your
          organization needs somebody else to run onboarding.
        </p>
      </header>

      <form onSubmit={submit} className="mt-6 rounded-card border border-line bg-paper p-4">
        <label htmlFor="grant-email" className="block text-[0.9375rem] font-medium">
          Officer email
        </label>
        <input
          id="grant-email"
          name="email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="officer@university.edu"
          aria-describedby="grant-help"
          className="mt-1.5 min-h-11 w-full rounded-lg border border-line bg-canvas px-3 text-[0.9375rem] outline-none focus-visible:border-brass focus-visible:ring-2 focus-visible:ring-brass/40"
        />
        <p id="grant-help" className="mt-1.5 text-[0.8125rem] text-muted">
          The officer needs an active account in this organization first. Invite them from the
          Invitations screen if they do not have one.
        </p>
        <div className="mt-4">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex min-h-11 items-center rounded-lg bg-ink px-4 text-[0.9375rem] text-paper transition-colors hover:bg-ink-deep disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving..." : "Grant permission to invite"}
          </button>
        </div>
      </form>

      <div aria-live="polite" className="mt-3 min-h-6">
        {notice ? (
          <p
            className={
              notice.tone === "ok" ? "text-[0.9375rem] text-ink" : "text-[0.9375rem] text-brass-deep"
            }
          >
            {notice.text}
          </p>
        ) : null}
      </div>

      <h2 className="mt-6 text-[1.125rem] leading-tight">Current grants</h2>

      {state.kind === "loading" ? (
        <p className="mt-3 text-[0.9375rem] text-muted">Loading permissions...</p>
      ) : state.kind === "error" ? (
        <div className="mt-3 rounded-card border border-line bg-paper px-4 py-5">
          <p className="text-[0.9375rem] leading-relaxed text-body">{state.message}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-[0.9375rem] transition-colors hover:bg-canvas"
          >
            Try again
          </button>
        </div>
      ) : state.grants.length === 0 ? (
        <div className="mt-3 rounded-card border border-line bg-paper px-4 py-5">
          <p className="text-[0.9375rem] leading-relaxed text-body">
            Nobody has an extra permission. Right now only the USG Admin can invite officers.
          </p>
        </div>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {state.grants.map((grant) => (
            <li
              key={`${grant.email}:${grant.permission}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-paper px-4 py-3"
            >
              <div>
                <p className="text-[0.9375rem]">
                  {grant.displayName ?? grant.email}
                  {grant.displayName ? (
                    <span className="block text-[0.8125rem] text-muted">{grant.email}</span>
                  ) : null}
                </p>
                <p className="text-[0.8125rem] text-muted">
                  {PERMISSION_LABEL[grant.permission] ?? grant.permission}
                </p>
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={() => void revoke(grant)}
                className="inline-flex min-h-11 items-center rounded-lg border border-line px-3 text-[0.875rem] transition-colors hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-60"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}