"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { IconCheck, IconMail } from "@/components/ui/Icons";

const RESEND_COOLDOWN = 30;

type OwnerOtpVerifyProps = {
  verifyToken: string;
  email: string;
  organizationName: string;
  onVerified: () => void;
};

/**
 * Step two of the USG flow, shown inline on the success step: exchange the
 * emailed code for an approved account.
 *
 * The account is not usable for sign-in until this succeeds. On a correct code
 * the parent signs the registrant straight in, because the session is minted by
 * re-running `login_account` (the same path a normal sign-in takes).
 */
export function OwnerOtpVerify({
  verifyToken,
  email,
  organizationName,
  onVerified,
}: OwnerOtpVerifyProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
      const res = await fetch("/api/auth/verify-owner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verifyToken, code: digits }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setError(data.message ?? "That code is not correct.");
        return;
      }

      onVerified();
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
      const res = await fetch("/api/auth/resend-owner-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verifyToken }),
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

  return (
    <div className="w-full max-w-md rounded-2xl border border-line bg-paper/70 p-6 text-left sm:p-7">
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-full border border-brass/40 bg-brass-soft/25 text-brass-deep">
          <IconMail className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[0.9375rem] font-medium text-ink">
            Check your inbox
          </p>
          <p className="text-[0.75rem] text-muted">
            {organizationName || "Your student government"} · {email || "your email"}
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} noValidate className="mt-5 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="owner-otp" className="text-[0.8125rem] font-medium text-ink">
            Verification code
          </label>
          <input
            id="owner-otp"
            name="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "owner-otp-error" : undefined}
            className="h-13 w-full rounded-xl border border-line bg-paper/70 text-center font-mono text-[1.5rem] tracking-[0.5em] text-ink-deep outline-none transition-[border-color,box-shadow,background-color] duration-300 placeholder:text-faint focus:border-ink/25 focus:bg-paper hover:border-line-strong"
          />
        </div>

        {error ? (
          <p
            id="owner-otp-error"
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
          {busy ? "Verifying…" : "Verify and approve"}
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="md"
          onClick={resend}
          disabled={busy || cooldown > 0}
          className="w-full"
        >
          {cooldown > 0 ? `Send the code again (${cooldown}s)` : "Send the code again"}
        </Button>
      </form>

      <p className="mt-4 flex items-start gap-1.5 text-[0.75rem] leading-relaxed text-muted">
        <IconCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brass-deep" strokeWidth={2.4} />
        Approving verifies that this email is yours. Nothing else about the
        registration changes.
      </p>
    </div>
  );
}