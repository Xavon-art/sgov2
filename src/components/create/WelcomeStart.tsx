"use client";

import { ButtonLink } from "@/components/ui/Button";
import { IconArrowRight } from "@/components/ui/Icons";

export function StartButton() {
  return (
    <div className="flex justify-center">
      <ButtonLink href="/create/governance-model" size="lg" className="w-full sm:w-auto">
        Begin setup
        <IconArrowRight className="h-4.5 w-4.5 transition-transform duration-500 group-hover:translate-x-1" />
      </ButtonLink>
    </div>
  );
}
