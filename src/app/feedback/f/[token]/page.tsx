import type { Metadata } from "next";
import { PublicFeedbackForm } from "@/components/dashboard/PublicFeedbackForm";
import { Wordmark } from "@/components/ui/Seal";
import {
  getPublicFeedbackForm,
  type PublicFormResult,
} from "@/lib/feedback-forms";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Feedback",
  description: "Share feedback with your student government.",
  robots: { index: false, follow: false },
};

type PageProps = { params: Promise<{ token: string }> };

export default async function PublicFeedbackPage({ params }: PageProps) {
  const { token } = await params;

  let initial: PublicFormResult;
  try {
    initial = await getPublicFeedbackForm(token);
  } catch {
    initial = { ok: false, reason: "unavailable" };
  }

  return (
    <main
      data-testid="public-feedback-form-page"
      className="relative flex min-h-dvh flex-col overflow-hidden bg-canvas"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(ellipse_at_top,rgba(201,162,75,0.16),transparent_65%)]"
      />
      <header className="relative z-10 mx-auto flex w-full max-w-3xl items-center justify-between px-5 py-6 sm:px-8">
        <Wordmark compact />
        <span className="text-[0.625rem] font-semibold uppercase tracking-[0.22em] text-ink-muted">
          Feedback
        </span>
      </header>

      <div className="relative z-10 mx-auto w-full max-w-3xl flex-1 px-4 pb-12 pt-4 sm:px-8 sm:pt-8">
        <PublicFeedbackForm slug={token} initial={initial} />
      </div>

      <footer className="relative z-10 mx-auto w-full max-w-3xl px-5 pb-8 text-center text-xs leading-relaxed text-ink-muted sm:px-8">
        Responses are recorded securely in SmartGov. This page does not require
        a SmartGov account.
      </footer>
    </main>
  );
}
