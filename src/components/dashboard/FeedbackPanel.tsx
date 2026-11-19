"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/fx/Reveal";
import { ActionError, ROW_STAGGER_MS, selectClass } from "@/components/dashboard/workspace-shared";
import { IconMail, IconPencil } from "@/components/ui/Icons";
import {
  FEEDBACK_STATUS_CLASS,
  formatFeedbackDate,
  type FeedbackEntry,
  type FeedbackStatus,
} from "@/lib/feedback";

async function mutate(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, init);
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || json.ok !== true) {
    const message =
      typeof json.message === "string" && json.message.trim()
        ? json.message
        : "That action could not be completed.";
    throw new Error(message);
  }
  return json;
}

function actionMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function StatusBadge({ status }: { status: FeedbackStatus }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${FEEDBACK_STATUS_CLASS[status]}`}>
      {status === "acknowledged" ? "Acknowledged" : "New"}
    </span>
  );
}

export function FeedbackPanel({ mode }: { mode: "submit" | "review" }) {
  const isReviewer = mode === "review";
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [rows, setRows] = useState<FeedbackEntry[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!isReviewer) return;
    setState("loading");
    try {
      const res = await fetch("/api/feedback");
      const json = await res.json();
      if (!json.ok) throw new Error(json.message);
      setRows((json.rows as FeedbackEntry[]) ?? []);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [isReviewer]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    setSuccess(null);
    try {
      await mutate("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject, message }),
      });
      setSubject("");
      setMessage("");
      setSuccess("Feedback sent. Thank you.");
    } catch (error) {
      setActionError(actionMessage(error, "We could not send that feedback."));
    } finally {
      setBusy(false);
    }
  };

  const acknowledge = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await mutate(`/api/feedback/${id}/acknowledge`, { method: "POST" });
      await load();
    } catch (error) {
      setActionError(actionMessage(error, "We could not acknowledge that feedback."));
    } finally {
      setBusy(false);
    }
  };

  if (!isReviewer) {
    return (
      <div className="rounded-2xl border border-line bg-paper/70 p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <IconMail className="h-5 w-5" strokeWidth={1.7} />
          <h2 className="text-lg font-medium">Send feedback</h2>
        </div>
        <p className="mt-2 text-sm text-body">
          Write to the USG office directly. Your message goes to your own organization.
        </p>
        <div className="mt-5 grid gap-4">
          <label className="grid gap-1">
            <span className="text-sm text-muted">Subject</span>
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              maxLength={160}
              className={selectClass}
              placeholder="What is this about?"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm text-muted">Message</span>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={6}
              maxLength={8000}
              className={selectClass}
              placeholder="Tell us what worked, what did not, and what should change."
            />
          </label>
          <ActionError message={actionError} />
          {success ? (
            <p role="status" className="text-sm text-ink">
              {success}
            </p>
          ) : null}
          <div>
            <Button
              disabled={busy || subject.trim().length < 3 || message.trim().length < 10}
              onClick={() => void submit()}
            >
              <IconPencil className="h-4 w-4" /> Send feedback
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="rounded-2xl border border-line bg-paper/70 p-5 sm:p-6">
        <h2 className="text-lg font-medium">Feedback from your units</h2>
        <p className="mt-2 text-sm text-body">
          New and Acknowledged entries stay visible here. Only reviewers can open this list.
        </p>
      </div>
      <ActionError message={actionError} />
      {state === "loading" ? <div className="text-muted">Loading...</div> : null}
      {state === "error" ? (
        <p role="alert" className="text-sm text-[#a5442c]">
          We could not load feedback. Refresh to try again.
        </p>
      ) : null}
      {state === "ready" && rows.length === 0 ? (
        <div className="rounded-2xl border border-line bg-paper p-6 text-sm text-muted">
          No feedback has been submitted yet.
        </div>
      ) : null}
      {state === "ready" ? (
        <div className="grid gap-3">
          {rows.map((row, index) => (
            <Reveal key={row.id} delay={index * ROW_STAGGER_MS}>
              <div className="rounded-2xl border border-line bg-paper p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-medium">{row.subject}</div>
                    <div className="mt-1 text-xs text-muted">
                      {formatFeedbackDate(row.createdAt)}
                      {row.acknowledgedAt
                        ? ` · acknowledged ${formatFeedbackDate(row.acknowledgedAt)}`
                        : ""}
                    </div>
                  </div>
                  <StatusBadge status={row.status} />
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm text-body">{row.message}</p>
                {row.status === "new" ? (
                  <div className="mt-4">
                    <Button size="sm" disabled={busy} onClick={() => void acknowledge(row.id)}>
                      Acknowledge
                    </Button>
                  </div>
                ) : null}
              </div>
            </Reveal>
          ))}
        </div>
      ) : null}
    </div>
  );
}
