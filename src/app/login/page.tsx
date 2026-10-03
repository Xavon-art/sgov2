"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { TextField, PasswordField } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { IconMail } from "@/components/ui/Icons";
import { markBooted } from "@/lib/auth/boot";

const RESEND_COOLDOWN = 15 * 60;

type Phase = "login" | "email" | "reset" | "done";

/**
 * The sign-in page, with the password-recovery path beside it. "Forgot
 * password?" walks email -> code + new password -> confirmation, all on this
 * page. The reset endpoint revokes every session, so the done step returns the
 * person to the sign-in form rather than minting a new one.
 *
 * Deliberately anonymous: the forgot-password route answers identically whether
 * or not an account exists, so this form never tells a caller whether an email
 * is registered. The copy stays a graceful "if you have an account" line.
 */
export default function LoginPage() {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  function openReset() {
    setError(null);
    setNotice(null);
    setCode("");
    setNewPassword("");
    setPhase("email");
  }

  function backToLogin() {
    setError(null);
    setNotice(null);
    setPassword("");
    setPhase("login");
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        // A pending account has the right password but no proof of the address
        // yet. Sending them to the verification step is the useful answer, and
        // that step carries the resend control.
        if (data.code === "account_pending") {
          router.push("/create/verification");
          return;
        }
        setError(data.message ?? "We could not sign you in.");
        return;
      }

      // An active account goes straight to the workspace — no onboarding steps
      // in between. The dashboard re-checks the session server-side, so a
      // cookie that expired between the two calls bounces back here.
      //
      // Marked booted first: the dashboard signs out any document that was loaded
      // fresh rather than navigated to, and `router.push` navigates within this
      // one. The marker has to exist before the navigation starts, or the guard
      // reads it on the next page and tears down the session just created.
      markBooted();
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        if (data.code === "email_failed") {
          setNotice(data.message ?? "The code could not be sent. Try again in a moment.");
          return;
        }
        setError(data.message ?? "We could not start a password reset.");
        return;
      }

      setNotice(
        data.code === "email_failed"
          ? "The code could not be sent. Try sending it again in a moment."
          : "If an account exists for this email, a code is on its way — and it stays valid for 15 minutes.",
      );
      setSentTo(email.trim());
      setCooldown(RESEND_COOLDOWN);
      setPhase("reset");
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    setError(null);
    setNotice("Sending a new code…");
    setBusy(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setNotice(null);
        setError(data.message ?? "We could not send a new code.");
        return;
      }

      setNotice(
        data.code === "email_failed"
          ? "The code still did not send. Try again in a moment."
          : "One code at a time: the one we sent stays valid for 15 minutes, so the code already in your inbox still works. Check spam just in case, and come back if it expires.",
      );
      setCode("");
      setCooldown(RESEND_COOLDOWN);
    } catch {
      setNotice(null);
      setError("We could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function completeReset(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const digits = code.replace(/\D/g, "");
    if (digits.length !== 6) {
      setError("Enter the six-digit code from your email.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Use a password of at least 8 characters.");
      return;
    }

    setBusy(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: digits, newPassword }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setError(data.message ?? "That code is not correct.");
        return;
      }

      setPassword("");
      setCode("");
      setNewPassword("");
      setPhase("done");
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const footer = (
    <p className="text-[0.8125rem] text-muted">
      {phase === "login" ? (
        <>
          No account yet?{" "}
          <Link
            href="/create"
            className="font-medium text-ink underline underline-offset-4"
          >
            Set up a student organization
          </Link>
          .
        </>
      ) : (
        <>
          Remembered it?{" "}
          <button
            type="button"
            onClick={backToLogin}
            className="font-medium text-ink underline underline-offset-4"
          >
            Back to sign in
          </button>
          .
        </>
      )}
    </p>
  );

  return (
    <AuthShell
      eyebrow={phase === "login" ? "Sign in" : "Reset password"}
      title={
        phase === "login"
          ? "Welcome back"
          : phase === "done"
            ? "Password updated"
            : "Recover your password"
      }
      lede={
        phase === "login"
          ? "Use the email your student government registered for you."
          : "We will email a code to prove it is really you, then you can set a new password."
      }
      footer={footer}
    >
      {phase === "login" ? (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          <TextField
            id="email"
            label="Email"
            type="email"
            autoComplete="email"
            placeholder="you@university.edu"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <div className="flex flex-col gap-1">
            <PasswordField
              id="password"
              label="Password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              onClick={openReset}
              className="self-end text-[0.8125rem] font-medium text-ink underline underline-offset-4 transition-colors hover:text-brass-deep"
            >
              Forgot password?
            </button>
          </div>

          {error ? (
            <p
              role="alert"
              className="animate-float-in rounded-xl border border-[#d9a99c] bg-[#a5442c]/[0.06] px-3.5 py-2.5 text-[0.8125rem] font-medium text-[#a5442c]"
            >
              {error}
            </p>
          ) : null}

          <Button type="submit" size="lg" disabled={busy} className="w-full">
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      ) : phase === "email" ? (
        <form onSubmit={requestCode} noValidate className="flex flex-col gap-5">
          <TextField
            id="reset-email"
            label="Email"
            type="email"
            autoComplete="email"
            placeholder="you@university.edu"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />

          {error ? (
            <p
              role="alert"
              className="animate-float-in rounded-xl border border-[#d9a99c] bg-[#a5442c]/[0.06] px-3.5 py-2.5 text-[0.8125rem] font-medium text-[#a5442c]"
            >
              {error}
            </p>
          ) : null}

          <Button type="submit" size="lg" disabled={busy} className="w-full">
            {busy ? "Sending…" : "Send me a code"}
          </Button>
        </form>
      ) : phase === "reset" ? (
        <form onSubmit={completeReset} noValidate className="flex flex-col gap-5">
          <div className="flex items-center gap-2.5 rounded-xl border border-line bg-paper/60 px-4 py-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-full border border-brass/40 bg-brass-soft/25 text-brass-deep">
              <IconMail className="h-4 w-4" />
            </span>
            <p className="text-[0.8125rem] leading-relaxed text-muted">
              {notice ?? (
                <>
                  We sent a code to{" "}
                  <span className="font-medium text-ink">{sentTo ?? "your email"}</span>, if an
                  account exists for it. It stays valid for 15 minutes — check spam too.
                </>
              )}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="reset-otp" className="text-[0.8125rem] font-medium text-ink">
              Verification code
            </label>
            <input
              id="reset-otp"
              name="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              aria-invalid={error ? true : undefined}
              className="h-13 w-full rounded-xl border border-line bg-paper/70 text-center font-mono text-[1.5rem] tracking-[0.5em] text-ink-deep outline-none transition-[border-color,box-shadow,background-color] duration-300 placeholder:text-faint focus:border-ink/25 focus:bg-paper hover:border-line-strong"
            />
          </div>

          <TextField
            id="reset-password"
            label="New password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
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

          <Button type="submit" size="lg" disabled={busy} className="w-full">
            {busy ? "Resetting…" : "Change password"}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="md"
            onClick={resendCode}
            disabled={busy || cooldown > 0}
            className="w-full"
          >
            {cooldown > 0 ? `Send the code again (${cooldown}s)` : "Send the code again"}
          </Button>

          <p className="text-[0.75rem] leading-relaxed text-muted">
            Changing your password signs you out of every device, including this one.
          </p>
        </form>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="rounded-xl border border-line bg-paper/60 px-4 py-3">
            <p className="text-[0.875rem] leading-relaxed text-ink">
              Your password has been changed, and you are signed out of every device.
              Sign back in with your new password.
            </p>
          </div>

          <Button
            type="button"
            size="lg"
            onClick={() => {
              setPhase("login");
              setPassword("");
            }}
            className="w-full"
          >
            Back to sign in
          </Button>
        </div>
      )}

      {phase === "login" ? (
        <div className="mt-6 rounded-xl border border-line bg-paper/60 px-4 py-3">
          <p className="text-[0.75rem] leading-relaxed text-muted">
            Invited but not activated yet? Open the link from your invitation email to
            finish setting up your password.
          </p>
        </div>
      ) : null}
    </AuthShell>
  );
}