"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { SwapText } from "@/components/fx/SwapText";

type Question = {
  id: string;
  orderIndex: number;
  type: string;
  title: string;
  description: string | null;
  required: boolean;
  options: string[] | { label: string; value: string }[];
  scaleMin: number | null;
  scaleMax: number | null;
  scaleLabelLow: string | null;
  scaleLabelHigh: string | null;
};

type Survey = {
  id: string;
  title: string;
  description: string | null;
  accessMode: string;
  deadline: string | null;
  responseLimit: number | null;
};

function SurveyForm({ id }: { id: string }) {
  const searchParams = useSearchParams();
  const emailParam = searchParams.get("email") ?? "";

  const [survey, setSurvey] = useState<Survey | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [email, setEmail] = useState(emailParam);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/surveys/${id}?email=${encodeURIComponent(emailParam)}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setError(data.message ?? "This survey is not available.");
          return;
        }
        setSurvey(data.survey);
        setQuestions(data.questions ?? []);
      } catch {
        if (!cancelled) setError("We could not reach the server. Check your connection.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, emailParam]);

  function setAnswer(qid: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [qid]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    // required check
    for (const q of questions) {
      if (q.required) {
        const v = answers[q.id];
        const empty =
          v === undefined ||
          v === null ||
          v === "" ||
          (Array.isArray(v) && v.length === 0);
        if (empty) {
          setSubmitError(`Please answer: ${q.title}`);
          return;
        }
      }
    }

    if (survey?.accessMode === "email_list" && !email.trim()) {
      setSubmitError("Enter the email address this survey was sent to.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/surveys/${id}/responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessEmail: email.trim(), answers }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setSubmitError(data.message ?? "We could not submit your response.");
        return;
      }
      setSubmitted(true);
    } catch {
      setSubmitError("We could not reach the server. Check your connection.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-12">
        <div className="h-8 w-2/3 animate-pulse rounded bg-ink/[0.06]" />
        <div className="mt-6 h-40 animate-pulse rounded-xl bg-ink/[0.04]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-12 text-center">
        <h1 className="text-[1.5rem] font-semibold text-ink">Survey unavailable</h1>
        <p className="mt-2 text-[0.9375rem] text-body">{error}</p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-12 text-center">
        <h1 className="text-[1.5rem] font-semibold text-ink">Thank you</h1>
        <p className="mt-2 text-[0.9375rem] text-body">Your response has been recorded.</p>
      </div>
    );
  }

  if (!survey) return null;

  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <h1 className="text-[1.75rem] font-semibold leading-tight text-ink">{survey.title}</h1>
      {survey.description ? (
        <p className="mt-2 text-[0.9375rem] leading-relaxed text-body">{survey.description}</p>
      ) : null}
      {survey.deadline ? (
        <p className="mt-2 text-[0.8125rem] text-muted">
          Closes {new Date(survey.deadline).toLocaleString()}
        </p>
      ) : null}

      <form onSubmit={submit} className="mt-8 flex flex-col gap-6">
        {survey.accessMode === "email_list" ? (
          <div className="flex flex-col gap-2">
            <label className="text-[0.8125rem] font-semibold text-ink">Your email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@campus.edu"
              className="h-11 rounded-xl border border-line bg-paper/70 px-3.5 text-[0.9375rem] text-ink-deep outline-none focus:border-ink/25"
            />
          </div>
        ) : null}

        {questions.map((q) => (
          <div key={q.id} className="rounded-2xl border border-line bg-paper/70 p-5">
            <p className="text-[0.9375rem] font-semibold text-ink">
              {q.title}
              {q.required ? <span className="ml-1 text-[#a5442c]">*</span> : null}
            </p>
            {q.description ? (
              <p className="mt-1 text-[0.8125rem] text-muted">{q.description}</p>
            ) : null}

            <div className="mt-3">
              {q.type === "short_text" ? (
                <input
                  type="text"
                  value={(answers[q.id] as string) ?? ""}
                  onChange={(e) => setAnswer(q.id, e.target.value)}
                  className="h-11 w-full rounded-xl border border-line bg-canvas px-3.5 text-[0.9375rem] text-ink-deep outline-none focus:border-ink/25"
                />
              ) : null}

              {q.type === "long_text" ? (
                <textarea
                  value={(answers[q.id] as string) ?? ""}
                  onChange={(e) => setAnswer(q.id, e.target.value)}
                  rows={4}
                  className="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-[0.9375rem] text-ink-deep outline-none focus:border-ink/25"
                />
              ) : null}

              {q.type === "date" ? (
                <input
                  type="date"
                  value={(answers[q.id] as string) ?? ""}
                  onChange={(e) => setAnswer(q.id, e.target.value)}
                  className="h-11 rounded-xl border border-line bg-canvas px-3.5 text-[0.9375rem] text-ink-deep outline-none focus:border-ink/25"
                />
              ) : null}

              {q.type === "time" ? (
                <input
                  type="time"
                  value={(answers[q.id] as string) ?? ""}
                  onChange={(e) => setAnswer(q.id, e.target.value)}
                  className="h-11 rounded-xl border border-line bg-canvas px-3.5 text-[0.9375rem] text-ink-deep outline-none focus:border-ink/25"
                />
              ) : null}

              {(q.type === "multiple_choice" || q.type === "dropdown") ? (
                <div className="flex flex-col gap-2">
                  {(q.options as string[]).map((opt, i) => (
                    <label key={i} className="flex items-center gap-2 text-[0.9375rem] text-body">
                      <input
                        type="radio"
                        name={q.id}
                        value={opt}
                        checked={answers[q.id] === opt}
                        onChange={() => setAnswer(q.id, opt)}
                      />
                      {opt}
                    </label>
                  ))}
                </div>
              ) : null}

              {q.type === "checkbox" ? (
                <div className="flex flex-col gap-2">
                  {(q.options as string[]).map((opt, i) => {
                    const selected = Array.isArray(answers[q.id]) ? (answers[q.id] as string[]) : [];
                    return (
                      <label key={i} className="flex items-center gap-2 text-[0.9375rem] text-body">
                        <input
                          type="checkbox"
                          value={opt}
                          checked={selected.includes(opt)}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...selected, opt]
                              : selected.filter((x) => x !== opt);
                            setAnswer(q.id, next);
                          }}
                        />
                        {opt}
                      </label>
                    );
                  })}
                </div>
              ) : null}

              {q.type === "linear_scale" ? (
                <div className="flex flex-wrap items-center gap-3">
                  {Array.from(
                    { length: (q.scaleMax ?? 5) - (q.scaleMin ?? 1) + 1 },
                    (_, i) => (q.scaleMin ?? 1) + i,
                  ).map((n) => (
                    <label key={n} className="flex flex-col items-center gap-1 text-[0.8125rem] text-body">
                      <input
                        type="radio"
                        name={q.id}
                        value={n}
                        checked={answers[q.id] === n}
                        onChange={() => setAnswer(q.id, n)}
                      />
                      {n}
                    </label>
                  ))}
                  <div className="basis-full text-[0.75rem] text-muted">
                    {q.scaleLabelLow ? `${q.scaleMin}: ${q.scaleLabelLow}` : ""}
                    {q.scaleLabelHigh ? ` · ${q.scaleMax}: ${q.scaleLabelHigh}` : ""}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ))}

        {submitError ? (
          <p role="alert" className="rounded-xl border border-[#d9a99c] bg-[#a5442c]/[0.06] px-3.5 py-2.5 text-[0.8125rem] font-medium text-[#a5442c]">
            {submitError}
          </p>
        ) : null}

        <Button type="submit" size="md" disabled={submitting}>
          <SwapText isPending={submitting} idle="Submit" pending="Submitting…" />
        </Button>
      </form>
    </div>
  );
}

export default function SurveyPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    void params.then((p) => setId(p.id));
  }, [params]);
  if (!id) return null;
  return (
    <Suspense fallback={null}>
      <SurveyForm id={id} />
    </Suspense>
  );
}