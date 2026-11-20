"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useAiStatus } from "@/components/ai/useAiStatus";
import type { DraftFields, DraftKind } from "@/lib/ai/types";

type Props = {
  kind: DraftKind;
  label: string;
  getFields: () => DraftFields;
  onUse: (draft: string) => void;
  onUseHighlights?: (highlights: string[]) => void;
  disabled?: boolean;
};

export function DraftWithAiButton({
  kind,
  label,
  getFields,
  onUse,
  onUseHighlights,
  disabled,
}: Props) {
  const ai = useAiStatus();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [highlights, setHighlights] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const blocked = Boolean(disabled) || loading || ai.loading || !ai.configured;

  const generate = async () => {
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const response = await fetch("/api/ai/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, fields: getFields() }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setError(data.message ?? "We could not generate a draft.");
        return;
      }
      setDraft(typeof data.draft === "string" ? data.draft : "");
      setHighlights(Array.isArray(data.highlights) ? data.highlights : []);
      setOpen(true);
    } catch {
      setError("We could not reach the server.");
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
    } catch {
      setError("We could not copy the draft. Select the text and copy it manually.");
    }
  };

  const download = () => {
    const blob = new Blob([draft], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${kind}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const use = () => {
    onUse(draft);
    setOpen(false);
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={blocked}
          onClick={() => void generate()}
        >
          {loading ? "Drafting..." : label}
        </Button>
        {!ai.loading && !ai.configured ? (
          <span className="text-[0.75rem] text-muted">AI is not configured</span>
        ) : null}
        {error ? <span className="text-[0.75rem] text-[#a5442c]">{error}</span> : null}
      </div>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-6 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${label} draft`}
            className="pop-in flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-line bg-paper p-6 shadow-lift"
          >
            <div>
              <p className="eyebrow">AI-generated draft</p>
              <h2 className="mt-1 text-[1.125rem] font-semibold text-ink">{label}</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                Review every fact before saving. Use this draft to fill the form; it is not saved
                automatically.
              </p>
            </div>

            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="mt-4 min-h-[18rem] flex-1 rounded-xl border border-line bg-canvas px-3.5 py-3 font-mono text-[0.8125rem] leading-relaxed text-ink-deep outline-none focus:border-ink/25"
            />

            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Close
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={download}>
                Download .txt
              </Button>
              {highlights.length > 0 && onUseHighlights ? (
                <Button
                  type="button"
                  variant="brass"
                  size="sm"
                  onClick={() => {
                    onUseHighlights(highlights);
                    setOpen(false);
                  }}
                >
                  Use highlights
                </Button>
              ) : null}
              <Button type="button" size="sm" onClick={use}>
                Use this draft
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
