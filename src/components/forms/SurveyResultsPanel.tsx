"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { IconUpload } from "@/components/ui/Icons";
import { SurveyAiSummary } from "@/components/dashboard/SurveyAiSummary";

type ResultQuestion = {
  id: string;
  title: string;
  type: string;
  counts: Record<string, number> | null;
};

type Results = {
  totalResponses: number;
  questions: ResultQuestion[];
};

export function SurveyResultsPanel({ id }: { id: string }) {
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/surveys/${id}/results`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setError(data.message ?? "We could not load these results.");
        return;
      }
      setResults({ totalResponses: data.totalResponses, questions: data.questions ?? [] });
    } catch {
      setError("We could not reach the server. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const exportCsv = () => {
    if (!results) return;
    const lines: string[] = ["Question,Answer,Count"];
    for (const question of results.questions) {
      if (question.counts) {
        for (const [answer, count] of Object.entries(question.counts)) {
          lines.push(`"${question.title.replace(/"/g, '""')}",${answer},${count}`);
        }
      } else {
        lines.push(`"${question.title.replace(/"/g, '""')}",(text),`);
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `survey-${id}-results.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <p className="text-[0.9375rem] text-muted">Loading responses…</p>;
  if (error) return <p className="text-[0.875rem] text-[#a5442c]">{error}</p>;
  if (!results) return null;

  return (
    <div className="flex flex-col gap-4">
      <section className="card-lift rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow">Responses</p>
            <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink-deep">
              {results.totalResponses} response(s)
            </h2>
          </div>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={results.totalResponses === 0}>
            <IconUpload className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            Export CSV
          </Button>
        </div>
      </section>
      <SurveyAiSummary surveyId={id} responseCount={results.totalResponses} />
      <section className="card-lift rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
        <p className="eyebrow">Question breakdown</p>
        <div className="mt-4 flex flex-col gap-4">
          {results.questions.map((question) => {
            const max = question.counts ? Math.max(1, ...Object.values(question.counts)) : 1;
            return (
              <div key={question.id} className="rounded-xl border border-line bg-paper px-4 py-3">
                <p className="text-[0.9375rem] font-medium text-ink-deep">{question.title}</p>
                {question.counts ? (
                  <div className="mt-2 flex flex-col gap-1.5">
                    {Object.entries(question.counts).map(([answer, count]) => (
                      <div key={answer} className="flex items-center gap-2 text-[0.8125rem] text-body">
                        <span className="w-32 truncate">{answer}</span>
                        <div className="h-2 flex-1 rounded-full bg-line">
                          <div
                            className="h-2 rounded-full bg-brass"
                            style={{ width: `${(count / max) * 100}%` }}
                          />
                        </div>
                        <span className="w-8 text-right font-semibold text-ink">{count}</span>
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
    </div>
  );
}
