"use client";

import { useMemo, useState } from "react";
import { StepShell } from "@/components/create/StepShell";
import { TextField } from "@/components/ui/Field";
import {
  IconBuilding,
  IconCheck,
  IconLayers,
  IconLock,
  IconMail,
  IconPyramid,
  IconUser,
} from "@/components/ui/Icons";
import {
  ROLE_HINTS,
  ROLE_LABELS,
  rolesForModel,
  useOrgDraft,
  type MemberRole,
} from "@/lib/store";
import { pick, useStepForm } from "@/lib/useStepForm";
import { useStepGuard } from "@/lib/useStepGuard";
import { cn } from "@/lib/utils";

const ALL_ROLES: MemberRole[] = [
  "usg_officer",
  "lsg_officer",
  "council_officer",
  "advisor",
];

const ROLE_ICON: Record<MemberRole, React.ReactNode> = {
  usg_officer: <IconBuilding className="h-4 w-4" />,
  lsg_officer: <IconLayers className="h-4 w-4" />,
  council_officer: <IconPyramid className="h-4 w-4" />,
  advisor: <IconUser className="h-4 w-4" />,
};

function strength(pw: string) {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) || /[^\w\s]/.test(pw)) score++;
  return Math.min(score, 4);
}

const STRENGTH_LABEL = ["", "Weak", "Fair", "Good", "Strong"];

export default function AccountPage() {
  useStepGuard("account");
  const draft = useOrgDraft();
  const { patchAccount } = draft;
  const { errors, showErrors, continueStep } = useStepForm(
    "account",
    "/create/institution",
  );
  const [reveal, setReveal] = useState(false);

  const available = useMemo(() => rolesForModel(draft.model), [draft.model]);
  const federated = draft.model === "federated";
  const pw = strength(draft.account.password);
  const account = draft.account;

  return (
    <StepShell
      step="account"
      title="Create your administrator account"
      lede="This account owns the organization. You can invite treasurers, auditors, and council officers once setup is complete."
      errors={showErrors ? errors : []}
      onContinue={continueStep}
    >
      <div className="flex flex-col gap-6">
        <TextField
          id="fullName"
          label="Full name"
          autoComplete="name"
          placeholder="Juan Dela Cruz"
          icon={<IconUser />}
          value={account.fullName}
          onChange={(e) => patchAccount({ fullName: e.target.value })}
          error={pick(errors, showErrors, "full name")}
        />

        <TextField
          id="email"
          label="University email address"
          type="email"
          autoComplete="email"
          placeholder="you@university.edu"
          icon={<IconMail />}
          value={account.email}
          onChange={(e) => patchAccount({ email: e.target.value })}
          error={pick(errors, showErrors, "email")}
          hint="Use your institutional address so your officers can recognise you."
        />

        <div className="grid gap-6 sm:grid-cols-2">
          <TextField
            id="password"
            label="Password"
            type={reveal ? "text" : "password"}
            autoComplete="new-password"
            placeholder="At least 8 characters"
            icon={<IconLock />}
            value={account.password}
            onChange={(e) => patchAccount({ password: e.target.value })}
            error={pick(errors, showErrors, "at least 8")}
          />

          <div className="flex flex-col gap-2 sm:pt-8">
            <div className="flex items-center gap-1.5" aria-hidden>
              {[1, 2, 3, 4].map((seg) => (
                <span
                  key={seg}
                  className={cn(
                    "h-1 flex-1 rounded-full transition-colors duration-500",
                    pw >= seg
                      ? seg <= 1
                        ? "bg-[#c07a5f]"
                        : seg === 2
                          ? "bg-brass"
                          : "bg-ink/60"
                      : "bg-line-strong",
                  )}
                />
              ))}
            </div>
            <p className="text-[0.6875rem] text-muted">
              {pw === 0
                ? "Password strength"
                : `Password strength: ${STRENGTH_LABEL[pw]}`}
            </p>
          </div>
        </div>

        <TextField
          id="confirmPassword"
          label="Confirm password"
          type={reveal ? "text" : "password"}
          autoComplete="new-password"
          placeholder="Re-enter your password"
          icon={<IconLock />}
          value={account.confirmPassword}
          onChange={(e) => patchAccount({ confirmPassword: e.target.value })}
          error={pick(errors, showErrors, "do not match")}
        />

        <button
          type="button"
          onClick={() => setReveal((v) => !v)}
          className="self-start text-[0.75rem] font-medium text-ink-soft underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink"
        >
          {reveal ? "Hide passwords" : "Show passwords"}
        </button>

        <div className="rule" />

        {!federated ? (
          <fieldset>
            <legend className="flex items-baseline justify-between gap-3 text-[0.8125rem] font-medium text-ink">
              <span>Your role</span>
              <span className="text-[0.6875rem] font-medium tracking-[0.14em] text-faint uppercase">
                Unitary
              </span>
            </legend>
            <p className="mt-2 text-[0.75rem] leading-relaxed text-muted">
              Roles available to you depend on the governance model you chose.
            </p>

            <div
              data-invalid={showErrors && pick(errors, showErrors, "role") ? "true" : undefined}
              className="mt-4 grid gap-2.5 sm:grid-cols-2"
            >
              {ALL_ROLES.map((role) => {
                const enabled = available.includes(role);
                const selected = account.role === role;
                return (
                  <label
                    key={role}
                    className={cn(
                      "group relative flex cursor-pointer gap-3 rounded-xl border p-3.5 transition-[border-color,background-color,box-shadow] duration-400",
                      !enabled && "cursor-not-allowed opacity-45",
                      enabled && selected
                        ? "border-ink/30 bg-paper shadow-lift"
                        : "border-line bg-paper/50 hover:border-line-strong hover:bg-paper/80",
                    )}
                  >
                    <input
                      type="radio"
                      name="role"
                      value={role}
                      disabled={!enabled}
                      checked={selected}
                      onChange={() => patchAccount({ role })}
                      className="sr-only"
                    />
                    <span
                      className={cn(
                        "mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border transition-colors duration-400",
                        selected
                          ? "border-ink bg-ink text-white"
                          : "border-line-strong bg-canvas text-ink-muted",
                      )}
                    >
                      {ROLE_ICON[role]}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-[0.8125rem] font-semibold text-ink-deep">
                        {ROLE_LABELS[role]}
                        {selected ? (
                          <IconCheck className="h-3 w-3 text-brass" strokeWidth={2.4} />
                        ) : null}
                      </span>
                      <span className="mt-1 block text-[0.6875rem] leading-snug text-muted">
                        {enabled
                          ? ROLE_HINTS[role]
                          : "Not available under your governance model."}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>

            {showErrors && pick(errors, showErrors, "role") ? (
              <p role="alert" className="mt-3 text-[0.75rem] font-medium text-[#a5442c]">
                {pick(errors, showErrors, "role")}
              </p>
            ) : null}
          </fieldset>
        ) : (
          <div className="flex items-start gap-3 rounded-xl border border-line-strong/80 bg-canvas/60 px-4 py-3.5">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brass" />
            <p className="text-[0.8125rem] leading-relaxed text-muted">
              You are registering the University Student Government, so this
              account is the USG officer. Local councils are created later by
              inviting an officer into each campus.
            </p>
          </div>
        )}
      </div>
    </StepShell>
  );
}
