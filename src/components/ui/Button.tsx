"use client";

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

const variants = {
  primary:
    "bg-ink text-white border-ink hover:bg-ink-deep hover:border-ink-deep shadow-[0_1px_0_rgba(255,255,255,0.14)_inset,0_10px_30px_-14px_rgba(13,33,53,0.6)]",
  brass:
    "bg-brass text-ink-deep border-brass hover:bg-[#d8b463] hover:border-[#d8b463] shadow-[0_1px_0_rgba(255,255,255,0.4)_inset,0_10px_30px_-14px_rgba(168,130,47,0.7)]",
  outline:
    "bg-transparent text-ink border-line-strong hover:border-ink/40 hover:bg-ink/[0.035]",
  ghost: "bg-transparent text-ink-soft border-transparent hover:text-ink hover:bg-ink/[0.045]",
  paper:
    "bg-paper text-ink border-line hover:border-line-strong hover:shadow-lift",
} as const;

const sizes = {
  sm: "h-9 px-3.5 text-[0.8125rem] gap-1.5",
  md: "h-11 px-5 text-[0.9375rem] gap-2",
  lg: "h-[3.25rem] px-7 text-base gap-2.5",
} as const;

export type ButtonVariant = keyof typeof variants;
export type ButtonSize = keyof typeof sizes;

const base =
  "group relative inline-flex select-none items-center justify-center whitespace-nowrap rounded-full border font-medium transition-[transform,background-color,border-color,box-shadow,color] duration-300 ease-out active:translate-y-px disabled:pointer-events-none disabled:opacity-45 cursor-pointer";

function classes(variant: ButtonVariant, size: ButtonSize, className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
) {
  return classes(variant, size, className);
}

type SharedProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: SharedProps & ComponentProps<"button">) {
  return (
    <button {...rest} className={classes(variant, size, className)}>
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: SharedProps & ComponentProps<typeof Link>) {
  return (
    <Link {...rest} className={classes(variant, size, className)}>
      {children}
    </Link>
  );
}
