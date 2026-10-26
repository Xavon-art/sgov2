"use client";

import { MessagesPanel } from "@/components/dashboard/MessagesPanel";

export default function LsgMessagesPage() {
  return (
    <section className="mx-auto w-full max-w-5xl">
      <header className="border-b border-line/80 pb-4">
        <p className="eyebrow">Messages</p>
        <h1 className="mt-1 text-[1.5rem] leading-tight sm:text-[1.75rem]">Inbox</h1>
        <p className="mt-1 max-w-prose text-[0.9375rem] leading-relaxed text-body">
          Conversations with officers in your organization.
        </p>
      </header>
      <div className="mt-6">
        <MessagesPanel />
      </div>
    </section>
  );
}