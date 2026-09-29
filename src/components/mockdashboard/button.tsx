import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "emerald" | "secondary" | "danger" | "ghost";

const variants: Record<Variant, string> = {
  primary:
    "bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 disabled:bg-indigo-300",
  emerald:
    "bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 disabled:bg-emerald-300",
  secondary:
    "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:text-slate-300",
  danger:
    "bg-white text-rose-600 ring-1 ring-inset ring-rose-200 hover:bg-rose-50 disabled:text-rose-300",
  ghost: "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
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
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${variants[variant]} ${className ?? ""}`}
    >
      {children}
    </button>
  );
}