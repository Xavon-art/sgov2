"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ActionError } from "@/components/dashboard/workspace-shared";
import { FeedbackFormBuilder } from "@/components/dashboard/FeedbackFormBuilder";
import type { FeedbackFormSummary } from "@/lib/feedback-forms";

const STATUS_LABEL: Record<FeedbackFormSummary["status"], string> = {
  draft: "Draft",
  open: "Open",
  closed: "Closed",
};

function messageFrom(json: Record<string, unknown>, fallback: string) {
  return typeof json.message === "string" && json.message.trim()
    ? json.message
    : fallback;
}

function absoluteUrl(path: string) {
  return new URL(path, window.location.origin).toString();
}

export function FeedbackFormsPanel({ side }: { side: "usg" | "lsg" }) {
  const [rows, setRows] = useState<FeedbackFormSummary[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const response = await fetch("/api/feedback/forms", { cache: "no-store" });
      const json = (await response.json()) as Record<string, unknown> & {
        rows?: FeedbackFormSummary[];
      };
      if (!response.ok || json.ok !== true) {
        throw new Error(messageFrom(json, "We could not load the forms."));
      }
      setRows(json.rows ?? []);
      setState("ready");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "We could not load the forms.",
      );
      setState("error");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/feedback/forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Untitled feedback form",
          description: null,
          scope: side === "usg" ? "university" : "units",
          unitIds: [],
          unitTypes: [],
          accessMode: "signed_in",
          identityMode: "identified",
        }),
      });
      const json = (await response.json()) as Record<string, unknown> & {
        formId?: string;
      };
      if (!response.ok || json.ok !== true || !json.formId) {
        throw new Error(messageFrom(json, "We could not create the form."));
      }
      await load();
      setSelected(json.formId);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "We could not create the form.",
      );
    } finally {
      setCreating(false);
    }
  };

  const changeStatus = async (
    row: FeedbackFormSummary,
    status: "open" | "closed",
  ) => {
    setBusyId(row.id);
    setError(null);
    try {
      const response = await fetch(`/api/feedback/forms/${row.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = (await response.json()) as Record<string, unknown>;
      if (!response.ok || json.ok !== true) {
        throw new Error(messageFrom(json, "Could not change the form status."));
      }
      await load();
    } catch (statusError) {
      setError(
        statusError instanceof Error
          ? statusError.message
          : "Could not change the form status.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const regenerate = async (row: FeedbackFormSummary) => {
    setBusyId(row.id);
    setError(null);
    try {
      const response = await fetch(`/api/feedback/forms/${row.id}/link`, {
        method: "POST",
      });
      const json = (await response.json()) as Record<string, unknown> & {
        publicPath?: string;
      };
      if (!response.ok || json.ok !== true || !json.publicPath) {
        throw new Error(messageFrom(json, "Could not regenerate the link."));
      }
      setRows((current) =>
        current.map((item) =>
          item.id === row.id ? { ...item, publicPath: json.publicPath ?? null } : item,
        ),
      );
    } catch (linkError) {
      setError(
        linkError instanceof Error
          ? linkError.message
          : "Could not regenerate the link.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const copy = async (row: FeedbackFormSummary) => {
    if (!row.publicPath) return;
    try {
      await navigator.clipboard.writeText(absoluteUrl(row.publicPath));
    } catch {
      setError("Could not copy the link. Select it in the builder instead.");
    }
  };

  const remove = async (row: FeedbackFormSummary) => {
    if (row.responseCount > 0) {
      setError("Forms with responses cannot be deleted.");
      return;
    }
    if (!window.confirm("Delete this feedback form? This cannot be undone.")) {
      return;
    }
    setBusyId(row.id);
    setError(null);
    try {
      const response = await fetch(`/api/feedback/forms/${row.id}`, {
        method: "DELETE",
      });
      const json = (await response.json()) as Record<string, unknown>;
      if (!response.ok || json.ok !== true) {
        throw new Error(messageFrom(json, "Could not delete the form."));
      }
      await load();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete the form.",
      );
    } finally {
      setBusyId(null);
    }
  };

  if (selected) {
    return (
      <FeedbackFormBuilder
        formId={selected}
        side={side}
        onBack={() => setSelected(null)}
        onChanged={() => void load()}
      />
    );
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-tight text-ink-deep">
            Feedback forms
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Build forms, control who can answer, and review the responses.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          data-testid="feedback-form-new"
          onClick={() => void create()}
          disabled={creating}
        >
          {creating ? "Creating…" : "New form"}
        </Button>
      </div>

      <ActionError message={error} />

      {state === "loading" ? (
        <div className="grid gap-3">
          <div className="h-28 animate-pulse rounded-2xl bg-ink/[0.05]" />
          <div className="h-28 animate-pulse rounded-2xl bg-ink/[0.05]" />
        </div>
      ) : null}

      {state === "error" ? (
        <div className="rounded-2xl border border-line bg-paper p-5">
          <p className="text-sm text-ink-muted">We could not load the forms.</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => void load()}
          >
            Try again
          </Button>
        </div>
      ) : null}

      {state === "ready" && rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-paper/60 px-5 py-10 text-center">
          <p className="text-sm font-medium text-ink-deep">No feedback forms yet.</p>
          <p className="mt-1 text-sm text-ink-muted">
            Create a form to collect structured feedback.
          </p>
        </div>
      ) : null}

      {state === "ready" && rows.length > 0 ? (
        <div data-testid="feedback-form-list" className="grid gap-3">
          {rows.map((row) => {
            const tone =
              row.status === "open"
                ? "border-[#b6d2b0] bg-[#3f7d3a]/[0.08] text-[#2f5f2b]"
                : row.status === "closed"
                  ? "border-line bg-ink/[0.04] text-ink-muted"
                  : "border-[#e3cfa0] bg-[#a8822f]/[0.08] text-[#7a5d1c]";
            return (
              <article
                key={row.id}
                className="rounded-2xl border border-line bg-paper p-4 sm:p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-lg font-semibold text-ink-deep">
                        {row.title}
                      </h3>
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] ${tone}`}
                      >
                        {STATUS_LABEL[row.status]}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-ink-muted">
                      {row.audienceSummary} · {row.responseCount} response
                      {row.responseCount === 1 ? "" : "s"} · {row.questionCount}{" "}
                      question{row.questionCount === 1 ? "" : "s"}
                    </p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {row.accessMode === "signed_in" ? "Signed-in only" : "Public link"} ·{" "}
                      {row.identityMode === "identified" ? "Identified" : "Anonymous"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setSelected(row.id)}
                    >
                      Edit
                    </Button>
                    {row.status === "draft" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void changeStatus(row, "open")}
                        disabled={busyId === row.id || row.questionCount === 0}
                      >
                        Open
                      </Button>
                    ) : null}
                    {row.status === "open" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void changeStatus(row, "closed")}
                        disabled={busyId === row.id}
                      >
                        Close
                      </Button>
                    ) : null}
                    {row.status === "closed" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void changeStatus(row, "open")}
                        disabled={busyId === row.id}
                      >
                        Reopen
                      </Button>
                    ) : null}
                    {row.publicPath ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => void copy(row)}
                      >
                        Copy link
                      </Button>
                    ) : null}
                    {row.publicPath ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => void regenerate(row)}
                        disabled={busyId === row.id}
                      >
                        Regenerate
                      </Button>
                    ) : null}
                    {row.responseCount === 0 ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => void remove(row)}
                        disabled={busyId === row.id}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
