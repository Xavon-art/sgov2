"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { IconCheckCircle } from "@/components/ui/Icons";
import {
  FeedbackQuestionField,
  feedbackInputClass,
  isBlankAnswer,
} from "@/components/dashboard/FeedbackQuestionFields";
import type {
  PublicFeedbackFormData,
  PublicFormResult,
} from "@/lib/feedback-forms";

type Phase = "loading" | "invalid" | "closed" | "error" | "form" | "submitted";

function phaseFromInitial(initial?: PublicFormResult): Phase {
  if (!initial) return "loading";
  if (initial.ok && initial.form) return "form";
  if (initial.reason === "form_not_open") return "closed";
  if (initial.reason === "invalid_slug" || initial.reason === "not_found") {
    return "invalid";
  }
  return "error";
}

function errorMessage(json: Record<string, unknown>, fallback: string) {
  return typeof json.message === "string" && json.message.trim()
    ? json.message
    : fallback;
}

export function PublicFeedbackForm({
  slug,
  initial,
}: {
  slug: string;
  initial?: PublicFormResult;
}) {
  const [phase, setPhase] = useState<Phase>(() => phaseFromInitial(initial));
  const [form, setForm] = useState<PublicFeedbackFormData | null>(
    initial?.ok && initial.form ? initial.form : null,
  );
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [respondentName, setRespondentName] = useState("");
  const [respondentEmail, setRespondentEmail] = useState("");
  const [respondentYear, setRespondentYear] = useState("");
  const [respondentSection, setRespondentSection] = useState("");
  const [respondentCourse, setRespondentCourse] = useState("");
  const [respondentDepartmentOrCampus, setRespondentDepartmentOrCampus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setPhase("loading");
    setError(null);
    try {
      const response = await fetch(
        `/api/feedback/public/${encodeURIComponent(slug)}`,
        { cache: "no-store" },
      );
      const json = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (json.ok === true && json.form) {
        setForm(json.form as PublicFeedbackFormData);
        setPhase("form");
        return;
      }
      if (json.reason === "form_not_open") {
        setPhase("closed");
        return;
      }
      if (json.reason === "invalid_slug" || json.reason === "not_found") {
        setPhase("invalid");
        return;
      }
      setError(errorMessage(json, "We could not load this feedback form."));
      setPhase("error");
    } catch {
      setError("We could not load this feedback form.");
      setPhase("error");
    }
  }, [slug]);

  useEffect(() => {
    if (initial) return;
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [initial, load]);

  const setAnswer = (id: string, value: unknown) => {
    setAnswers((previous) => {
      const next = { ...previous };
      if (isBlankAnswer(value)) {
        delete next[id];
      } else {
        next[id] = value;
      }
      return next;
    });
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form || busy) return;

    const missing = form.questions.find(
      (question) => question.required && isBlankAnswer(answers[question.id]),
    );
    if (missing) {
      setError(`Please answer "${missing.title.trim() || "the required question"}".`);
      return;
    }

    let name: string | null = null;
    let email: string | null = null;
    let year: string | null = null;
    let section: string | null = null;
    let course: string | null = null;
    let department: string | null = null;
    if (form.identityMode === "identified") {
      name = respondentName.trim();
      email = respondentEmail.trim().toLowerCase();
      year = respondentYear.trim();
      section = respondentSection.trim();
      course = respondentCourse.trim();
      department = respondentDepartmentOrCampus.trim();
      if (name.length < 2) {
        setError("Enter your full name (at least 2 characters).");
        return;
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) {
        setError("Enter a valid email address.");
        return;
      }
      if (!year || !section || !course || !department) {
        setError(
          "Enter your year and section, course, and department or campus.",
        );
        return;
      }
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/feedback/public/${encodeURIComponent(slug)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            answers,
            respondentName: name,
            respondentEmail: email,
            respondentYear: year,
            respondentSection: section,
            respondentCourse: course,
            respondentDepartmentOrCampus: department,
          }),
        },
      );
      const json = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (json.ok === true) {
        setPhase("submitted");
        return;
      }
      if (json.reason === "form_not_open") {
        setPhase("closed");
        return;
      }
      if (json.reason === "invalid_slug" || json.reason === "not_found") {
        setPhase("invalid");
        return;
      }
      setError(errorMessage(json, "We could not record your response."));
    } catch {
      setError("We could not record your response. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (phase === "loading") {
    return (
      <div
        data-testid="public-feedback-form-loading"
        className="paper rounded-3xl px-6 py-16 text-center"
      >
        <div className="mx-auto size-8 animate-spin rounded-full border-2 border-line border-t-brass-deep" />
        <p className="mt-4 text-sm text-ink-muted">Loading feedback form...</p>
      </div>
    );
  }

  if (phase === "invalid") {
    return (
      <div
        data-testid="public-feedback-form-invalid"
        className="paper rounded-3xl px-6 py-14 text-center sm:px-10"
      >
        <h1 className="font-display text-2xl font-medium text-ink-deep">
          This feedback link is not valid.
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-muted">
          The link may have been mistyped, or the form may have been replaced.
          Ask the organizer for a current link.
        </p>
      </div>
    );
  }

  if (phase === "closed") {
    return (
      <div
        data-testid="public-feedback-form-closed"
        className="paper rounded-3xl px-6 py-14 text-center sm:px-10"
      >
        <h1 className="font-display text-2xl font-medium text-ink-deep">
          This form is not accepting responses.
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-muted">
          The organizer has closed this form. Thank you for checking.
        </p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div
        data-testid="public-feedback-form-error"
        className="paper rounded-3xl px-6 py-14 text-center sm:px-10"
      >
        <h1 className="font-display text-2xl font-medium text-ink-deep">
          We could not load this form.
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-muted">
          {error ?? "Please check your connection and try again."}
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-6"
          onClick={() => void load()}
        >
          Try again
        </Button>
      </div>
    );
  }

  if (phase === "submitted") {
    return (
      <div
        data-testid="public-feedback-form-submitted"
        className="paper rounded-3xl px-6 py-14 text-center sm:px-10"
        role="status"
      >
        <span className="mx-auto flex size-14 items-center justify-center rounded-full border border-brass/35 bg-brass-soft/30 text-brass-deep">
          <IconCheckCircle />
        </span>
        <h1 className="mt-5 font-display text-2xl font-medium text-ink-deep">
          Response recorded
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-muted">
          Your response was recorded. Thank you for taking the time to share
          feedback. You can close this page.
        </p>
      </div>
    );
  }

  if (!form) return null;

  return (
    <form
      data-testid="public-feedback-form"
      className="paper rounded-3xl px-5 py-8 sm:px-8 sm:py-10"
      onSubmit={submit}
      noValidate
    >
      <header data-tour="public-feedback-intro">
        <h1 className="font-display text-3xl font-medium tracking-[-0.02em] text-ink-deep">
          {form.title}
        </h1>
        {form.description ? (
          <p className="mt-3 whitespace-pre-line text-[0.9375rem] leading-relaxed text-ink-muted">
            {form.description}
          </p>
        ) : null}
        <p className="mt-5 rounded-xl border border-line bg-canvas-sunk/60 px-3.5 py-3 text-xs leading-relaxed text-ink-muted">
          {form.identityMode === "anonymous"
            ? "This form is anonymous. Your name and email are not recorded."
            : "This form asks for your name, student details, and email so the organizer can follow up."}
        </p>
      </header>

      {form.identityMode === "identified" ? (
        <section className="mt-8 grid gap-5 border-t border-line pt-8 sm:grid-cols-2">
          <div>
            <label
              htmlFor="feedback-respondent-name"
              className="text-[0.9375rem] font-medium text-ink-deep"
            >
              Full name
              <span className="ml-1 text-brass-deep" aria-hidden="true">
                *
              </span>
              <span className="sr-only"> (required)</span>
            </label>
            <input
              id="feedback-respondent-name"
              type="text"
              className={`mt-3 ${feedbackInputClass}`}
              value={respondentName}
              onChange={(event) => setRespondentName(event.target.value)}
              maxLength={120}
              autoComplete="name"
              required
            />
          </div>
          <div>
            <label
              htmlFor="feedback-respondent-email"
              className="text-[0.9375rem] font-medium text-ink-deep"
            >
              Email address
              <span className="ml-1 text-brass-deep" aria-hidden="true">
                *
              </span>
              <span className="sr-only"> (required)</span>
            </label>
            <input
              id="feedback-respondent-email"
              type="email"
              className={`mt-3 ${feedbackInputClass}`}
              value={respondentEmail}
              onChange={(event) => setRespondentEmail(event.target.value)}
              maxLength={200}
              autoComplete="email"
              required
            />
          </div>
          <div className="sm:col-span-2">
            <p className="text-[0.9375rem] font-medium text-ink-deep">
              Year and section
              <span className="ml-1 text-brass-deep" aria-hidden="true">
                *
              </span>
              <span className="sr-only"> (required)</span>
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <input
                id="feedback-respondent-year"
                name="respondentYear"
                type="text"
                placeholder="Year"
                className={feedbackInputClass}
                value={respondentYear}
                onChange={(event) => setRespondentYear(event.target.value)}
                maxLength={40}
                required
              />
              <input
                id="feedback-respondent-section"
                name="respondentSection"
                type="text"
                placeholder="Section"
                className={feedbackInputClass}
                value={respondentSection}
                onChange={(event) => setRespondentSection(event.target.value)}
                maxLength={40}
                required
              />
            </div>
          </div>
          <div>
            <label
              htmlFor="feedback-respondent-course"
              className="text-[0.9375rem] font-medium text-ink-deep"
            >
              Course
              <span className="ml-1 text-brass-deep" aria-hidden="true">
                *
              </span>
              <span className="sr-only"> (required)</span>
            </label>
            <input
              id="feedback-respondent-course"
              name="respondentCourse"
              type="text"
              className={`mt-3 ${feedbackInputClass}`}
              value={respondentCourse}
              onChange={(event) => setRespondentCourse(event.target.value)}
              maxLength={120}
              required
            />
          </div>
          <div>
            <label
              htmlFor="feedback-respondent-department"
              className="text-[0.9375rem] font-medium text-ink-deep"
            >
              Department or campus
              <span className="ml-1 text-brass-deep" aria-hidden="true">
                *
              </span>
              <span className="sr-only"> (required)</span>
            </label>
            <input
              id="feedback-respondent-department"
              name="respondentDepartmentOrCampus"
              type="text"
              className={`mt-3 ${feedbackInputClass}`}
              value={respondentDepartmentOrCampus}
              onChange={(event) =>
                setRespondentDepartmentOrCampus(event.target.value)
              }
              maxLength={120}
              required
            />
          </div>
        </section>
      ) : null}

      <div
        data-tour="public-feedback-questions"
        className="mt-8 grid gap-7 border-t border-line pt-8"
      >
        {form.questions.map((question, index) => (
          <FeedbackQuestionField
            key={question.id}
            question={question}
            index={index}
            value={answers[question.id]}
            onChange={(value) => setAnswer(question.id, value)}
          />
        ))}
      </div>

      {error ? (
        <p
          className="mt-7 rounded-xl border border-[#d9a99c] bg-[#a5442c]/[0.06] px-3.5 py-3 text-sm font-medium text-[#a5442c]"
          role="alert"
          aria-live="polite"
        >
          {error}
        </p>
      ) : null}

      <div
        data-tour="public-feedback-submit"
        className="mt-8 flex flex-col gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between"
      >
        <p className="text-xs text-ink-muted">
          Your response is recorded once you submit this form.
        </p>
        <Button type="submit" disabled={busy} className="sm:min-w-40">
          {busy ? "Submitting..." : "Submit response"}
        </Button>
      </div>
    </form>
  );
}
