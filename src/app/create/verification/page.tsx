"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StepShell } from "@/components/create/StepShell";
import { OtpBoxes } from "@/components/create/OtpBoxes";
import { Button } from "@/components/ui/Button";
import { IconClock, IconMail, IconShield } from "@/components/ui/Icons";
import { useOrgDraft } from "@/lib/store";
import { maskEmail } from "@/lib/auth/messages";
import { registerAccount, submitOrganization } from "@/lib/submit";
import { useStepGuard } from "@/lib/useStepGuard";

type Phase = "submitting" | "awaiting-code" | "failed" | "no-registration";

const RESEND_COOLDOWN = 60;
const OTP_MINUTES = 15;

function countdown(seconds: number) {
  const m = Math.floor(Math.max(seconds, 0) / 60);
  const s = Math.max(seconds, 0) % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * The confirmation step. Everything before this page is client-side only, so
 * the organization, the founding officer, and the account are all written here
 * in one pass and the emailed code is what makes the account usable.
 */
export default function VerificationPage() {
  useStepGuard("verification");
  const router = useRouter();
  const draft = useOrgDraft();
  const {
    charter,
    setCharter,
    organizationId,
    setOrganizationId,
    ownerVerify,
    setOwnerVerify,
    confirmIntent,
    clearSubmitIntent,
    markSubmitted,
  } = draft;
  const started = useRef(false);

  // Three ways to arrive here, and they are told apart by what the draft holds:
  //
  //  - a token: the write already happened, so this resumes the code step
  //  - a confirmed setup: the Review step asked for the write, so do it now
  //  - neither: someone followed a sign-in link. Their registration exists, but
  //    this browser cannot prove it is theirs, so nothing may be written.
  const [phase, setPhase] = useState<Phase>(() => {
    if (ownerVerify) return "awaiting-code";
    if (organizationId) return "failed";
    return confirmIntent ? "submitting" : "no-registration";
  });
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);
  const [remaining, setRemaining] = useState(OTP_MINUTES * 60);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  useEffect(() => {
    if (phase !== "awaiting-code") return;
    const id = setTimeout(() => setRemaining((r) => Math.max(r - 1, 0)), 1000);
    return () => clearTimeout(id);
  }, [phase, remaining]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (ownerVerify) return;
    if (!confirmIntent) return;

    // Spend the permission before the first await, so a reload mid-write cannot
    // start a second one.
    clearSubmitIntent();

    submitOrganization(draft, charter)
      .then(async (result) => {
        setCharter(result.charter);

        if (result.status !== "ok") {
          setNote(result.reason);
          setPhase("failed");
          return;
        }

        setOrganizationId(result.organizationId);
        markSubmitted();

        const registered = await registerAccount(draft, result.organizationId);
        if (!registered.ok) {
          setNote(registered.reason);
          setPhase("failed");
          return;
        }

        setOwnerVerify({
          verifyToken: registered.verifyToken,
          email: registered.email,
          organizationName: registered.organizationName,
        });
        setPhase("awaiting-code");
      })
      .catch((err: unknown) => {
        setNote(err instanceof Error ? err.message : "Unexpected error.");
        setPhase("failed");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function verify(code: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/verify-owner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verifyToken: ownerVerify?.verifyToken ?? "", code }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setError(data.message ?? "That code is not correct.");
        return false;
      }

      setOwnerVerify(null);
      router.push("/create/activated");
      router.refresh();
      return true;
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
      return false;
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
        body: JSON.stringify({ verifyToken: ownerVerify?.verifyToken ?? "" }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setNotice(null);
        setError(data.message ?? "We could not send a new code.");
        return;
      }

      if (data.code === "resend_denied") {
        setNotice(data.message ?? "A code is already active for this registration.");
        return;
      }

      setNotice(`New code sent to ${data.email ?? "your email"}. It stays valid for ${OTP_MINUTES} minutes.`);
      setRemaining(OTP_MINUTES * 60);
      setCooldown(RESEND_COOLDOWN);
    } catch {
      setNotice(null);
      setError("We could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const submitting = phase === "submitting";

  return (
    <StepShell
      step="verification"
      tone="bare"
      title={
        submitting ? (
          <span className="inline-flex items-center gap-3">
            <span className="size-2 animate-pulse rounded-full bg-brass" />
            Creating your USG
          </span>
        ) : phase === "failed" ? (
          <>
            We could not finish
            <br className="hidden sm:block" /> setting up your account.
          </>
        ) : phase === "no-registration" ? (
          <>
            We could not find
            <br className="hidden sm:block" /> your pending registration.
          </>
        ) : (
          "Verify it's you"
        )
      }
      lede={
        submitting
          ? "Creating your organization, your founding officer record, and your administrator account."
          : phase === "failed"
            ? "Nothing was activated. You can go back and try again."
            : phase === "no-registration"
              ? "Your account is still waiting for its code, but this browser does not hold the registration — codes are only re-sent to the session that started the setup."
              : `We sent a six-digit code to ${ownerVerify ? maskEmail(ownerVerify.email) : "your email"}. Enter it to activate your account.`
      }
    >
      {submitting ? (
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 text-center">
          <div className="h-1 w-40 overflow-hidden rounded-full bg-line-strong">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-brass" />
          </div>
          <p className="text-[0.8125rem] text-muted">
            Writing your organization and mailing your code.
          </p>
        </div>
      ) : phase === "failed" ? (
        <div className="mx-auto flex max-w-md flex-col items-center gap-5">
          <p className="rounded-xl border border-[#dcc3b9] bg-[#faf1ec] px-4 py-3.5 text-left text-[0.8125rem] leading-relaxed text-[#8e3b26]">
            {note}
          </p>
          <Button type="button" size="lg" onClick={() => router.push("/create/review")}>
            Back to review
          </Button>
        </div>
      ) : phase === "no-registration" ? (
        <div className="mx-auto flex max-w-md flex-col items-center gap-5">
          <p className="rounded-xl border border-line bg-paper/70 px-4 py-3.5 text-left text-[0.8125rem] leading-relaxed text-muted">
            Sign out, then sign back in on the tab where you started the setup —
            that tab can send you a new code. Re-running setup would create a
            second organization, so we do not offer it.
          </p>
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
            <Button
              type="button"
              size="lg"
              className="w-full sm:w-auto"
              onClick={() => router.push("/login")}
            >
              Back to sign in
            </Button>
          </div>
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-md flex-col gap-6">
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-paper/70 px-5 py-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-full border border-brass/40 bg-brass-soft/25 text-brass-deep">
              <IconMail className="h-4.5 w-4.5" />
            </span>
            <div className="min-w-0">
              <p className="text-[0.9375rem] font-medium text-ink">Check your inbox</p>
              <p className="truncate text-[0.75rem] text-muted">
                {ownerVerify?.organizationName || "Your student government"} ·{" "}
                {ownerVerify ? maskEmail(ownerVerify.email) : "your email"}
              </p>
            </div>
          </div>

          <OtpBoxes
            busy={busy}
            onComplete={verify}
            label="Verification code"
            hint="Paste the six digits, or type them one box at a time."
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

          <div className="flex items-center justify-center gap-2 text-[0.8125rem] font-medium tabular-nums text-muted">
            <IconClock className="h-4 w-4" />
            {remaining > 0 ? (
              <>
                Code expires in{" "}
                <span className="text-ink-deep">{countdown(remaining)}</span>
              </>
            ) : (
              <span className="text-[#a5442c]">This code has expired — send a new one.</span>
            )}
          </div>

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

          <p className="flex items-start gap-1.5 text-[0.75rem] leading-relaxed text-muted">
            <IconShield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brass-deep" strokeWidth={2.4} />
            Verifying proves the address is yours. Your account stays locked until
            you do, and each code works once.
          </p>
        </div>
      )}
    </StepShell>
  );
}
