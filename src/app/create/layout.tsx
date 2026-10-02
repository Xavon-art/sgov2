"use client";

import { FlowShell } from "@/components/create/FlowShell";

export default function CreateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Nothing is rehydrated here any more, so the step body renders straight away.
  return <FlowShell>{children}</FlowShell>;
}
