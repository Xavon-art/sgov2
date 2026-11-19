"use client";

import { useState } from "react";
import { FeedbackPanel } from "@/components/dashboard/FeedbackPanel";
import { FeedbackFormsPanel } from "@/components/dashboard/FeedbackFormsPanel";
import { FeedbackResponsesPanel } from "@/components/dashboard/FeedbackResponsesPanel";
import { FeedbackAnswerPanel } from "@/components/dashboard/FeedbackAnswerPanel";

const TABS = ["forms", "responses", "answer", "messages"] as const;
type Tab = (typeof TABS)[number];

const LABELS: Record<Tab, string> = {
  forms: "Forms",
  responses: "Responses",
  answer: "Answer",
  messages: "Direct messages",
};

export function FeedbackWorkspace({ side }: { side: "usg" | "lsg" }) {
  const [tab, setTab] = useState<Tab>("forms");

  return (
    <section data-testid="feedback-workspace" className="grid gap-5">
      <div className="flex flex-wrap gap-1">
        {TABS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={`rounded-full px-3 py-1.5 text-sm transition-colors duration-200 ${
              tab === value
                ? "bg-ink text-canvas"
                : "border border-line text-ink hover:border-line-strong"
            }`}
            onClick={() => setTab(value)}
          >
            {LABELS[value]}
          </button>
        ))}
      </div>

      {tab === "forms" ? <FeedbackFormsPanel side={side} /> : null}
      {tab === "responses" ? <FeedbackResponsesPanel /> : null}
      {tab === "answer" ? <FeedbackAnswerPanel /> : null}
      {tab === "messages" ? (
        <FeedbackPanel mode={side === "usg" ? "review" : "submit"} />
      ) : null}
    </section>
  );
}
