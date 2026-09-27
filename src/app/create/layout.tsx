"use client";

import { FlowShell } from "@/components/create/FlowShell";
import { useDraftHydrated } from "@/lib/useDraftHydrated";

export default function CreateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The draft lives in sessionStorage. Hold the step body until it rehydrates
  // so the server markup and the first client render always match.
  const hydrated = useDraftHydrated();

  return (
    <FlowShell>
      {hydrated ? children : <div className="min-h-[60vh]" aria-hidden />}
    </FlowShell>
  );
}
