"use client";

import { useEffect, useRef, useState } from "react";
import { StepShell } from "@/components/create/StepShell";
import { ButtonLink } from "@/components/ui/Button";
import { Seal } from "@/components/ui/Seal";
import { IconArrowRight, IconCheck, IconLayers, IconMail } from "@/components/ui/Icons";
import { ROLE_LABELS, useOrgDraft, type MemberRole } from "@/lib/store";
import { useStepGuard } from "@/lib/useStepGuard";
import { DEFAULT_ACCENT } from "@/lib/submit";

/**
 * The last step. Verification already flipped the account to `active` in the
 * database, so this is a confirmation rather than a gate — it deliberately has
 * no form on it and nothing to fail.
 *
 * The celebratory pass is a short stagger on elements that are already in the
 * DOM, and it is suppressed under `prefers-reduced-motion`, which the existing
 * `animate-float-in` utility already handles by not animating.
 */
export default function ActivatedPage() {
  // Reaching this step at all means every earlier step validated, and the
  // organization id in the draft is the proof that the confirmation actually
  // ran — so a hand-typed URL cannot show a live account that was never created.
  useStepGuard("activated");
  const draft = useOrgDraft();
  const { organizationId, charter, reset } = draft;
  const celebrated = useRef(false);

  // The seal stamps itself once. Without this the animation replays on every
  // re-render, which reads as a glitch rather than a flourish.
  const [stamped, setStamped] = useState(false);
  useEffect(() => {
    if (celebrated.current) return;
    celebrated.current = true;
    const id = requestAnimationFrame(() => setStamped(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const account = draft.account;
  const inst = draft.institution;

  return (
    <StepShell
      step="activated"
      tone="bare"
      title={
        <>
          Congratulations!
          <br className="hidden sm:block" /> Your USG account is activated.
        </>
      }
      lede="Your account is live and your workspace is open. Sign in with the email and password you just set."
    >
      <div className="flex flex-col items-center">
        <div className="relative">
          <span
            aria-hidden
            className="absolute inset-0 -z-10 rounded-full bg-brass/20 blur-2xl"
          />
          <Seal
            size={104}
            inscribed
            accent={DEFAULT_ACCENT}
            className={
              stamped
                ? "animate-stamp drop-shadow-[0_10px_30px_rgba(13,33,53,0.2)]"
                : "opacity-40"
            }
          />
        </div>

        <p className="mt-7 font-mono text-[0.8125rem] tracking-[0.14em] text-brass-deep">
          {charter ?? "———"}
        </p>

        <p className="animate-float-in mt-4 inline-flex items-center gap-2 rounded-full border border-brass/40 bg-brass-soft/30 px-3.5 py-1.5 text-[0.75rem] font-medium text-ink">
          <IconCheck className="h-3.5 w-3.5 text-brass-deep" strokeWidth={2.4} />
          Account active
        </p>
      </div>

      <div data-tour="activated-summary" className="mt-10 rounded-2xl border border-line-strong/70 bg-paper/70 p-6 sm:p-7">
        <p className="eyebrow">What you set up</p>
        <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {[
            ["Administrator", account.fullName],
            ["Email", account.email],
            ["Role", ROLE_LABELS[account.role as MemberRole] ?? "USG Officer"],
            ["Institution", inst.universityName],
            ["Governance model", "Federated (decentralized)"],
            ["Academic year", draft.academicYear],
            [
              "Organization",
              organizationId ? organizationId.slice(0, 8) : "—",
            ],
          ].map(([label, value]) => (
            <div
              key={label}
              className="flex items-baseline justify-between gap-3 border-b border-line/70 pb-2.5"
            >
              <dt className="text-[0.75rem] text-muted">{label}</dt>
              <dd className="truncate text-[0.875rem] text-ink-deep">{value || "—"}</dd>
            </div>
          ))}
        </dl>
      </div>

      <ol className="mt-8 flex flex-col">
        {[
          {
            icon: IconLayers,
            title: "Add your councils",
            body: "Create a college, campus, or department from the org chart. Each one becomes a Local Student Government under your USG.",
          },
          {
            icon: IconMail,
            title: "Invite an officer into each",
            body: "An invited officer sets their password, verifies their email, and their council appears in your org chart with its own seats.",
          },
        ].map((item, i) => {
          const Icon = item.icon;
          return (
            <li
              key={item.title}
              className="animate-float-in flex gap-4 border-t border-line py-5 first:border-t-0 first:pt-0"
              style={{ animationDelay: `${0.15 + i * 0.09}s` }}
            >
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full border border-line-strong bg-canvas text-ink-muted">
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-[0.9375rem] font-medium text-ink-deep">
                  {item.title}
                </h2>
                <p className="mt-1 text-[0.8125rem] leading-relaxed text-body">
                  {item.body}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-center">
        <ButtonLink data-tour="activated-sign-in" href="/login" size="lg" className="w-full sm:w-auto">
          Go to Login
          <IconArrowRight className="h-4.5 w-4.5 transition-transform duration-500 group-hover:translate-x-1" />
        </ButtonLink>
        <ButtonLink data-tour="activated-home" href="/" size="lg" variant="outline" className="w-full sm:w-auto">
          Back to home
        </ButtonLink>
      </div>

      <p className="mt-8 text-center text-[0.75rem] text-muted">
        Testing the flow again?{" "}
        <button
          type="button"
          onClick={reset}
          className="font-medium text-ink underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-ink"
        >
          Clear this draft
        </button>
      </p>
    </StepShell>
  );
}
