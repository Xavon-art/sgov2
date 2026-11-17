"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/ui/Seal";
import { ButtonLink } from "@/components/ui/Button";
import { IconArrowRight, IconClose, IconMenu } from "@/components/ui/Icons";
import { cn } from "@/lib/utils";

const LINKS = [
  { label: "Product", href: "#features" },
  { label: "How it Works", href: "#governance" },
  { label: "For Universities", href: "#universities" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header
      data-tour="landing-nav"
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-[background-color,border-color,backdrop-filter,box-shadow] duration-500",
        scrolled
          ? "border-b border-line/80 bg-canvas/72 shadow-[0_1px_24px_-18px_rgba(13,33,53,0.5)] backdrop-blur-xl backdrop-saturate-150"
          : "border-b border-transparent",
      )}
    >
      <nav
        aria-label="Primary"
        className="mx-auto flex h-[4.25rem] max-w-[82rem] items-center justify-between gap-6 px-5 sm:px-8"
      >
        <Link
          href="/"
          className="rounded-lg transition-opacity duration-300 hover:opacity-80"
          aria-label="SmartGov home"
        >
          <Wordmark />
        </Link>

        <ul className="hidden items-center gap-8 md:flex">
          {LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="group relative text-[0.875rem] font-medium text-ink-soft transition-colors duration-300 hover:text-ink"
              >
                {link.label}
                <span className="absolute -bottom-1 left-0 h-px w-full origin-left scale-x-0 bg-gradient-to-r from-brass to-brass/0 transition-transform duration-400 ease-out group-hover:scale-x-100" />
              </a>
            </li>
          ))}
          <li>
            <Link
              href="/login"
              className="group relative text-[0.875rem] font-medium text-ink-soft transition-colors duration-300 hover:text-ink"
            >
              Log in
              <span className="absolute -bottom-1 left-0 h-px w-full origin-left scale-x-0 bg-gradient-to-r from-brass to-brass/0 transition-transform duration-400 ease-out group-hover:scale-x-100" />
            </Link>
          </li>
        </ul>

        <div className="flex items-center gap-2.5">
          {/* Visibility lives on this wrapper, not on the button: the button's own
              `inline-flex` base class wins the cascade over a `hidden` utility. */}
          <div className="hidden sm:block">
            <ButtonLink
              href="/create"
              size="sm"
              variant={scrolled ? "primary" : "outline"}
            >
              Create Your Student Org
              <IconArrowRight className="h-4 w-4 transition-transform duration-400 group-hover:translate-x-0.5" />
            </ButtonLink>
          </div>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            className="grid size-10 place-items-center rounded-full border border-line text-ink transition-colors hover:border-line-strong md:hidden"
          >
            {open ? (
              <IconClose className="h-4.5 w-4.5" />
            ) : (
              <IconMenu className="h-4.5 w-4.5" />
            )}
          </button>
        </div>
      </nav>

      <div
        className={cn(
          "overflow-hidden border-line/70 bg-canvas/95 backdrop-blur-xl transition-[max-height,opacity] duration-500 ease-out md:hidden",
          open ? "max-h-[22rem] opacity-100" : "max-h-0 opacity-0",
        )}
      >
        <ul className="flex flex-col gap-1 px-5 pt-2 pb-5">
          {LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                onClick={() => setOpen(false)}
                className="block rounded-lg px-3 py-2.5 text-[0.9375rem] font-medium text-ink transition-colors hover:bg-ink/[0.04]"
              >
                {link.label}
              </a>
            </li>
          ))}
          <li>
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2.5 text-[0.9375rem] font-medium text-ink transition-colors hover:bg-ink/[0.04]"
            >
              Log in
            </Link>
          </li>
          <li>
            <ButtonLink
              href="/create"
              className="mt-3 w-full"
              onClick={() => setOpen(false)}
            >
              Create Your Student Org
              <IconArrowRight className="h-4 w-4" />
            </ButtonLink>
          </li>
        </ul>
      </div>
    </header>
  );
}
