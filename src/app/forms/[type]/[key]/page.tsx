import { Suspense } from "react";
import type { Metadata } from "next";
import { PublicFeedbackForm } from "@/components/dashboard/PublicFeedbackForm";
import { SurveyPublicForm } from "@/components/forms/SurveyPublicForm";
import { Wordmark } from "@/components/ui/Seal";
import { getPublicFeedbackForm, type PublicFormResult } from "@/lib/feedback-forms";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Form",
  description: "Respond to a published SmartGov form.",
  robots: { index: false, follow: false },
};

type PageProps = { params: Promise<{ type: string; key: string }> };

export default async function PublicFormPage({ params }: PageProps) {
  const { type, key } = await params;

  let label = "Form";
  let body: React.ReactNode;

  if (type === "survey") {
    label = "Survey";
    body = (
      <Suspense fallback={null}>
        <SurveyPublicForm id={key} />
      </Suspense>
    );
  } else if (type === "feedback") {
    label = "Feedback";
    let initial: PublicFormResult;
    try {
      initial = await getPublicFeedbackForm(key);
    } catch {
      initial = { ok: false, reason: "unavailable" };
    }
    body = <PublicFeedbackForm slug={key} initial={initial} />;
  } else {
    body = (
      <div className="mx-auto max-w-2xl px-5 py-12 text-center">
        <h1 className="text-[1.5rem] font-semibold text-ink">Form unavailable</h1>
        <p className="mt-2 text-[0.9375rem] text-body">This form link is not valid.</p>
      </div>
    );
  }

  return (
    <main
      data-testid="public-form-page"
      className="relative flex min-h-dvh flex-col overflow-hidden bg-canvas"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(ellipse_at_top,rgba(201,162,75,0.16),transparent_65%)]"
      />
      <header className="relative z-10 mx-auto flex w-full max-w-3xl items-center justify-between px-5 py-6 sm:px-8">
        <Wordmark compact />
        <span className="text-[0.625rem] font-semibold uppercase tracking-[0.22em] text-ink-muted">
          {label}
        </span>
      </header>

      <div className="relative z-10 mx-auto w-full max-w-3xl flex-1 px-4 pb-12 pt-4 sm:px-8 sm:pt-8">
        {body}
      </div>

      <footer className="relative z-10 mx-auto w-full max-w-3xl px-5 pb-8 text-center text-xs leading-relaxed text-ink-muted">
        Responses are recorded securely in SmartGov. This page does not require
        a SmartGov account.
      </footer>
    </main>
  );
}
