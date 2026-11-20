"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useAiStatus } from "@/components/ai/useAiStatus";

type Summary = {
  overview: string;
  sentiment: {
    positive: number;
    neutral: number;
    negative: number;
    mixed: number;
  };
  highlights: string[];
  complaints: string[];
  suggestions: string[];
  themes: Array<{ label: string; mentions: number; evidence: string }>;
  caveats: string;
};

type CachedSummary = {
  summary: Summary;
  responseCount: number;
  generatedAt: string | null;
  model: string | null;
};

const SENTIMENT: Array<{ key: keyof Summary["sentiment"]; label: string; tone: string }> = [
  { key: "positive", label: "Positive", tone: "bg-[#2f6b4f]" },
  { key: "neutral", label: "Neutral", tone: "bg-brass" },
  { key: "negative", label: "Negative", tone: "bg-[#a5442c]" },
  { key: "mixed", label: "Mixed", tone: "bg-ink/40" },
];

function percent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function generatedLabel(cached: CachedSummary): string {
  const when = cached.generatedAt
    ? new Date(cached.generatedAt).toLocaleString()
    : "an unknown date";
  return `Generated from ${cached.responseCount} response(s) on ${when}.`;
}

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-[0.8125rem] font-semibold uppercase tracking-[0.12em] text-muted">
        {title}
      </p>
      <ul className="mt-2 grid gap-1.5">
        {items.map((item, index) => (
          <li
            key={`${title}-${index}`}
            className="rounded-xl border border-line bg-paper/70 px-3 py-2 text-[0.875rem] text-body"
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SurveyAiSummary({
  surveyId,
  responseCount,
}: {
  surveyId: string;
  responseCount: number;
}) {
  const ai = useAiStatus();
  const [cached, setCached] = useState<CachedSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/surveys/${surveyId}/ai-summary`, {
          cache: "no-store",
        });
        const data = await response.json();
        if (!active) return;
        if (!response.ok || !data.ok) {
          setError(data.message ?? "We could not load the AI summary.");
          return;
        }
        if (data.summary) {
          setCached({
            summary: data.summary as Summary,
            responseCount: Number(data.responseCount ?? 0),
            generatedAt: typeof data.generatedAt === "string" ? data.generatedAt : null,
            model: typeof data.model === "string" ? data.model : null,
          });
        }
      } catch {
        if (active) setError("We could not reach the server.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [surveyId]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/surveys/${surveyId}/ai-summary`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setError(data.message ?? "We could not generate the summary.");
        return;
      }
      setCached({
        summary: data.summary as Summary,
        responseCount: Number(data.responseCount ?? responseCount),
        generatedAt: typeof data.generatedAt === "string" ? data.generatedAt : null,
        model: typeof data.model === "string" ? data.model : null,
      });
    } catch {
      setError("We could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || ai.loading || !ai.configured || responseCount === 0;
  const stale = cached !== null && cached.responseCount !== responseCount;

  return (
    <section className="card-lift rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="eyebrow">AI summary</p>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-muted">
            Summarise the newest responses. The deterministic results below remain the authority.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {stale ? (
            <span className="rounded-full bg-brass/15 px-2.5 py-1 text-[0.7rem] font-semibold text-ink">
              Summary is out of date
            </span>
          ) : null}
          <Button
            size="sm"
            disabled={disabled}
            onClick={() => void generate()}
          >
            {cached ? (busy ? "Regenerating..." : "Regenerate") : busy ? "Generating..." : "Generate AI summary"}
          </Button>
        </div>
      </div>

      {!ai.loading && !ai.configured ? (
        <p className="mt-4 rounded-xl border border-line bg-canvas px-3.5 py-3 text-sm text-ink-muted">
          AI is not configured; results are still available below.
        </p>
      ) : null}

      {responseCount === 0 ? (
        <p className="mt-4 rounded-xl border border-line bg-canvas px-3.5 py-3 text-sm text-ink-muted">
          No responses to summarize yet.
        </p>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-xl border border-[#a5442c]/30 bg-[#a5442c]/[0.06] px-3.5 py-3 text-sm text-[#a5442c]">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-4 text-sm text-muted">Loading the saved summary...</p>
      ) : cached ? (
        <div className="mt-5 grid gap-5">
          <p className="whitespace-pre-wrap text-[0.9375rem] leading-relaxed text-body">
            {cached.summary.overview}
          </p>

          <div className="grid gap-2.5">
            {SENTIMENT.map((item) => {
              const value = percent(cached.summary.sentiment[item.key]);
              return (
                <div key={item.key} className="flex items-center gap-3">
                  <span className="w-20 text-[0.8125rem] font-medium text-ink">
                    {item.label}
                  </span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-line">
                    <div
                      className={`h-2.5 rounded-full ${item.tone}`}
                      style={{ width: `${value}%` }}
                    />
                  </div>
                  <span className="w-9 text-right text-[0.8125rem] font-semibold text-ink">
                    {value}%
                  </span>
                </div>
              );
            })}
          </div>

          <List title="Highlights" items={cached.summary.highlights} />
          <List title="Complaints" items={cached.summary.complaints} />
          <List title="Suggestions" items={cached.summary.suggestions} />

          {cached.summary.themes.length > 0 ? (
            <div>
              <p className="text-[0.8125rem] font-semibold uppercase tracking-[0.12em] text-muted">
                Themes
              </p>
              <div className="mt-2 grid gap-2">
                {cached.summary.themes.map((theme, index) => (
                  <div
                    key={`${theme.label}-${index}`}
                    className="rounded-xl border border-line bg-paper/70 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[0.875rem] font-medium text-ink-deep">
                        {theme.label}
                      </p>
                      <span className="text-[0.75rem] font-semibold text-muted">
                        {theme.mentions} mention(s)
                      </span>
                    </div>
                    {theme.evidence ? (
                      <p className="mt-1 text-[0.8125rem] text-ink-muted">
                        {theme.evidence}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {cached.summary.caveats ? (
            <p className="rounded-xl border border-line bg-canvas px-3.5 py-3 text-[0.8125rem] text-ink-muted">
              {cached.summary.caveats}
            </p>
          ) : null}

          <div className="border-t border-line pt-3">
            <p className="whitespace-pre-wrap text-[0.75rem] text-muted">
              {generatedLabel(cached)}
            </p>
            <p className="mt-1 text-[0.75rem] text-muted">
              AI-generated summary. Check the underlying responses before acting.
            </p>
            {cached.model ? (
              <p className="mt-1 text-[0.7rem] text-muted">Model: {cached.model}</p>
            ) : null}
          </div>
        </div>
      ) : responseCount > 0 && ai.configured ? (
        <p className="mt-4 text-sm text-ink-muted">
          No saved summary yet. Generate one when you are ready.
        </p>
      ) : null}
    </section>
  );
}
