"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Enter } from "@/components/fx/Presence";
import { SwapText } from "@/components/fx/SwapText";
import { TextField } from "@/components/ui/Field";

type PR = {
  id: string;
  title: string;
  purpose: string | null;
  coverLetter: string | null;
  supportDocument: string | null;
  deadline: string | null;
  timezone: string | null;
  status: string;
  decisionNote: string | null;
  createdAt: string;
};

export default function LsgPersonalRequestsPage() {
  const [requests, setRequests] = useState<PR[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [coverLetter, setCoverLetter] = useState("");
  const [supportDocument, setSupportDocument] = useState("");
  const [deadline, setDeadline] = useState("");
  const [timezone, setTimezone] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/personal-requests");
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.message ?? "We could not load requests.");
        return;
      }
      setRequests(data.requests ?? []);
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
      setActionError("Give the request a title.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/personal-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          purpose: purpose.trim(),
          coverLetter: coverLetter.trim(),
          supportDocument: supportDocument.trim(),
          deadline: deadline ? new Date(deadline).toISOString() : null,
          timezone: timezone.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setActionError(data.message ?? "We could not submit that request.");
        return;
      }
      setTitle("");
      setPurpose("");
      setCoverLetter("");
      setSupportDocument("");
      setDeadline("");
      setTimezone("");
      setNote("Request submitted to the USG office.");
      await load();
    } catch {
      setActionError("We could not reach the server. Check your connection.");
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <p className="text-[0.9375rem] text-muted">Loading…</p>;

  return (
    <div className="flex flex-col gap-8">
      <section className="card-lift rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
        <p className="eyebrow">New personal request</p>
        <form onSubmit={create} className="mt-5 flex flex-col gap-4">
          <TextField id="pr-title" label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <TextField id="pr-purpose" label="Purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} optional />
          <TextField id="pr-cover" label="Cover letter" value={coverLetter} onChange={(e) => setCoverLetter(e.target.value)} optional />
          <TextField id="pr-support" label="Support document (reference or link)" value={supportDocument} onChange={(e) => setSupportDocument(e.target.value)} optional />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField id="pr-deadline" label="Deadline (optional)" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            <TextField id="pr-tz" label="Timezone (optional)" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Asia/Manila" />
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
            <SwapText isPending={creating} idle="Submit request" pending="Submitting…" />
          </Button>
        </form>
      </section>

      <section className="card-lift rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
        <p className="eyebrow">Your requests</p>
        {error ? <p className="mt-3 text-[0.875rem] text-[#a5442c]">{error}</p> : null}
        {requests.length === 0 ? (
          <p className="mt-4 text-[0.875rem] text-muted">No requests yet.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {requests.map((r) => (
              <li key={r.id} className="rounded-card border border-line bg-paper px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[0.9375rem] font-medium text-ink-deep">{r.title}</p>
                    <p className="text-[0.75rem] text-muted">
                      {r.status}
                      {r.deadline ? ` · due ${new Date(r.deadline).toLocaleString()}` : ""}
                    </p>
                    {r.decisionNote ? (
                      <p className="mt-1 text-[0.8125rem] text-body">Note: {r.decisionNote}</p>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}