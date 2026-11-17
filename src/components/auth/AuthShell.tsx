"use client";

import type { ReactNode } from "react";
import ShaderField from "@/components/fx/ShaderField";
import { Reveal } from "@/components/fx/Reveal";
import { Wordmark } from "@/components/ui/Seal";
import Link from "next/link";

/**
 * Shared frame for sign-in and the invitation steps: same shader field, same
 * type scale, and the same brass-on-navy accents the rest of the product uses.
 */
export function AuthShell({
  eyebrow,
  title,
  lede,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  lede?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div data-tour="auth-shell" className="relative isolate flex min-h-dvh flex-col">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <ShaderField strength={0.45} scale={1.2} speed={0.02} />
        <div className="absolute inset-0 bg-gradient-to-b from-canvas/85 via-canvas/75 to-canvas" />
      </div>

      <header className="border-b border-line/70 bg-canvas/60 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[82rem] items-center gap-4 px-5 sm:px-8">
          <Link href="/" aria-label="SmartGov home">
            <Wordmark compact />
          </Link>
          <span aria-hidden className="hidden h-4 w-px bg-line sm:block" />
          <p className="hidden text-[0.8125rem] font-medium text-ink-soft sm:block">
            Secure access
          </p>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 items-center px-5 py-12 sm:px-8 sm:py-16">
        <Reveal className="w-full">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="mt-3 text-[1.75rem] leading-tight sm:text-[2rem]">{title}</h1>
          {lede ? (
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-body">{lede}</p>
          ) : null}

          <div className="mt-8">{children}</div>

          {footer ? <div className="mt-8">{footer}</div> : null}
        </Reveal>
      </main>
    </div>
  );
}
