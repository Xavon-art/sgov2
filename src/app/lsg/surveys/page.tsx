"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Enter } from "@/components/fx/Presence";
import { SwapText } from "@/components/fx/SwapText";
import { TextField } from "@/components/ui/Field";

type Survey = {
  id: string;
  title: string;
  description: string | null;
  accessMode: string;
  status: string;
  responseLimit: number | null;
  deadline: string | null;
  createdAt: string;
  responseCount: number;
  canViewResults: boolean;
};

export default function LsgSurveysPage() {
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [accessMode, setAccessMode] = useState("public");
  const [allowedEmails, setAllowedEmails] = useState("");
  const [responseLimit, setResponseLimit] = useState("");
  const [deadline, setDeadline] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/surveys");
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.message ?? "We could not load surveys.");
        return;
      }
      setSurveys(data.surveys ?? []);
      setError(null);
    } catch {
      setError("We could not reach the server. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setNote(null);
    setActionError(null);
    if (!title.trim()) {
      setActionError("Give the survey a title.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/surveys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          accessMode,
          allowedEmails: allowedEmails
            .split(/[\n,]/)
            .map((s) => s.trim())
            .filter(Boolean),
          responseLimit: responseLimit ? Number(responseLimit) : null,
          deadline: deadline ? new Date(deadline).toISOString() : null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setActionError(data.message ?? "We could not create that survey.");
        return;
      }
      setTitle("");
      setDescription("");
      setAllowedEmails("");
      setResponseLimit("");
      setDeadline("");
      setNote("Survey created. Add questions, then publish.");
      await load();
      window.location.href = `/lsg/surveys/${data.surveyId}`;
    } catch {
      setActionError("We could not reach the server. Check your connection.");
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return <p className="text-[0.9375rem] text-muted">Loading surveys…</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="card-lift rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
        <p className="eyebrow">New survey</p>
        <form onSubmit={create} className="mt-5 flex flex-col gap-4">
          <TextField id="sv-title" label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <TextField id="sv-desc" label="Description" value={description} onChange={(e) => setDescription(e.target.value)} optional />
          <div className="flex flex-col gap-2">
            <label className="text-[0.8125rem] font-semibold text-ink">Access</label>
            <select
              value={accessMode}
              onChange={(e) => setAccessMode(e.target.value)}
              className="h-12 w-full rounded-xl border border-line bg-paper/70 px-3.5 text-[0.9375rem] text-ink-deep"
            >
              <option value="public">Anyone with the link</option>
              <option value="email_list">Specific emails only</option>
              <option value="authenticated">Signed-in members of this organization</option>
            </select>
          </div>
          {accessMode === "email_list" ? (
            <TextField
              id="sv-emails"
              label="Allowed emails (one per line or comma-separated)"
              value={allowedEmails}
              onChange={(e) => setAllowedEmails(e.target.value)}
              required
            />
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="sv-limit"
              label="Response limit (optional)"
              type="number"
              value={responseLimit}
              onChange={(e) => setResponseLimit(e.target.value)}
            />
            <TextField
              id="sv-deadline"
              label="Deadline (optional)"
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </div>
          {actionError ? (
            <Enter open as="p" role="alert" className="rounded-xl border border-[#d9a99c] bg-[#a5442c]/[0.06] px-3.5 py-2.5 text-[0.8125rem] font-medium text-[#a5442c]">
              {actionError}
            </Enter>
          ) : null}
          {note ? (
            <Enter open as="p" role="status" className="rounded-xl border border-brass/40 bg-brass-soft/25 px-3.5 py-2.5 text-[0.8125rem] font-medium text-ink">
              {note}
            </Enter>
          ) : null}
          <Button type="submit" disabled={creating}>
            <SwapText isPending={creating} idle="Create survey" pending="Creating…" />
          </Button>
        </form>
      </section>

      <section className="card-lift rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
        <p className="eyebrow">Your surveys</p>
        {error ? <p className="mt-3 text-[0.875rem] text-[#a5442c]">{error}</p> : null}
        {surveys.length === 0 ? (
          <p className="mt-4 text-[0.875rem] text-muted">No surveys yet.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {surveys.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-paper px-4 py-3">
                <div>
                  <p className="text-[0.9375rem] font-medium text-ink-deep">{s.title}</p>
                  <p className="text-[0.75rem] text-muted">
                    {s.status} · {s.responseCount} response(s) · {s.accessMode}
                  </p>
                </div>
                <a
                  href={`/lsg/surveys/${s.id}`}
                  className="inline-flex min-h-9 items-center rounded-lg border border-line px-3 text-[0.875rem] hover:bg-canvas"
                >
                  Open
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}