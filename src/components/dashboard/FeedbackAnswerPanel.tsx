"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ActionError } from "@/components/dashboard/workspace-shared";
import {
  FeedbackQuestionField,
  isBlankAnswer,
} from "@/components/dashboard/FeedbackQuestionFields";
import { useDashboard } from "@/components/dashboard/dashboard-context";
import type { Account } from "@/lib/auth/session";
import type {
  FeedbackAvailableForm,
  FeedbackRespondForm,
} from "@/lib/feedback-forms";

function messageFrom(json: Record<string, unknown>, fallback: string) {
  return typeof json.message === "string" && json.message.trim()
    ? json.message
    : fallback;
}

function initialAnswers(form: FeedbackRespondForm, account: Account) {
  const next: Record<string, unknown> = {};
  if (form.identityMode !== "identified") return next;
  for (const question of form.questions) {
    if (question.fieldKey === "full_name") next[question.id] = account.displayName;
    if (question.fieldKey === "email") next[question.id] = account.email;
    if (question.fieldKey === "campus") {
      next[question.id] = account.campusName || account.universityName;
    }
  }
  return next;
}

export function FeedbackAnswerPanel() {
  const { account } = useDashboard();
  const [forms, setForms] = useState<FeedbackAvailableForm[]>([]);
  const [formId, setFormId] = useState("");
  const [form, setForm] = useState<FeedbackRespondForm | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const loadForms = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const response = await fetch("/api/feedback/available", {
        cache: "no-store",
      });
      const json = (await response.json()) as Record<string, unknown> & {
        forms?: FeedbackAvailableForm[];
      };
      if (!response.ok || json.ok !== true) {
        throw new Error(messageFrom(json, "We could not load the available forms."));
      }
      const nextForms = json.forms ?? [];
      setForms(nextForms);
      setFormId(nextForms[0]?.id ?? "");
      if (nextForms.length === 0) setState("ready");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "We could not load the available forms.",
      );
      setState("error");
    }
  }, []);

  const loadForm = useCallback(
    async (id: string) => {
      setState("loading");
      setError(null);
      setSubmitError(null);
      setSubmitted(false);
      try {
        const response = await fetch(`/api/feedback/forms/${id}/respond`, {
          cache: "no-store",
        });
        const json = (await response.json()) as Record<string, unknown> & {
          form?: FeedbackRespondForm;
        };
        if (!response.ok || json.ok !== true || !json.form) {
          throw new Error(messageFrom(json, "We could not load that form."));
        }
        setForm(json.form);
        setAnswers(initialAnswers(json.form, account));
        setState("ready");
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "We could not load that form.",
        );
        setState("error");
      }
    },
    [account],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadForms();
  }, [loadForms]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (formId) void loadForm(formId);
  }, [formId, loadForm]);

  const submit = async () => {
    if (!form) return;
    setSubmitError(null);
    const missing = form.questions.find(
      (question) => question.required && isBlankAnswer(answers[question.id]),
    );
    if (missing) {
      setSubmitError(`Please answer "${missing.title}".`);
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/feedback/forms/${form.id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers,
          respondentName: null,
          respondentEmail: null,
        }),
      });
      const json = (await response.json()) as Record<string, unknown> & {
        reason?: string;
      };
      if (!response.ok || json.ok !== true) {
        if (json.reason === "form_not_open") {
          throw new Error("This form is not accepting responses.");
        }
        if (json.reason === "rate_limited") {
          throw new Error("You have already reached the submission limit.");
        }
        throw new Error(messageFrom(json, "We could not record your response."));
      }
      setSubmitted(true);
    } catch (submitFailure) {
      setSubmitError(
        submitFailure instanceof Error
          ? submitFailure.message
          : "We could not record your response.",
      );
    } finally {
      setBusy(false);
    }
  };

  const selectedForm = forms.find((item) => item.id === formId) ?? null;

  if (submitted) {
    return (
      <section data-testid="feedback-answer-panel" className="grid gap-4">
        <div className="rounded-2xl border border-[#b6d2b0] bg-[#3f7d3a]/[0.08] px-5 py-8 text-center">
          <p className="font-display text-xl font-semibold text-ink-deep">
            Response recorded.
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            Thank you. Your answers were submitted.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-4"
            onClick={() => {
              setSubmitted(false);
              setAnswers({});
              if (formId) void loadForm(formId);
            }}
          >
            Answer another form
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section data-testid="feedback-answer-panel" className="grid gap-4">
      <div>
        <h2 className="font-display text-2xl font-semibold tracking-tight text-ink-deep">
          Answer a form
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Open feedback forms that your account can answer.
        </p>
      </div>

      <ActionError message={error} />

      {state === "loading" ? (
        <div className="grid gap-3">
          <div className="h-24 animate-pulse rounded-2xl bg-ink/[0.05]" />
          <div className="h-48 animate-pulse rounded-2xl bg-ink/[0.05]" />
        </div>
      ) : null}

      {state === "error" ? (
        <div className="rounded-2xl border border-line bg-paper p-5">
          <p className="text-sm text-ink-muted">
            We could not load the available forms.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => void loadForms()}
          >
            Try again
          </Button>
        </div>
      ) : null}

      {state === "ready" && forms.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-paper/60 px-5 py-10 text-center">
          <p className="text-sm font-medium text-ink-deep">
            No feedback forms are open for you right now.
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            Check back when your organization opens a form.
          </p>
        </div>
      ) : null}

      {state === "ready" && forms.length > 0 ? (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="grid min-w-56 gap-1.5">
            <span className="text-sm font-medium text-ink-deep">Form</span>
            <select
              className="h-12 w-full appearance-none rounded-xl border border-line bg-paper/70 px-3.5 text-[0.9375rem] text-ink-deep outline-none transition-[border-color,box-shadow,background-color] duration-300 hover:border-line-strong focus:border-ink/25 focus:bg-paper"
              value={formId}
              onChange={(event) => setFormId(event.target.value)}
            >
              {forms.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          {selectedForm ? (
            <p className="text-sm text-ink-muted">
              {selectedForm.questionCount} question
              {selectedForm.questionCount === 1 ? "" : "s"}
            </p>
          ) : null}
        </div>
      ) : null}

      {state === "ready" && form ? (
        <form
          className="grid gap-5 rounded-2xl border border-line bg-paper p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          noValidate
        >
          <div>
            <h3 className="font-display text-xl font-semibold text-ink-deep">
              {form.title}
            </h3>
            {form.description ? (
              <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                {form.description}
              </p>
            ) : null}
          </div>

          <div className="grid gap-6 border-t border-line pt-5">
            {form.questions.map((question, index) => (
              <FeedbackQuestionField
                key={question.id}
                question={question}
                index={index}
                value={answers[question.id]}
                onChange={(value) =>
                  setAnswers((current) => ({ ...current, [question.id]: value }))
                }
              />
            ))}
          </div>

          <ActionError message={submitError} />

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className="text-xs text-ink-muted">
              {form.identityMode === "identified"
                ? "Your name and email are taken from your account."
                : "This form is anonymous."}
            </p>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? "Submitting…" : "Submit response"}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
