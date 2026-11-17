"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Enter } from "@/components/fx/Presence";
import { SwapText } from "@/components/fx/SwapText";
import { TextField } from "@/components/ui/Field";
import { useAccount } from "@/components/dashboard/dashboard-context";
import { NotAvailable } from "@/components/dashboard/NotAvailable";

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
  showIf?: { questionId?: string; values?: string[] } | null;
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

export function SurveyDetailEditor({ id, isUsg }: { id: string; isUsg: boolean }) {
  const account = useAccount();
  const router = useRouter();
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // form state
  const [qType, setQType] = useState("short_text");
  const [qTitle, setQTitle] = useState("");
  const [qDesc, setQDesc] = useState("");
  const [qRequired, setQRequired] = useState(false);
  const [qOptions, setQOptions] = useState("");
  const [qScaleMin, setQScaleMin] = useState("1");
  const [qScaleMax, setQScaleMax] = useState("5");
  const [qLow, setQLow] = useState("");
  const [qHigh, setQHigh] = useState("");
  const [qShowIfQuestion, setQShowIfQuestion] = useState("");
  const [qShowIfValue, setQShowIfValue] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const [results, setResults] = useState<{ totalResponses: number; questions: { id: string; title: string; type: string; counts: Record<string, number> | null }[] } | null>(null);

  const load = useCallback(async () => {
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
    try {
      const res = await fetch(`/api/surveys/${id}/results`);
      const data = await res.json();
      if (res.ok && data.ok) setResults({ totalResponses: data.totalResponses, questions: data.questions });
    } catch {
      // ignore
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (survey?.status !== "draft") void loadResults();
  }, [survey?.status, loadResults]);

  if (isUsg && account.accountScope !== "owner") return <NotAvailable />;

  const resetForm = () => {
    setQType("short_text");
    setQTitle("");
    setQDesc("");
    setQRequired(false);
    setQOptions("");
    setQScaleMin("1");
    setQScaleMax("5");
    setQLow("");
    setQHigh("");
    setQShowIfQuestion("");
    setQShowIfValue("");
    setEditingId(null);
  };

  const submitQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    setNote(null);
    setActionError(null);
    if (!qTitle.trim()) {
      setActionError("Give the question a title.");
      return;
    }
    setBusy(true);
    try {
      const opts = qOptions
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const showIf =
        qShowIfQuestion && qShowIfValue.trim()
          ? { questionId: qShowIfQuestion, values: [qShowIfValue.trim()] }
          : null;
      const body = {
        type: qType,
        title: qTitle.trim(),
        description: qDesc.trim(),
        required: qRequired,
        options: opts,
        scaleMin: Number(qScaleMin),
        scaleMax: Number(qScaleMax),
        scaleLabelLow: qLow.trim(),
        scaleLabelHigh: qHigh.trim(),
        showIf,
      };
      let res;
      if (editingId) {
        res = await fetch(`/api/surveys/${id}/questions/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, orderIndex: questions.find((q) => q.id === editingId)?.orderIndex ?? 0 }),
        });
      } else {
        res = await fetch(`/api/surveys/${id}/questions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, orderIndex: questions.length }),
        });
      }
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setActionError(data.message ?? "We could not save that question.");
        return;
      }
      setNote(editingId ? "Question updated." : "Question added.");
      resetForm();
      await load();
    } catch {
      setActionError("We could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  };

  const deleteQuestion = async (qid: string) => {
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
  };

  const duplicateQuestion = async (q: Question) => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/surveys/${id}/questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: q.type,
          title: q.title + " (copy)",
          description: q.description,
          required: q.required,
          options: q.options,
          scaleMin: q.scaleMin,
          scaleMax: q.scaleMax,
          scaleLabelLow: q.scaleLabelLow,
          scaleLabelHigh: q.scaleLabelHigh,
          showIf: q.showIf ?? null,
          orderIndex: questions.length,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setActionError(data.message ?? "We could not duplicate that question.");
        return;
      }
      await load();
    } catch {
      setActionError("We could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  };

  const moveQuestion = async (qid: string, dir: -1 | 1) => {
    const idx = questions.findIndex((q) => q.id === qid);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= questions.length) return;
    const a = questions[idx];
    const b = questions[swapIdx];
    setBusy(true);
    try {
      await fetch(`/api/surveys/${id}/questions/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIndex: b.orderIndex }),
      });
      await fetch(`/api/surveys/${id}/questions/${b.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIndex: a.orderIndex }),
      });
      await load();
    } catch {
      setActionError("We could not reorder.");
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (q: Question) => {
    setEditingId(q.id);
    setQType(q.type);
    setQTitle(q.title);
    setQDesc(q.description ?? "");
    setQRequired(q.required);
    setQOptions((q.options ?? []).join("\n"));
    setQScaleMin(String(q.scaleMin ?? 1));
    setQScaleMax(String(q.scaleMax ?? 5));
    setQLow(q.scaleLabelLow ?? "");
    setQHigh(q.scaleLabelHigh ?? "");
    const si = (q as unknown as { showIf?: { questionId?: string; values?: string[] } }).showIf;
    setQShowIfQuestion(si?.questionId ?? "");
    setQShowIfValue(si?.values?.[0] ?? "");
  };

  const publish = async () => {
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
  };

  const close = async () => {
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
  };

  const remove = async () => {
    if (!window.confirm("Delete this survey and all its responses?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/surveys/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setActionError(data.message ?? "We could not delete this survey.");
        return;
      }
      const base = isUsg ? "/usg/surveys" : "/lsg/surveys";
      router.replace(base);
    } catch {
      setActionError("We could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    if (!results) return;
    const lines: string[] = [];
    lines.push(`Question,Answer,Count`);
    for (const q of results.questions) {
      if (q.counts) {
        for (const [k, v] of Object.entries(q.counts)) {
          lines.push(`"${q.title.replace(/"/g, '""')}",${k},${v}`);
        }
      } else {
        lines.push(`"${q.title.replace(/"/g, '""')}",(text),`);
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `survey-${id}-results.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <p className="text-[0.9375rem] text-muted">Loading…</p>;
  if (error) return <p className="text-[0.875rem] text-[#a5442c]">{error}</p>;
  if (!survey) return null;

  const publicUrl = typeof window !== "undefined" ? `${window.location.origin}/survey/${survey.id}` : "";

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
        {survey.status !== "draft" && results && (
          <Button size="sm" variant="outline" onClick={exportCsv}>
            Export CSV
          </Button>
        )}
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
          <p className="eyebrow">{editingId ? "Edit question" : "Add a question"}</p>
          <form onSubmit={submitQuestion} className="mt-5 flex flex-col gap-4">
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
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="text-[0.8125rem] font-semibold text-ink">Show if (optional)</label>
                <select
                  value={qShowIfQuestion}
                  onChange={(e) => setQShowIfQuestion(e.target.value)}
                  className="h-11 w-full rounded-xl border border-line bg-paper/70 px-3.5 text-[0.9375rem] text-ink-deep"
                >
                  <option value="">Always show</option>
                  {questions
                    .filter((q) => q.id !== editingId)
                    .map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.title}
                      </option>
                    ))}
                </select>
              </div>
              {qShowIfQuestion && (
                <TextField
                  id="q-showif-value"
                  label="Equals value"
                  value={qShowIfValue}
                  onChange={(e) => setQShowIfValue(e.target.value)}
                />
              )}
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                <SwapText isPending={busy} idle={editingId ? "Save question" : "Add question"} pending="Saving…" />
              </Button>
              {editingId && (
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
              )}
            </div>
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
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => moveQuestion(q.id, -1)}
                      disabled={busy || i === 0}
                      className="pressable rounded-full border border-line px-2 py-1 text-[0.7rem] font-semibold text-ink hover:bg-ink/[0.04] disabled:opacity-40"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveQuestion(q.id, 1)}
                      disabled={busy || i === questions.length - 1}
                      className="pressable rounded-full border border-line px-2 py-1 text-[0.7rem] font-semibold text-ink hover:bg-ink/[0.04] disabled:opacity-40"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => startEdit(q)}
                      disabled={busy}
                      className="pressable rounded-full border border-line px-2 py-1 text-[0.7rem] font-semibold text-ink hover:bg-ink/[0.04]"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void duplicateQuestion(q)}
                      disabled={busy}
                      className="pressable rounded-full border border-line px-2 py-1 text-[0.7rem] font-semibold text-ink hover:bg-ink/[0.04]"
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteQuestion(q.id)}
                      disabled={busy}
                      className="pressable rounded-full border border-line px-2 py-1 text-[0.7rem] font-semibold text-[#a5442c] hover:bg-[#a5442c]/[0.06]"
                    >
                      Remove
                    </button>
                  </div>
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
            {results.questions.map((q) => {
              const max = q.counts ? Math.max(1, ...Object.values(q.counts)) : 1;
              return (
                <div key={q.id} className="rounded-xl border border-line bg-paper px-4 py-3">
                  <p className="text-[0.9375rem] font-medium text-ink-deep">{q.title}</p>
                  {q.counts ? (
                    <div className="mt-2 flex flex-col gap-1.5">
                      {Object.entries(q.counts).map(([k, v]) => (
                        <div key={k} className="flex items-center gap-2 text-[0.8125rem] text-body">
                          <span className="w-32 truncate">{k}</span>
                          <div className="h-2 flex-1 rounded-full bg-line">
                            <div
                              className="h-2 rounded-full bg-brass"
                              style={{ width: `${(v / max) * 100}%` }}
                            />
                          </div>
                          <span className="w-8 text-right font-semibold text-ink">{v}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-[0.8125rem] text-muted">No answers yet.</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}