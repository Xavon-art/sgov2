"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Enter } from "@/components/fx/Presence";
import { SwapText } from "@/components/fx/SwapText";
import { TextField } from "@/components/ui/Field";
import { useAccount } from "@/components/dashboard/dashboard-context";
import { NotAvailable } from "@/components/dashboard/NotAvailable";
import { SectionIcon } from "@/components/dashboard/workspace-shared";
import { IconMonitoring, IconPencil } from "@/components/ui/Icons";

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

export function SurveysListPage({ isUsg }: { isUsg: boolean }) {
  const account = useAccount();
  const router = useRouter();
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
  const [busy, setBusy] = useState(false);

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

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setActionError("Give the survey a title.");
      return;
    }
    setCreating(true);
    setActionError(null);
    try {
      const res = await fetch("/api/surveys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          accessMode,
          allowedEmails:
            accessMode === "email_list"
              ? allowedEmails
                  .split(/[\n,]/)
                  .map((s) => s.trim().toLowerCase())
                  .filter(Boolean)
              : [],
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
      setNote("Survey created.");
      await load();
      router.push(`${isUsg ? "/usg" : "/lsg"}/forms?type=survey&id=${data.surveyId}`);
    } catch {
      setActionError("We could not reach the server. Check your connection.");
    } finally {
      setCreating(false);
    }
  };

  const duplicate = async (s: Survey) => {
    setBusy(true);
    setActionError(null);
    try {
      const detail = await fetch(`/api/surveys/${s.id}`).then((r) => r.json());
      if (!detail.ok) throw new Error(detail.message);
      const qs = detail.questions ?? [];
      const res = await fetch("/api/surveys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: s.title + " (copy)",
          description: s.description,
          accessMode: s.accessMode,
          allowedEmails: [],
          responseLimit: s.responseLimit,
          deadline: s.deadline,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.message);
      for (const q of qs) {
        const qRes = await fetch(`/api/surveys/${data.surveyId}/questions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: q.type,
            title: q.title,
            description: q.description,
            required: q.required,
            options: q.options ?? [],
            scaleMin: q.scaleMin,
            scaleMax: q.scaleMax,
            scaleLabelLow: q.scaleLabelLow,
            scaleLabelHigh: q.scaleLabelHigh,
            orderIndex: q.orderIndex,
          }),
        });
        const qData = await qRes.json();
        if (!qRes.ok || !qData.ok) throw new Error(qData.message ?? "We could not copy that question.");
      }
      setNote("Survey duplicated.");
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "We could not duplicate.");
    } finally {
      setBusy(false);
    }
  };

  if (isUsg && account.accountScope !== "owner")
    return (
      <div data-tour="surveys-not-available">
        <NotAvailable />
      </div>
    );

  if (loading) return <p className="text-[0.9375rem] text-muted">Loading…</p>;

  const base = isUsg ? "/usg" : "/lsg";

  return (
    <div className="flex flex-col gap-8">
      <header data-tour="surveys-header" className="border-b border-line/80 pb-4">
        <div className="flex items-center gap-3">
          <SectionIcon>
            <IconMonitoring className="h-5 w-5" strokeWidth={1.7} />
          </SectionIcon>
          <div className="flex flex-col gap-1">
            <p className="eyebrow">Survey</p>
            <h1 className="text-[1.5rem] leading-tight sm:text-[1.75rem]">Surveys</h1>
          </div>
        </div>
        <p className="mt-3 text-[0.875rem] text-muted">
          Build forms, collect responses, and review results.
        </p>
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
      {error ? <p className="text-[0.875rem] text-[#a5442c]">{error}</p> : null}

      <section data-tour="surveys-create" className="card-lift rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
        <p className="eyebrow inline-flex items-center gap-2">
          <IconPencil className="h-3.5 w-3.5 text-brass-deep" strokeWidth={2} aria-hidden="true" />
          Create a survey
        </p>
        <form onSubmit={create} className="mt-5 flex flex-col gap-4">
          <TextField id="s-title" label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <TextField id="s-desc" label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} optional />
          <div className="flex flex-col gap-2">
            <label className="text-[0.8125rem] font-semibold text-ink">Access mode</label>
            <select
              value={accessMode}
              onChange={(e) => setAccessMode(e.target.value)}
              className="h-12 w-full rounded-xl border border-line bg-paper/70 px-3.5 text-[0.9375rem] text-ink-deep"
            >
              <option value="public">Public</option>
              <option value="email_list">Email list</option>
              <option value="authenticated">Authenticated</option>
            </select>
          </div>
          {accessMode === "email_list" ? (
            <TextField
              id="s-emails"
              label="Allowed emails (one per line)"
              value={allowedEmails}
              onChange={(e) => setAllowedEmails(e.target.value)}
              required
            />
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField id="s-limit" label="Response limit (optional)" type="number" value={responseLimit} onChange={(e) => setResponseLimit(e.target.value)} optional />
            <TextField id="s-deadline" label="Deadline (optional)" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} optional />
          </div>
          <Button type="submit" disabled={creating}>
            <IconPencil className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            <SwapText isPending={creating} idle="Create survey" pending="Creating…" />
          </Button>
        </form>
      </section>

      <section data-tour="surveys-list" className="card-lift rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
        <p className="eyebrow">Your surveys ({surveys.length})</p>
        {surveys.length === 0 ? (
          <p className="mt-4 text-[0.875rem] text-muted">No surveys yet.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {surveys.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-3 rounded-xl border border-line bg-paper px-4 py-3">
                <div>
                  <Link href={`${base}/surveys/${s.id}`} aria-label="Open internal survey detail" className="text-[0.9375rem] font-medium text-ink-deep hover:underline">
                    {s.title}
                  </Link>
                  <p className="text-[0.75rem] text-muted">
                    {s.status} · {s.accessMode} · {s.responseCount} response(s)
                  </p>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => void duplicate(s)}
                    disabled={busy}
                    className="pressable rounded-full border border-line px-3 py-1.5 text-[0.7rem] font-semibold text-ink hover:bg-ink/[0.04]"
                  >
                    Duplicate
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}