"use client";

import { useEffect, useRef, useState } from "react";
import { StepShell } from "@/components/create/StepShell";
import { ButtonLink } from "@/components/ui/Button";
import { Seal } from "@/components/ui/Seal";
import {
  IconArrowRight,
  IconCheck,
  IconClock,
  IconLayers,
  IconMail,
} from "@/components/ui/Icons";
import { ROLE_LABELS, useOrgDraft, type MemberRole } from "@/lib/store";
import { submitOrganization } from "@/lib/submit";
import { useStepGuard } from "@/lib/useStepGuard";

type Phase = "submitting" | "done" | "local";

const NEXT = [
  {
    icon: IconMail,
    title: "Invite your officers",
    body: "Send invitations to treasurers, auditors, and every council president. Roles are already waiting for them.",
  },
  {
    icon: IconLayers,
    title: "Fill in your org chart",
    body: "Add the colleges, departments, and satellite campuses beneath your USG — or leave the single council as is.",
  },
  {
    icon: IconClock,
    title: "Open your first submission",
    body: "Requirements and resolutions start routing the moment a council files one.",
  },
];

export default function SuccessPage() {
  useStepGuard("success");
  const draft = useOrgDraft();
  const {
    charter,
    setCharter,
    organizationId,
    setOrganizationId,
    markSubmitted,
    reset,
  } = draft;
  const started = useRef(false);
  const [phase, setPhase] = useState<Phase>(
    organizationId ? "done" : "submitting",
  );
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (organizationId) return;

    submitOrganization(draft, charter)
      .then((result) => {
        setCharter(result.charter);
        if (result.status === "ok") {
          setOrganizationId(result.organizationId);
          markSubmitted();
          setPhase("done");
        } else {
          setNote(result.reason);
          setPhase("local");
        }
      })
      .catch((err: unknown) => {
        setNote(err instanceof Error ? err.message : "Unexpected error.");
        setPhase("local");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const federated = draft.model === "federated";
  const submitting = phase === "submitting";

  return (
    <StepShell
      step="success"
      tone="bare"
      title={
        submitting ? (
          <span className="inline-flex items-center gap-3">
            <span className="size-2 animate-pulse rounded-full bg-brass" />
            Granting your charter
          </span>
        ) : (
          <>
            Your charter has
            <br className="hidden sm:block" /> been granted.
          </>
        )
      }
      lede={
        submitting
          ? "Creating your organization, its founding officer record, and its org chart root."
          : `${draft.organization.name} is now a chartered SmartGov organization, governed for ${draft.organization.academicYear}.`
      }
    >
      <div className="flex flex-col items-center">
        <div className="relative">
          {!submitting ? (
            <span
              aria-hidden
              className="absolute inset-0 -z-10 rounded-full bg-brass/20 blur-2xl"
            />
          ) : null}
          <Seal
            size={104}
            inscribed
            accent={draft.organization.accent}
            className={
              submitting
                ? "opacity-40"
                : "animate-stamp drop-shadow-[0_10px_30px_rgba(13,33,53,0.2)]"
            }
          />
        </div>

        <p className="mt-7 font-mono text-[0.8125rem] tracking-[0.14em] text-brass-deep">
          {charter ?? "———"}
        </p>

        {phase === "done" ? (
          <p className="animate-float-in mt-4 inline-flex items-center gap-2 rounded-full border border-brass/40 bg-brass-soft/30 px-3.5 py-1.5 text-[0.75rem] font-medium text-ink">
            <IconCheck className="h-3.5 w-3.5 text-brass-deep" strokeWidth={2.4} />
            Organization created
            {organizationId ? (
              <span className="font-mono text-[0.6875rem] text-ink-soft">
                · {organizationId.slice(0, 8)}
              </span>
            ) : null}
          </p>
        ) : null}

        {note ? (
          <p className="mt-4 max-w-md rounded-xl border border-line-strong bg-canvas/70 px-4 py-3 text-left text-[0.75rem] leading-relaxed text-muted">
            <span className="font-semibold text-ink">Prototype notice. </span>
            {note} The charter above is still valid for this session.
          </p>
        ) : null}
      </div>

      <div className="mt-10 rounded-2xl border border-line-strong/70 bg-paper/70 p-6 sm:p-7">
        <p className="eyebrow">What you set up</p>
        <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
          <div className="flex items-baseline justify-between gap-3 border-b border-line/70 pb-2.5">
            <dt className="text-[0.75rem] text-muted">Administrator</dt>
            <dd className="text-[0.875rem] text-ink-deep">
              {draft.account.fullName}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 border-b border-line/70 pb-2.5">
            <dt className="text-[0.75rem] text-muted">Role</dt>
            <dd className="text-[0.875rem] text-ink-deep">
              {ROLE_LABELS[draft.account.role as MemberRole] ?? "—"}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 border-b border-line/70 pb-2.5">
            <dt className="text-[0.75rem] text-muted">Institution</dt>
            <dd className="truncate text-[0.875rem] text-ink-deep">
              {draft.institution.universityName}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 border-b border-line/70 pb-2.5">
            <dt className="text-[0.75rem] text-muted">Structure</dt>
            <dd className="text-[0.875rem] text-ink-deep">
              {federated ? "Federated" : "Unitary"}
            </dd>
          </div>
        </dl>
      </div>

      <ol className="mt-8 flex flex-col">
        {NEXT.map((item, i) => {
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
        <ButtonLink href="/dashboard" size="lg" className="w-full sm:w-auto">
          Go to Dashboard
          <IconArrowRight className="h-4.5 w-4.5 transition-transform duration-500 group-hover:translate-x-1" />
        </ButtonLink>
        <ButtonLink href="/" size="lg" variant="outline" className="w-full sm:w-auto">
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
