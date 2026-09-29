import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "emerald" | "secondary" | "danger" | "ghost";

const variants: Record<Variant, string> = {
  primary:
    "bg-ink text-white border-ink hover:bg-ink-deep hover:border-ink-deep shadow-[0_1px_0_rgba(255,255,255,0.14)_inset,0_10px_30px_-14px_rgba(13,33,53,0.6)]",
  emerald:
    "bg-brass text-ink-deep border-brass hover:bg-[#d8b463] hover:border-[#d8b463] shadow-[0_1px_0_rgba(255,255,255,0.4)_inset,0_10px_30px_-14px_rgba(168,130,47,0.7)]",
  secondary:
    "bg-paper text-ink border-line hover:border-line-strong hover:shadow-lift",
  danger:
    "bg-transparent text-[#a5442c] border-[#d9a99c] hover:bg-[#a5442c]/[0.06]",
  ghost: "bg-transparent text-ink-soft border-transparent hover:text-ink hover:bg-ink/[0.045]",
};

export function Button({
  children,
  variant = "primary",
  className,
  ...rest
}: {
  children: ReactNode;
  variant?: Variant;
  className?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-[transform,background-color,border-color,box-shadow,color] duration-300 ease-out active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 ${variants[variant]} ${className ?? ""}`}
    >
      {children}
    </button>
  );
}