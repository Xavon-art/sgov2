"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { IconCheckCircle } from "@/components/ui/Icons";
import type {
  FeedbackQuestion,
  PublicFeedbackFormData,
  PublicFormResult,
} from "@/lib/feedback-forms";

type Phase = "loading" | "invalid" | "closed" | "error" | "form" | "submitted";

const inputClass =
  "h-12 w-full rounded-xl border border-line bg-paper px-3.5 text-[0.9375rem] text-ink-deep outline-none transition-[border-color,box-shadow,background-color] duration-300 hover:border-line-strong focus:border-ink/25 focus:bg-paper";

const textareaClass =
  "min-h-28 w-full resize-y rounded-xl border border-line bg-paper px-3.5 py-3 text-[0.9375rem] leading-relaxed text-ink-deep outline-none transition-[border-color,box-shadow,background-color] duration-300 hover:border-line-strong focus:border-ink/25 focus:bg-paper";

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

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function domId(index: number, suffix?: string) {
  return suffix ? `feedback-q-${index}-${suffix}` : `feedback-q-${index}`;
}

function QuestionField({
  question,
  index,
  value,
  onChange,
}: {
  question: FeedbackQuestion;
  index: number;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const id = domId(index);
  const label = question.title.trim() || `Question ${index + 1}`;
  const describedBy = question.description
    ? `${id}-description`
    : undefined;

  const labelBlock = (
    <>
      <label htmlFor={id} className="block text-[0.9375rem] font-medium text-ink-deep">
        {label}
        {question.required ? (
          <>
            <span className="ml-1 text-brass-deep" aria-hidden="true">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        ) : null}
      </label>
      {question.description ? (
        <p id={`${id}-description`} className="mt-1 text-sm leading-relaxed text-ink-muted">
          {question.description}
        </p>
      ) : null}
    </>
  );

  if (question.qtype === "long_text") {
    return (
      <div>
        {labelBlock}
        <textarea
          id={id}
          className={`mt-3 ${textareaClass}`}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          required={question.required}
          aria-describedby={describedBy}
        />
      </div>
    );
  }

  if (question.qtype === "short_text") {
    return (
      <div>
        {labelBlock}
        <input
          id={id}
          type="text"
          className={`mt-3 ${inputClass}`}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          required={question.required}
          aria-describedby={describedBy}
        />
      </div>
    );
  }

  if (question.qtype === "date") {
    return (
      <div>
        {labelBlock}
        <input
          id={id}
          type="date"
          className={`mt-3 ${inputClass}`}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          required={question.required}
          aria-describedby={describedBy}
        />
      </div>
    );
  }

  if (question.qtype === "time") {
    return (
      <div>
        {labelBlock}
        <input
          id={id}
          type="time"
          className={`mt-3 ${inputClass}`}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          required={question.required}
          aria-describedby={describedBy}
        />
      </div>
    );
  }

  if (question.qtype === "checkbox") {
    const selected = Array.isArray(value) ? value.map(String) : [];
    return (
      <fieldset aria-describedby={describedBy} aria-required={question.required}>
        <legend className="block text-[0.9375rem] font-medium text-ink-deep">
          {label}
          {question.required ? (
            <>
              <span className="ml-1 text-brass-deep" aria-hidden="true">
                *
              </span>
              <span className="sr-only"> (required)</span>
            </>
          ) : null}
        </legend>
        {question.description ? (
          <p id={`${id}-description`} className="mt-1 text-sm leading-relaxed text-ink-muted">
            {question.description}
          </p>
        ) : null}
        <div className="mt-3 grid gap-2">
          {question.options.map((option, optionIndex) => {
            const optionId = domId(index, String(optionIndex));
            const checked = selected.includes(option);
            return (
              <label
                key={optionId}
                htmlFor={optionId}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-paper px-3.5 py-3 text-[0.9375rem] text-ink-deep transition-colors duration-200 hover:border-line-strong"
              >
                <input
                  id={optionId}
                  type="checkbox"
                  className="mt-0.5 size-4 accent-[var(--color-brass-deep)]"
                  checked={checked}
                  onChange={() => {
                    onChange(
                      checked
                        ? selected.filter((item) => item !== option)
                        : [...selected, option],
                    );
                  }}
                />
                <span>{option}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
    );
  }

  if (question.qtype === "multiple_choice" || question.qtype === "dropdown") {
    return (
      <div>
        {labelBlock}
        <select
          id={id}
          className={`mt-3 ${inputClass}`}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          required={question.required}
          aria-describedby={describedBy}
        >
          <option value="">Select an option</option>
          {question.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (question.qtype === "rating") {
    const current = typeof value === "number" ? value : Number(value) || 0;
    return (
      <div>
        {labelBlock}
        <select
          id={id}
          className={`mt-3 ${inputClass}`}
          value={current > 0 ? String(current) : ""}
          onChange={(event) =>
            onChange(event.target.value ? Number(event.target.value) : "")
          }
          required={question.required}
          aria-describedby={describedBy}
        >
          <option value="">Select a rating</option>
          {[1, 2, 3, 4, 5].map((score) => (
            <option key={score} value={score}>
              {score} of 5
            </option>
          ))}
        </select>
      </div>
    );
  }

  const min = question.scaleMin ?? 1;
  const max = question.scaleMax && question.scaleMax > min ? question.scaleMax : 5;
  const current = typeof value === "number" ? value : Number(value) || 0;
  const scaleValues = Array.from({ length: max - min + 1 }, (_, offset) => min + offset);
  return (
    <div>
      {labelBlock}
      <select
        id={id}
        className={`mt-3 ${inputClass}`}
        value={current > 0 ? String(current) : ""}
        onChange={(event) =>
          onChange(event.target.value ? Number(event.target.value) : "")
        }
        required={question.required}
        aria-describedby={describedBy}
      >
        <option value="">Select a value</option>
        {scaleValues.map((score) => (
          <option key={score} value={score}>
            {score}
          </option>
        ))}
      </select>
      {question.scaleLabelLow || question.scaleLabelHigh ? (
        <div className="mt-2 flex justify-between gap-4 text-xs text-ink-muted">
          <span>{question.scaleLabelLow ?? min}</span>
          <span className="text-right">{question.scaleLabelHigh ?? max}</span>
        </div>
      ) : null}
    </div>
  );
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
      if (isBlank(value)) {
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
      (question) => question.required && isBlank(answers[question.id]),
    );
    if (missing) {
      setError(`Please answer "${missing.title.trim() || "the required question"}".`);
      return;
    }

    let name: string | null = null;
    let email: string | null = null;
    if (form.identityMode === "identified") {
      name = respondentName.trim();
      email = respondentEmail.trim().toLowerCase();
      if (name.length < 2) {
        setError("Enter your full name (at least 2 characters).");
        return;
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) {
        setError("Enter a valid email address.");
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
      <header>
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
            : "This form asks for your name and email so the organizer can follow up."}
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
              className={`mt-3 ${inputClass}`}
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
              className={`mt-3 ${inputClass}`}
              value={respondentEmail}
              onChange={(event) => setRespondentEmail(event.target.value)}
              maxLength={200}
              autoComplete="email"
              required
            />
          </div>
        </section>
      ) : null}

      <div className="mt-8 grid gap-7 border-t border-line pt-8">
        {form.questions.map((question, index) => (
          <QuestionField
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

      <div className="mt-8 flex flex-col gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
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
