"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Button, buttonClasses } from "@/components/ui/Button";
import { IconArrowLeft, IconArrowRight } from "@/components/ui/Icons";
import { useOrgDraft } from "@/lib/store";
import { STEPS, previousStep, stepIndex, type StepId } from "@/lib/steps";
import { cn } from "@/lib/utils";

type Props = {
  step: StepId;
  title: ReactNode;
  lede?: ReactNode;
  children: ReactNode;
  errors?: string[];
  onContinue?: () => void;
  continueLabel?: string;
  continueIcon?: ReactNode;
  hideBack?: boolean;
  tone?: "card" | "bare";
  footer?: ReactNode;
};

export function StepShell({
  step,
  title,
  lede,
  children,
  errors = [],
  onContinue,
  continueLabel = "Continue",
  continueIcon,
  hideBack = false,
  tone = "card",
  footer,
}: Props) {
  const model = useOrgDraft((state) => state.model);
  const index = stepIndex(step);
  const meta = STEPS[index];
  const previous = previousStep(step, model);

  return (
    <div data-tour="step-frame" className="mx-auto max-w-[44rem] px-5 pt-12 pb-24 sm:px-8 sm:pt-16">
      <div data-tour="step-heading" className="text-center">
        <p className="eyebrow flex items-center justify-center gap-3">
          <span aria-hidden className="h-px w-5 bg-brass" />
          Step {index + 1} · {meta.label}
          <span aria-hidden className="h-px w-5 bg-brass" />
        </p>
        <h1 className="mt-5 text-[1.875rem] leading-[1.12] sm:text-[2.25rem] lg:text-[2.5rem]">
          {title}
        </h1>
        {lede ? (
          <p className="mx-auto mt-4 max-w-lg text-[0.9375rem] leading-relaxed text-body sm:text-base">
            {lede}
          </p>
        ) : null}
      </div>

      <div
        data-tour="step-body"
        className={cn(
          "mt-10",
          tone === "card" &&
            "rounded-2xl border border-line-strong/70 bg-paper/78 p-6 shadow-lift backdrop-blur-xl sm:p-8",
        )}
      >
        {children}
      </div>

      {errors.length > 0 ? (
        <div
          role="alert"
          className="animate-float-in mt-6 rounded-xl border border-[#dcc3b9] bg-[#faf1ec] px-4 py-3.5"
        >
          <p className="text-[0.75rem] font-semibold tracking-[0.08em] text-[#a5442c] uppercase">
            Before you continue
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {errors.map((e) => (
              <li key={e} className="text-[0.8125rem] text-[#8e3b26]">
                {e}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {onContinue || footer ? (
        <div data-tour="step-actions" className="mt-8 flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          {previous && !hideBack ? (
            <Link
              href={previous.path}
              className={buttonClasses("ghost", "md", "justify-center sm:justify-start")}
            >
              <IconArrowLeft className="h-4 w-4 transition-transform duration-400 group-hover:-translate-x-0.5" />
              {previous.label}
            </Link>
          ) : (
            <span className="hidden sm:block" />
          )}

          {footer ?? (
            <Button
              type="button"
              size="lg"
              onClick={onContinue}
              className="w-full sm:w-auto"
            >
              {continueLabel}
              {continueIcon ?? (
                <IconArrowRight className="h-4.5 w-4.5 transition-transform duration-400 group-hover:translate-x-1" />
              )}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
