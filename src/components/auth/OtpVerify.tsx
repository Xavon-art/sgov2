"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button, ButtonLink } from "@/components/ui/Button";
import { IconCheck } from "@/components/ui/Icons";

const RESEND_COOLDOWN = 30;

/**
 * Step two: exchange the emailed code for an active account.
 *
 * The account is not usable for sign-in until this succeeds, which is why the
 * flow stops here rather than logging the person straight in. The welcome letter
 * is sent on their first real sign-in, not here.
 */
export function OtpVerify({ token }: { token: string }) {
  const search = useSearchParams();
  const maskedEmail = search.get("e") ?? "";

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [alreadyActive, setAlreadyActive] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const digits = code.replace(/\D/g, "");
    if (digits.length !== 6) {
      setError("Enter the six-digit code from your email.");
      return;
    }

    setBusy(true);

    try {
      const res = await fetch("/api/invites/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code: digits }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setError(data.message ?? "That code is not correct.");
        return;
      }

      if (data.alreadyActive) {
        setAlreadyActive(true);
        return;
      }

      setDone(true);
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    setNotice("Sending a new code…");
    setBusy(true);

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

      setNotice(`New code sent to ${data.email ?? "your email"}.`);
      setCode("");
      setCooldown(RESEND_COOLDOWN);
    } catch {
      setNotice(null);
      setError("We could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (done || alreadyActive) {
    return (
      <AuthShell
        eyebrow={alreadyActive ? "Already done" : "Account activated"}
        title={alreadyActive ? "This account is live" : "You're in"}
        lede={
          alreadyActive
            ? "Nothing more to do here. Sign in with your email and password."
            : maskedEmail
              ? `Your account for ${maskedEmail} is active. Sign in with your email and password, and we'll send your welcome letter.`
              : "Your account is active. Sign in with your email and password, and we'll send your welcome letter."
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5 rounded-xl border border-brass/40 bg-brass-soft/25 px-4 py-3">
            <IconCheck className="h-4 w-4 shrink-0 text-brass-deep" strokeWidth={2.2} />
            <p className="text-[0.8125rem] font-medium text-ink">
              Verification complete
            </p>
          </div>
          <ButtonLink href="/login" size="lg" className="w-full">
            Go to sign in
          </ButtonLink>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="Verification"
      title="Enter your code"
      lede={
        maskedEmail
          ? `We sent a six-digit code to ${maskedEmail}. It expires in 15 minutes.`
          : "We sent a six-digit code to your email. It expires in 15 minutes."
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label
            htmlFor="otp"
            className="text-[0.8125rem] font-medium text-ink"
          >
            Verification code
          </label>
          <input
            id="otp"
            name="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "otp-error" : undefined}
            className="h-14 w-full rounded-xl border border-line bg-paper/70 text-center font-mono text-[1.5rem] tracking-[0.5em] text-ink-deep outline-none transition-[border-color,box-shadow,background-color] duration-300 placeholder:text-faint focus:border-ink/25 focus:bg-paper hover:border-line-strong"
          />
        </div>

        {error ? (
          <p
            id="otp-error"
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

        <Button type="submit" size="lg" disabled={busy} className="w-full">
          {busy ? "Verifying…" : "Verify and activate"}
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="md"
          onClick={resend}
          disabled={busy || cooldown > 0}
          className="w-full"
        >
          {cooldown > 0 ? `Send a new code (${cooldown}s)` : "Send a new code"}
        </Button>
      </form>
    </AuthShell>
  );
}
