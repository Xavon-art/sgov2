import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Reveal } from "@/components/fx/Reveal";

export function Section({
  id,
  eyebrow,
  title,
  lede,
  children,
  className,
  align = "left",
  tone = "canvas",
}: {
  id?: string;
  eyebrow?: string;
  title?: ReactNode;
  lede?: ReactNode;
  children: ReactNode;
  className?: string;
  align?: "left" | "center";
  tone?: "canvas" | "paper" | "sunk";
}) {
  const bg =
    tone === "paper"
      ? "bg-paper"
      : tone === "sunk"
        ? "bg-canvas-sunk"
        : "bg-canvas";

  return (
    <section
      id={id}
      className={cn("relative scroll-mt-20 py-24 sm:py-28 lg:py-32", bg, className)}
    >
      <div className="mx-auto max-w-[82rem] px-5 sm:px-8">
        {(eyebrow || title || lede) && (
          <Reveal
            className={cn(
              "max-w-2xl",
              align === "center" && "mx-auto text-center",
            )}
          >
            {eyebrow ? (
              <p className="eyebrow flex items-center gap-3">
                <span aria-hidden className="h-px w-6 bg-brass" />
                {eyebrow}
                {align === "center" ? (
                  <span aria-hidden className="h-px w-6 bg-brass" />
                ) : null}
              </p>
            ) : null}
            {title ? (
              <h2 className="mt-5 text-[2rem] leading-[1.1] sm:text-[2.5rem] lg:text-[2.875rem]">
                {title}
              </h2>
            ) : null}
            {lede ? (
              <p className="mt-5 text-[1.0625rem] leading-relaxed text-body">
                {lede}
              </p>
            ) : null}
          </Reveal>
        )}
        {children}
      </div>
    </section>
  );
}
