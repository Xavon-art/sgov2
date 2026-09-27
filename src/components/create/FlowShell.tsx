"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ShaderField from "@/components/fx/ShaderField";
import { FloatingField, type FloatingChip } from "@/components/fx/FloatingField";
import { Wordmark } from "@/components/ui/Seal";
import { IconClose, IconPyramid } from "@/components/ui/Icons";
import { STEPS, stepIndex } from "@/lib/steps";
import { cn } from "@/lib/utils";

const AMBIENT_CHIPS: FloatingChip[] = [
  {
    id: "a-usg",
    label: "USG",
    sub: "oversight",
    icon: <IconPyramid />,
    left: 4,
    top: 18,
    depth: 1,
    drift: "wide",
    duration: 19,
    scale: 0.9,
    delayIn: 0.4,
  },
  {
    id: "a-lsg",
    label: "LSG · Engineering",
    sub: "connected",
    icon: <IconPyramid />,
    left: 88,
    top: 30,
    depth: 0.8,
    drift: "soft",
    duration: 22,
    scale: 0.88,
    delayIn: 0.55,
  },
  {
    id: "a-file",
    label: "Records secured",
    sub: "searchable",
    icon: <IconPyramid />,
    left: 8,
    top: 74,
    depth: 0.65,
    drift: "soft",
    duration: 17,
    scale: 0.86,
    delayIn: 0.7,
  },
];

export function FlowShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const active = STEPS.find((s) => s.path === pathname) ?? STEPS[0];
  const index = stepIndex(active.id);
  const progress = ((index + 1) / STEPS.length) * 100;

  return (
    <div className="relative isolate flex min-h-dvh flex-col">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <ShaderField strength={0.34} scale={1.25} speed={0.02} />
        <div className="absolute inset-0 bg-gradient-to-b from-canvas/70 via-canvas/55 to-canvas/90" />
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <FloatingField
          chips={AMBIENT_CHIPS}
          range={14}
          hideBelow="lg"
          className="opacity-45"
        />
      </div>

      <header className="sticky top-0 z-40 border-b border-line/80 bg-canvas/78 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex h-16 max-w-[76rem] items-center gap-4 px-5 sm:px-8">
          <Link
            href="/"
            aria-label="Back to SmartGov home"
            className="rounded-lg transition-opacity duration-300 hover:opacity-75"
          >
            <Wordmark compact />
          </Link>

          <span aria-hidden className="hidden h-4 w-px bg-line sm:block" />
          <p className="hidden text-[0.6875rem] font-semibold tracking-[0.2em] text-ink-muted uppercase sm:block">
            Organization Setup
          </p>

          <div className="ml-auto flex items-center gap-3 sm:gap-4">
            <p className="text-[0.75rem] tabular-nums text-muted">
              Step{" "}
              <span className="font-semibold text-ink">{index + 1}</span> of{" "}
              {STEPS.length}
              <span className="hidden sm:inline"> · {active.label}</span>
            </p>
            <Link
              href="/"
              aria-label="Exit setup"
              className="grid size-8 place-items-center rounded-full border border-line text-muted transition-colors duration-300 hover:border-line-strong hover:text-ink"
            >
              <IconClose className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        <div className="h-px w-full bg-line/80">
          <div
            className="h-full bg-gradient-to-r from-ink via-ink-soft to-brass transition-[width] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{ width: `${progress}%` }}
          />
        </div>

        <ol className="mx-auto hidden max-w-[76rem] items-center gap-1.5 px-8 py-2.5 lg:flex">
          {STEPS.map((step, i) => {
            const done = i < index;
            const current = i === index;
            return (
              <li key={step.id} className="flex flex-1 items-center gap-1.5">
                <span
                  className={cn(
                    "h-1 flex-1 rounded-full transition-colors duration-500",
                    current
                      ? "bg-brass"
                      : done
                        ? "bg-ink/35"
                        : "bg-line-strong",
                  )}
                />
                <span
                  className={cn(
                    "text-[0.5625rem] font-semibold tracking-[0.12em] uppercase transition-colors duration-500",
                    current
                      ? "text-ink"
                      : done
                        ? "text-ink-muted"
                        : "text-faint",
                  )}
                >
                  {step.short}
                </span>
              </li>
            );
          })}
        </ol>
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}
