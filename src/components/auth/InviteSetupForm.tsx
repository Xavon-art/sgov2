"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PasswordField } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

/**
 * Password step of the invited flow.
 *
 * The campus and organization are shown read-only from the invite record rather
 * than as fields. Letting the invitee type them would let one person point their
 * account at a different campus than the one they were invited to.
 */
export function InviteSetupForm({
  token,
  email,
  campusName,
  organizationName,
  universityName,
}: {
  token: string;
  email: string;
  campusName: string;
  organizationName: string;
  universityName: string;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [canResend, setCanResend] = useState(false);

  async function resend() {
    setBusy(true);
    setNotice("Sending a new code…");
    try {
      const res = await fetch("/api/invites/resend-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setNotice(null);
        setError(data.message ?? "We could not send a new code.");
        return;
      }
      if (data.code === "resend_denied") {
        setNotice(data.message ?? "A code is already active. Check your inbox and spam.");
        return;
      }
      router.push(`/invite/${token}/verify?e=${encodeURIComponent(data.email ?? "")}`);
    } catch {
      setNotice(null);
      setError("We could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (password.length < 8) {
      setError("Use a password of at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }

    setBusy(true);

    try {
      const res = await fetch("/api/invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();

      if (data.canResend) {
        setCanResend(true);
        setError(data.message ?? "The code did not send.");
        return;
      }

      if (!res.ok || !data.ok) {
        setError(data.message ?? "We could not activate that invitation.");
        return;
      }

      router.push(`/invite/${token}/verify?e=${encodeURIComponent(data.email ?? "")}`);
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const rows: Array<[string, string]> = [
    ["Email", email],
    ["Campus", campusName || "—"],
    ["Organization", organizationName || "—"],
    ["University", universityName || "—"],
  ];

  return (
    <div className="flex flex-col gap-6">
      <dl data-tour="invite-details" className="rounded-2xl border border-line bg-paper/60 px-4 py-1">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-baseline justify-between gap-4 border-b border-line/70 py-2.5 last:border-b-0"
          >
            <dt className="text-[0.6875rem] font-medium tracking-[0.08em] text-muted uppercase">
              {label}
            </dt>
            <dd className="truncate text-[0.8125rem] text-ink-deep">{value}</dd>
          </div>
        ))}
      </dl>

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <PasswordField
          data-tour="invite-password"
          id="password"
          label="Password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint="Use at least 8 characters. A short phrase is stronger than a messy word."
          required
        />

        <PasswordField
          id="confirm"
          label="Confirm password"
          autoComplete="new-password"
          placeholder="Type it again"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />

        {error ? (
          <p
            role="alert"
            className="animate-float-in rounded-xl border border-[#d9a99c] bg-[#a5442c]/[0.06] px-3.5 py-2.5 text-[0.8125rem] font-medium text-[#a5442c]"
          >
            {error}
          </p>
        ) : null}

        {notice ? (
          <p role="status" className="text-[0.8125rem] font-medium text-ink-soft">
            {notice}
          </p>
        ) : null}

        <Button data-tour="invite-continue" type="submit" size="lg" disabled={busy} className="w-full">
          {busy ? "Saving…" : "Continue"}
        </Button>

        {canResend ? (
          <Button type="button" variant="outline" size="md" onClick={resend} disabled={busy}>
            Send the code again
          </Button>
        ) : null}
      </form>
    </div>
  );
}
