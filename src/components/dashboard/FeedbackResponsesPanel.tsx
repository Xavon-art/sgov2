"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, buttonClasses } from "@/components/ui/Button";
import { ActionError, selectClass } from "@/components/dashboard/workspace-shared";
import type {
  FeedbackFormSummary,
  FeedbackQuestion,
  FeedbackResponse,
  FeedbackResponseForm,
} from "@/lib/feedback-forms";

type Filter = "all" | "new" | "acknowledged";

const FILTER_LABEL: Record<Filter, string> = {
  all: "All",
  new: "New",
  acknowledged: "Acknowledged",
};

function messageFrom(json: Record<string, unknown>, fallback: string) {
  return typeof json.message === "string" && json.message.trim()
    ? json.message
    : fallback;
}

function formatWhen(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function answerText(value: unknown) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.map(String).join(", ") : "—";
  }
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

export function FeedbackResponsesPanel() {
  const [forms, setForms] = useState<FeedbackFormSummary[]>([]);
  const [formId, setFormId] = useState("");
  const [form, setForm] = useState<FeedbackResponseForm | null>(null);
  const [questions, setQuestions] = useState<FeedbackQuestion[]>([]);
  const [responses, setResponses] = useState<FeedbackResponse[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<FeedbackResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadForms = useCallback(async () => {
    try {
      const response = await fetch("/api/feedback/forms", { cache: "no-store" });
      const json = (await response.json()) as Record<string, unknown> & {
        rows?: FeedbackFormSummary[];
      };
      if (!response.ok || json.ok !== true) {
        throw new Error(messageFrom(json, "We could not load the forms."));
      }
      const nextForms = json.rows ?? [];
      setForms(nextForms);
      setError(null);
      setFormId((current) => current || nextForms[0]?.id || "");
      if (nextForms.length === 0) setState("ready");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "We could not load the forms.",
      );
      setState("error");
    }
  }, []);

  const loadResponses = useCallback(async (id: string) => {
    setState("loading");
    setError(null);
    setSelected(null);
    try {
      const response = await fetch(`/api/feedback/forms/${id}/responses`, {
        cache: "no-store",
      });
      const json = (await response.json()) as Record<string, unknown> & {
        form?: FeedbackResponseForm;
        questions?: FeedbackQuestion[];
        responses?: FeedbackResponse[];
      };
      if (!response.ok || json.ok !== true) {
        throw new Error(messageFrom(json, "We could not load the responses."));
      }
      setForm(json.form ?? null);
      setQuestions(json.questions ?? []);
      setResponses(json.responses ?? []);
      setState("ready");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "We could not load the responses.",
      );
      setState("error");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadForms();
  }, [loadForms]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (formId) void loadResponses(formId);
  }, [formId, loadResponses]);

  const acknowledge = async (response: FeedbackResponse) => {
    if (!formId || response.status === "acknowledged") return;
    setBusyId(response.id);
    setError(null);
    try {
      const result = await fetch(
        `/api/feedback/forms/${formId}/responses/${response.id}/acknowledge`,
        { method: "POST" },
      );
      const json = (await result.json()) as Record<string, unknown> & {
        status?: FeedbackResponse["status"];
      };
      if (!result.ok || json.ok !== true) {
        throw new Error(messageFrom(json, "Could not acknowledge the response."));
      }
      const nextStatus = json.status ?? "acknowledged";
      setResponses((current) =>
        current.map((item) =>
          item.id === response.id
            ? {
                ...item,
                status: nextStatus,
                acknowledgedAt:
                  nextStatus === "acknowledged"
                    ? new Date().toISOString()
                    : item.acknowledgedAt,
              }
            : item,
        ),
      );
      setSelected((current) =>
        current && current.id === response.id
          ? {
              ...current,
              status: nextStatus,
              acknowledgedAt:
                nextStatus === "acknowledged"
                  ? new Date().toISOString()
                  : current.acknowledgedAt,
            }
          : current,
      );
    } catch (ackError) {
      setError(
        ackError instanceof Error
          ? ackError.message
          : "Could not acknowledge the response.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const filtered = responses.filter(
    (response) => filter === "all" || response.status === filter,
  );
  const anonymous = form?.identityMode === "anonymous";

  return (
    <section data-testid="feedback-responses-panel" className="grid gap-4">
      <div>
        <h2 className="font-display text-2xl font-semibold tracking-tight text-ink-deep">
          Responses
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Review submitted answers and acknowledge each response.
        </p>
      </div>

      <ActionError message={error} />

      {forms.length === 0 && state !== "loading" ? (
        <div className="rounded-2xl border border-dashed border-line bg-paper/60 px-5 py-10 text-center">
          <p className="text-sm font-medium text-ink-deep">No feedback forms yet.</p>
          <p className="mt-1 text-sm text-ink-muted">
            Create a form before collecting responses.
          </p>
        </div>
      ) : null}

      {forms.length > 0 ? (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="grid min-w-56 gap-1.5">
            <span className="text-sm font-medium text-ink-deep">Form</span>
            <select
              className={selectClass}
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
          <div className="flex flex-wrap items-center gap-1.5">
            {(["all", "new", "acknowledged"] as Filter[]).map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={filter === value ? "primary" : "outline"}
                onClick={() => {
                  setFilter(value);
                  setSelected(null);
                }}
              >
                {FILTER_LABEL[value]}
              </Button>
            ))}
            {formId ? (
              <a
                href={`/api/feedback/forms/${formId}/export`}
                className={buttonClasses("outline", "sm")}
              >
                Export CSV
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      {state === "loading" && formId ? (
        <div className="grid gap-3">
          <div className="h-24 animate-pulse rounded-2xl bg-ink/[0.05]" />
          <div className="h-48 animate-pulse rounded-2xl bg-ink/[0.05]" />
        </div>
      ) : null}

      {state === "error" ? (
        <div className="rounded-2xl border border-line bg-paper p-5">
          <p className="text-sm text-ink-muted">
            We could not load the responses.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => formId && void loadResponses(formId)}
          >
            Try again
          </Button>
        </div>
      ) : null}

      {state === "ready" && form && filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-paper/60 px-5 py-10 text-center">
          <p className="text-sm font-medium text-ink-deep">No responses yet.</p>
          <p className="mt-1 text-sm text-ink-muted">
            Responses appear here as soon as the form is answered.
          </p>
        </div>
      ) : null}

      {state === "ready" && form && filtered.length > 0 ? (
        <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-ink/[0.025] text-xs uppercase tracking-[0.1em] text-ink-muted">
                <th className="whitespace-nowrap px-4 py-3 font-semibold">Submitted</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">Respondent</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">Email</th>
                {questions.map((question) => (
                  <th
                    key={question.id}
                    className="min-w-48 px-4 py-3 font-semibold"
                  >
                    {question.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((response) => (
                <tr
                  key={response.id}
                  data-testid="feedback-response-row"
                  className="cursor-pointer border-b border-line/70 align-top transition-colors duration-150 last:border-b-0 hover:bg-ink/[0.025]"
                  onClick={() => setSelected(response)}
                >
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">
                    {formatWhen(response.submittedAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-ink-deep">
                    {anonymous ? "Anonymous" : response.respondentName || "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">
                    {anonymous ? "—" : response.respondentEmail || "—"}
                  </td>
                  {questions.map((question) => (
                    <td
                      key={question.id}
                      className="max-w-72 px-4 py-3 text-ink-soft"
                    >
                      <span className="line-clamp-2">
                        {answerText(response.answers[question.id])}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {selected ? (
        <article className="rounded-2xl border border-line bg-paper p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">
                Response detail
              </p>
              <p className="mt-1 text-sm text-ink-muted">
                {formatWhen(selected.submittedAt)} ·{" "}
                {anonymous ? "Anonymous" : selected.respondentName || "Unnamed"}
                {!anonymous && selected.respondentEmail
                  ? ` · ${selected.respondentEmail}`
                  : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-line bg-ink/[0.04] px-2.5 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                {selected.status === "acknowledged" ? "Acknowledged" : "New"}
              </span>
              {selected.status === "new" ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void acknowledge(selected)}
                  disabled={busyId === selected.id}
                >
                  {busyId === selected.id ? "Acknowledging…" : "Acknowledge"}
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setSelected(null)}
              >
                Close
              </Button>
            </div>
          </div>
          <div className="mt-4 grid gap-4 border-t border-line pt-4">
            {questions.map((question) => (
              <div key={question.id}>
                <p className="text-sm font-medium text-ink-deep">
                  {question.title}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
                  {answerText(selected.answers[question.id])}
                </p>
              </div>
            ))}
          </div>
        </article>
      ) : null}
    </section>
  );
}
