"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Enter } from "@/components/fx/Presence";
import { SwapText } from "@/components/fx/SwapText";
import { TextField } from "@/components/ui/Field";

type Question = {
  id: string;
  orderIndex: number;
  type: string;
  title: string;
  description: string | null;
  required: boolean;
  options: string[];
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
  status: string;
  responseLimit: number | null;
  deadline: string | null;
};

const QTYPES = [
  { value: "short_text", label: "Short text" },
  { value: "long_text", label: "Long text" },
  { value: "multiple_choice", label: "Multiple choice" },
  { value: "checkbox", label: "Checkbox" },
  { value: "dropdown", label: "Dropdown" },
  { value: "linear_scale", label: "Linear scale" },
  { value: "date", label: "Date" },
  { value: "time", label: "Time" },
];

export default function LsgSurveyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    void params.then((p) => setId(p.id));
  }, [params]);

  const [survey, setSurvey] = useState<Survey | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [qType, setQType] = useState("short_text");
  const [qTitle, setQTitle] = useState("");
  const [qDesc, setQDesc] = useState("");
  const [qRequired, setQRequired] = useState(false);
  const [qOptions, setQOptions] = useState("");
  const [qScaleMin, setQScaleMin] = useState("1");
  const [qScaleMax, setQScaleMax] = useState("5");
  const [qLow, setQLow] = useState("");
  const [qHigh, setQHigh] = useState("");

  const [results, setResults] = useState<{ totalResponses: number; questions: { id: string; title: string; type: string; counts: Record<string, number> | null }[] } | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/surveys/${id}`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.message ?? "We could not load this survey.");
        return;
      }
      setSurvey(data.survey);
      setQuestions(data.questions ?? []);
      setError(null);
    } catch {
      setError("We could not reach the server. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadResults = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/surveys/${id}/results`);
      const data = await res.json();
      if (res.ok && data.ok) setResults({ totalResponses: data.totalResponses, questions: data.questions });
    } catch {}
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (id) void load();
  }, [id, load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (id && survey?.status !== "draft") void loadResults();
  }, [id, survey?.status, loadResults]);

  async function addQuestion(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    setNote(null);
    setActionError(null);
    if (!qTitle.trim()) {
      setActionError("Give the question a title.");
      return;
    }
    setBusy(true);
    try {
      const opts = qOptions.split("\n").map((s) => s.trim()).filter(Boolean);
      const res = await fetch(`/api/surveys/${id}/questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: qType,
          title: qTitle.trim(),
          description: qDesc.trim(),
          required: qRequired,
          options: opts,
          scaleMin: Number(qScaleMin),
          scaleMax: Number(qScaleMax),
          scaleLabelLow: qLow.trim(),
          scaleLabelHigh: qHigh.trim(),
          orderIndex: questions.length,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setActionError(data.message ?? "We could not add that question.");
        return;
      }
      setQTitle("");
      setQDesc("");
      setQOptions("");
      setNote("Question added.");
      await load();
    } catch {
      setActionError("We could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteQuestion(qid: string) {
    if (!id) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/surveys/${id}/questions/${qid}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setActionError(data.message ?? "We could not delete that question.");
        return;
      }
      await load();
    } catch {
      setActionError("We could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!id) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/surveys/${id}/publish`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setActionError(data.message ?? "We could not publish this survey.");
        return;
      }
      setNote("Survey published. Share the public link.");
      await load();
    } catch {
      setActionError("We could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    if (!id) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/surveys/${id}/close`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setActionError(data.message ?? "We could not close this survey.");
        return;
      }
      setNote("Survey closed.");
      await load();
    } catch {
      setActionError("We could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!id) return;
    if (!window.confirm("Delete this survey and all its responses?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/surveys/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setActionError(data.message ?? "We could not delete this survey.");
        return;
      }
      window.location.href = "/lsg/surveys";
    } catch {
      setActionError("We could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-[0.9375rem] text-muted">Loading…</p>;
  if (error) return <p className="text-[0.875rem] text-[#a5442c]">{error}</p>;
  if (!survey) return null;

  const publicUrl = `${window.location.origin}/survey/${survey.id}`;

  return (
    <div className="flex flex-col gap-8">
      <header className="border-b border-line/80 pb-4">
        <p className="eyebrow">Survey</p>
        <h1 className="mt-1 text-[1.5rem] leading-tight sm:text-[1.75rem]">{survey.title}</h1>
        <p className="mt-1 text-[0.875rem] text-muted">
          {survey.status} · {survey.accessMode} · {questions.length} question(s)
        </p>
        {survey.status === "open" ? (
          <p className="mt-2 text-[0.8125rem] text-body">
            Public link:{" "}
            <a href={publicUrl} className="font-medium text-brass-deep underline" target="_blank" rel="noreferrer">
              {publicUrl}
            </a>
          </p>
        ) : null}
      </header>

      {note ? (
        <Enter open as="p" role="status" className="rounded-xl border border-brass/40 bg-brass-soft/25 px-3.5 py-2.5 text-[0.8125rem] font-medium text-ink">
          {note}
        </Enter>
      ) : null}
      {actionError ? (
        <Enter open as="p" role="alert" className="rounded-xl border border-[#d9a99c] bg-[#a5442c]/[0.06] px-3.5 py-2.5 text-[0.8125rem] font-medium text-[#a5442c]">
          {actionError}
        </Enter>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {survey.status === "draft" ? (
          <Button size="sm" disabled={busy || questions.length === 0} onClick={() => void publish()}>
            <SwapText isPending={busy} idle="Publish" pending="Publishing…" />
          </Button>
        ) : null}
        {survey.status === "open" ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void close()}>
            <SwapText isPending={busy} idle="Close" pending="Closing…" />
          </Button>
        ) : null}
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy}
          className="pressable rounded-full border border-line px-3 py-1.5 text-[0.75rem] font-semibold text-[#a5442c] hover:bg-[#a5442c]/[0.06]"
        >
          Delete
        </button>
      </div>

      {survey.status === "draft" ? (
        <section className="card-lift rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
          <p className="eyebrow">Add a question</p>
          <form onSubmit={addQuestion} className="mt-5 flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-[0.8125rem] font-semibold text-ink">Type</label>
              <select
                value={qType}
                onChange={(e) => setQType(e.target.value)}
                className="h-12 w-full rounded-xl border border-line bg-paper/70 px-3.5 text-[0.9375rem] text-ink-deep"
              >
                {QTYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <TextField id="q-title" label="Question" value={qTitle} onChange={(e) => setQTitle(e.target.value)} required />
            <TextField id="q-desc" label="Description (optional)" value={qDesc} onChange={(e) => setQDesc(e.target.value)} optional />
            <label className="flex items-center gap-2 text-[0.875rem] text-body">
              <input type="checkbox" checked={qRequired} onChange={(e) => setQRequired(e.target.checked)} />
              Required
            </label>
            {["multiple_choice", "checkbox", "dropdown"].includes(qType) ? (
              <TextField
                id="q-options"
                label="Options (one per line)"
                value={qOptions}
                onChange={(e) => setQOptions(e.target.value)}
                required
              />
            ) : null}
            {qType === "linear_scale" ? (
              <div className="grid gap-4 sm:grid-cols-4">
                <TextField id="q-min" label="Min" type="number" value={qScaleMin} onChange={(e) => setQScaleMin(e.target.value)} />
                <TextField id="q-max" label="Max" type="number" value={qScaleMax} onChange={(e) => setQScaleMax(e.target.value)} />
                <TextField id="q-low" label="Low label" value={qLow} onChange={(e) => setQLow(e.target.value)} optional />
                <TextField id="q-high" label="High label" value={qHigh} onChange={(e) => setQHigh(e.target.value)} optional />
              </div>
            ) : null}
            <Button type="submit" disabled={busy}>
              <SwapText isPending={busy} idle="Add question" pending="Adding…" />
            </Button>
          </form>
        </section>
      ) : null}

      <section className="card-lift rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
        <p className="eyebrow">Questions ({questions.length})</p>
        {questions.length === 0 ? (
          <p className="mt-4 text-[0.875rem] text-muted">No questions yet.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {questions.map((q, i) => (
              <li key={q.id} className="flex items-start justify-between gap-3 rounded-xl border border-line bg-paper px-4 py-3">
                <div>
                  <p className="text-[0.9375rem] font-medium text-ink-deep">
                    {i + 1}. {q.title}
                    {q.required ? <span className="ml-1 text-[#a5442c]">*</span> : null}
                  </p>
                  <p className="text-[0.75rem] text-muted">{q.type}</p>
                </div>
                {survey.status === "draft" ? (
                  <button
                    type="button"
                    onClick={() => void deleteQuestion(q.id)}
                    disabled={busy}
                    className="pressable rounded-full border border-line px-3 py-1.5 text-[0.7rem] font-semibold text-[#a5442c] hover:bg-[#a5442c]/[0.06]"
                  >
                    Remove
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {survey.status !== "draft" && results ? (
        <section className="card-lift rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
          <p className="eyebrow">Results ({results.totalResponses} response(s))</p>
          <div className="mt-4 flex flex-col gap-4">
            {results.questions.map((q) => (
              <div key={q.id} className="rounded-xl border border-line bg-paper px-4 py-3">
                <p className="text-[0.9375rem] font-medium text-ink-deep">{q.title}</p>
                {q.counts ? (
                  <ul className="mt-2 flex flex-col gap-1">
                    {Object.entries(q.counts).map(([k, v]) => (
                      <li key={k} className="flex items-center justify-between text-[0.8125rem] text-body">
                        <span>{k}</span>
                        <span className="font-semibold text-ink">{v}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[0.8125rem] text-muted">No answers yet.</p>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}