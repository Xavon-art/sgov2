"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import { IconEye, IconEyeOff } from "@/components/ui/Icons";
import { cn } from "@/lib/utils";

export const control =
  "peer w-full rounded-xl border border-line bg-paper/70 px-3.5 text-[0.9375rem] text-ink-deep outline-none transition-[border-color,box-shadow,background-color] duration-300 placeholder:text-faint focus:border-ink/25 focus:bg-paper hover:border-line-strong";

const underline =
  "pointer-events-none absolute inset-x-4 -bottom-px h-px origin-center scale-x-0 bg-gradient-to-r from-transparent via-brass to-transparent transition-transform duration-500 ease-out peer-focus:scale-x-100";

export function FieldShell({
  id,
  label,
  hint,
  error,
  optional,
  srLabel = false,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  srLabel?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label
        htmlFor={id}
        className={cn(
          "flex items-baseline justify-between gap-3 text-[0.8125rem] font-medium text-ink",
          srLabel && "sr-only",
        )}
      >
        <span>{label}</span>
        {optional ? (
          <span className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-faint">
            Optional
          </span>
        ) : null}
      </label>

      <div className="relative">{children}</div>

      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="animate-float-in text-[0.75rem] font-medium text-[#a5442c]"
        >
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[0.75rem] leading-relaxed text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type TextFieldProps = Omit<ComponentProps<"input">, "id"> & {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  srLabel?: boolean;
  icon?: ReactNode;
};

export function TextField({
  id,
  label,
  hint,
  error,
  optional,
  srLabel = false,
  icon,
  className,
  ...rest
}: TextFieldProps) {
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      optional={optional}
      srLabel={srLabel}
    >
      <div className="relative">
        {icon ? (
          <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-muted [&>svg]:h-[1.05rem] [&>svg]:w-[1.05rem]">
            {icon}
          </span>
        ) : null}
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className={cn(
            control,
            "h-12",
            icon ? "pl-10.5" : undefined,
            error ? "border-[#d9a99c] focus:border-[#c16549]" : undefined,
            className,
          )}
          {...rest}
        />
        <span className={underline} />
      </div>
    </FieldShell>
  );
}

type PasswordFieldProps = Omit<ComponentProps<"input">, "id" | "type"> & {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  srLabel?: boolean;
};

/**
 * A masked input with a reveal control. The toggle flips the input's own `type`
 * rather than mirroring the value into a second field, so the caret, the
 * browser's password manager, and the form's submit value all stay on one
 * element. The control is `type="button"`, so pressing it cannot submit the
 * form by accident, and the label names the action the press will take.
 */
export function PasswordField({
  id,
  label,
  hint,
  error,
  optional,
  srLabel = false,
  className,
  ...rest
}: PasswordFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const action = revealed ? "Hide password" : "Show password";

  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      optional={optional}
      srLabel={srLabel}
    >
      <div className="relative">
        <input
          id={id}
          type={revealed ? "text" : "password"}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className={cn(
            control,
            "h-12 pr-11",
            error ? "border-[#d9a99c] focus:border-[#c16549]" : undefined,
            className,
          )}
          {...rest}
        />
        <span className={underline} />
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          aria-label={action}
          aria-pressed={revealed}
          title={action}
          className="absolute top-1/2 right-2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-ink-muted transition-colors duration-300 hover:bg-brass-soft/25 hover:text-ink focus-visible:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink/40 [&>svg]:h-[1.05rem] [&>svg]:w-[1.05rem]"
        >
          {revealed ? <IconEyeOff /> : <IconEye />}
        </button>
      </div>
    </FieldShell>
  );
}

type TextAreaProps = Omit<ComponentProps<"textarea">, "id"> & {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  charCount?: { value: number; max: number };
};

export function TextArea({
  id,
  label,
  hint,
  error,
  optional,
  charCount,
  className,
  ...rest
}: TextAreaProps) {
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      optional={optional}
    >
      <div className="relative">
        <textarea
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className={cn(control, "min-h-28 resize-y py-3 leading-relaxed", className)}
          {...rest}
        />
        <span className={underline} />
        {charCount ? (
          <span className="pointer-events-none absolute right-3.5 -bottom-5 text-[0.6875rem] tabular-nums text-faint">
            {charCount.value}/{charCount.max}
          </span>
        ) : null}
      </div>
    </FieldShell>
  );
}

type ChoiceCardProps = {
  selected: boolean;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
} & Omit<ComponentProps<"button">, "className" | "children">;

export function ChoiceCard({
  selected,
  className,
  children,
  ...rest
}: ChoiceCardProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "group relative overflow-hidden rounded-2xl border bg-paper/60 text-left transition-[border-color,box-shadow,transform,background-color] duration-500 ease-out hover:-translate-y-0.5",
        selected
          ? "border-ink/30 bg-paper shadow-lift"
          : "border-line hover:border-line-strong hover:shadow-lift",
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-ink/[0.045] via-transparent to-brass/[0.06] opacity-0 transition-opacity duration-500",
          selected && "opacity-100",
        )}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-3 left-0 w-px origin-top scale-y-0 bg-gradient-to-b from-brass to-transparent transition-transform duration-500 ease-out group-hover:scale-y-100"
      />
      {children}
    </button>
  );
}

export function Divider({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("rule my-8 opacity-70", className)}
    />
  );
}
