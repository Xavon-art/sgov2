"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const LENGTH = 6;

type Props = {
  busy?: boolean;
  label: string;
  hint?: string;
  onComplete: (code: string) => void | Promise<unknown>;
};

/**
 * Six single-character boxes rather than one field.
 *
 * A single input forces the code to be read as one monospace block and gives no
 * cue about which digit is wrong. Separate boxes let the active position be
 * visible and make a pasted code land in the right places.
 *
 * The boxes are presentational and a real input sits on top of them, so paste,
 * mobile numeric keyboards, and `one-time-code` autofill all keep working
 * against a single field value.
 */
export function OtpBoxes({ busy = false, label, hint, onComplete }: Props) {
  const [digits, setDigits] = useState<string[]>(() => Array(LENGTH).fill(""));
  const [focused, setFocused] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  // A ref, not state: re-rendering on submit must not let a second Enter
  // re-fire the parent while it is still verifying.
  const submitting = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const activeIndex = useMemo(() => {
    const next = digits.findIndex((d) => d === "");
    return next === -1 ? LENGTH - 1 : next;
  }, [digits]);

  const complete = (code: string) => {
    if (submitting.current) return;
    submitting.current = true;
    Promise.resolve(onComplete(code)).finally(() => {
      submitting.current = false;
    });
  };

  function commit(next: string[]) {
    setDigits(next);
    if (next.every((d) => d !== "")) complete(next.join(""));
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const cleaned = e.target.value.replace(/\D/g, "").slice(0, LENGTH).split("");
    commit(Array.from({ length: LENGTH }, (_, i) => cleaned[i] ?? ""));
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const cleaned = e.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, LENGTH)
      .split("");
    commit(Array.from({ length: LENGTH }, (_, i) => cleaned[i] ?? ""));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && digits.every((d) => d !== "")) {
      e.preventDefault();
      complete(digits.join(""));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="otp-code" className="text-[0.8125rem] font-medium text-ink">
        {label}
      </label>

      <div className="relative">
        <input
          ref={inputRef}
          id="otp-code"
          name="otp"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={LENGTH}
          value={digits.join("")}
          disabled={busy}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />

        <div aria-hidden className="flex justify-between gap-1.5 sm:gap-2.5">
          {digits.map((digit, i) => (
            <span
              key={i}
              className={cn(
                "flex h-14 flex-1 items-center justify-center rounded-xl border bg-paper/70 font-mono text-[1.375rem] text-ink-deep transition-[border-color,box-shadow,background-color] duration-200 sm:h-16",
                digit
                  ? "border-ink/25 bg-paper"
                  : "border-line",
                focused &&
                  i === activeIndex &&
                  "border-brass/60 shadow-[0_0_0_3px_rgba(201,162,75,0.16)]",
                busy && "opacity-50",
              )}
            >
              {digit}
            </span>
          ))}
        </div>
      </div>

      {hint ? <p className="text-[0.75rem] text-muted">{hint}</p> : null}
    </div>
  );
}
