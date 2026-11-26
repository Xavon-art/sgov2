"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Enter } from "@/components/fx/Presence";
import { SwapText } from "@/components/fx/SwapText";
import { TextField } from "@/components/ui/Field";
import { useAccount } from "@/components/dashboard/dashboard-context";
import { NotAvailable } from "@/components/dashboard/NotAvailable";
import { FeedbackFormBuilder } from "@/components/dashboard/FeedbackFormBuilder";
import { FeedbackResponsesPanel } from "@/components/dashboard/FeedbackResponsesPanel";
import { SurveyDetailEditor } from "@/components/dashboard/SurveyDetailEditor";
import { ActionError, SectionIcon } from "@/components/dashboard/workspace-shared";
import { IconMonitoring, IconPencil } from "@/components/ui/Icons";
import { SurveyResultsPanel } from "@/components/forms/SurveyResultsPanel";

type FormKind = "survey" | "feedback";
type KindFilter = FormKind | "all";
type View = "forms" | "responses";

type FormRow = {
  id: string;
  kind: FormKind;
  title: string;
  status: string;
  responseCount: number;
  publicPath: string | null;
};

type SurveyRow = {
  id: string;
  title: string;
  status: string;
  responseCount: number;
};

type FeedbackRow = {
  id: string;
  title: string;
  status: string;
  responseCount: number;
  publicPath: string | null;
};

const KIND_LABEL: Record<FormKind, string> = {
  survey: "Survey",
  feedback: "Feedback form",
};

function messageFrom(json: Record<string, unknown>, fallback: string) {
  return typeof json.message === "string" && json.message.trim() ? json.message : fallback;
}

export function FormsWorkspace({ side }: { side: "usg" | "lsg" }) {
  const account = useAccount();
  const router = useRouter();
  const searchParams = useSearchParams();
  const base = side === "usg" ? "/usg" : "/lsg";
  const canManageSurveys = side === "lsg" || account.accountScope === "owner";

  const rawKind = searchParams.get("type");
  const kind: KindFilter = rawKind === "survey" || rawKind === "feedback" ? rawKind : "all";
  const view: View = searchParams.get("view") === "responses" ? "responses" : "forms";
  const selectedId = searchParams.get("id");

  const [rows, setRows] = useState<FormRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [creatingSurvey, setCreatingSurvey] = useState(false);
  const [creatingFeedback, setCreatingFeedback] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [accessMode, setAccessMode] = useState("public");
  const [allowedEmails, setAllowedEmails] = useState("");
  const [responseLimit, setResponseLimit] = useState("");
  const [deadline, setDeadline] = useState("");

  const setQuery = useCallback(
    (next: { kind?: KindFilter; view?: View; id?: string | null }) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next.kind) {
        if (next.kind === "all") params.delete("type");
        else params.set("type", next.kind);
      }
      if (next.view) {
        if (next.view === "forms") params.delete("view");
        else params.set("view", next.view);
      }
      if (next.id !== undefined) {
        if (next.id) params.set("id", next.id);
        else params.delete("id");
      }
      const query = params.toString();
      router.replace(query ? `${base}/forms?${query}` : `${base}/forms`, { scroll: false });
    },
    [base, router, searchParams],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const nextRows: FormRow[] = [];
    const problems: string[] = [];

    if (canManageSurveys) {
      try {
        const response = await fetch("/api/surveys", { cache: "no-store" });
        const json = (await response.json()) as Record<string, unknown> & {
          surveys?: SurveyRow[];
        };
        if (!response.ok || !json.ok) {
          problems.push(messageFrom(json, "We could not load surveys."));
        } else {
          for (const row of json.surveys ?? []) {
            nextRows.push({
              id: row.id,
              kind: "survey",
              title: row.title,
              status: row.status,
              responseCount: row.responseCount,
              publicPath: `/forms/survey/${row.id}`,
            });
          }
        }
      } catch {
        problems.push("We could not reach the server. Check your connection.");
      }
    }

    try {
      const response = await fetch("/api/feedback/forms", { cache: "no-store" });
      const json = (await response.json()) as Record<string, unknown> & {
        rows?: FeedbackRow[];
      };
      if (!response.ok || json.ok !== true) {
        problems.push(messageFrom(json, "We could not load feedback forms."));
      } else {
        for (const row of json.rows ?? []) {
          nextRows.push({
            id: row.id,
            kind: "feedback",
            title: row.title,
            status: row.status,
            responseCount: row.responseCount,
            publicPath: row.publicPath ?? null,
          });
        }
      }
    } catch {
      problems.push("We could not reach the server. Check your connection.");
    }

    setRows(nextRows);
    if (problems.length > 0) setError(problems[0]);
    setLoading(false);
  }, [canManageSurveys]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const createSurvey = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setError("Give the survey a title.");
      return;
    }
    setCreatingSurvey(true);
    setError(null);
    setNote(null);
    try {
      const response = await fetch("/api/surveys", {
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
                  .map((value) => value.trim().toLowerCase())
                  .filter(Boolean)
              : [],
          responseLimit: responseLimit ? Number(responseLimit) : null,
          deadline: deadline ? new Date(deadline).toISOString() : null,
        }),
      });
      const json = (await response.json()) as Record<string, unknown> & { surveyId?: string };
      if (!response.ok || !json.ok || !json.surveyId) {
        throw new Error(messageFrom(json, "We could not create that survey."));
      }
      setTitle("");
      setDescription("");
      setAllowedEmails("");
      setResponseLimit("");
      setDeadline("");
      setNote("Survey created.");
      await load();
      setQuery({ kind: "survey", view: "forms", id: json.surveyId });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "We could not create that survey.");
    } finally {
      setCreatingSurvey(false);
    }
  };

  const createFeedback = async () => {
    setCreatingFeedback(true);
    setError(null);
    setNote(null);
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
      const json = (await response.json()) as Record<string, unknown> & { formId?: string };
      if (!response.ok || json.ok !== true || !json.formId) {
        throw new Error(messageFrom(json, "We could not create the feedback form."));
      }
      setNote("Feedback form created.");
      await load();
      setQuery({ kind: "feedback", view: "forms", id: json.formId });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "We could not create the feedback form.");
    } finally {
      setCreatingFeedback(false);
    }
  };

  const copyLink = async (row: FormRow) => {
    if (!row.publicPath) return;
    try {
      await navigator.clipboard.writeText(new URL(row.publicPath, window.location.origin).toString());
      setNote(`${KIND_LABEL[row.kind]} link copied.`);
    } catch {
      setError("Could not copy the link. Open the form and copy it there instead.");
    }
  };

  const visibleRows = rows.filter((row) => kind === "all" || row.kind === kind);
  const selectedRow = selectedId ? rows.find((row) => row.id === selectedId) : null;

  return (
    <div className="flex flex-col gap-6">
      <header data-tour="forms-header" className="border-b border-line/80 pb-4">
        <div className="flex items-center gap-3">
          <SectionIcon>
            <IconMonitoring className="h-5 w-5" strokeWidth={1.7} />
          </SectionIcon>
          <div className="flex flex-col gap-1">
            <p className="eyebrow">Forms</p>
            <h1 className="text-[1.5rem] leading-tight sm:text-[1.75rem]">Surveys and feedback</h1>
          </div>
        </div>
        <p className="mt-3 text-[0.875rem] text-muted">
          Build a form once, share one public link, and read every response here.
        </p>
      </header>

      {note ? (
        <Enter open as="p" role="status" className="rounded-xl border border-brass/40 bg-brass-soft/25 px-3.5 py-2.5 text-[0.8125rem] font-medium text-ink">
          {note}
        </Enter>
      ) : null}
      {error ? <ActionError message={error} /> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {(["all", "survey", "feedback"] as KindFilter[]).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={kind === value}
              onClick={() => setQuery({ kind: value, id: null })}
              className={`rounded-full px-3 py-1.5 text-[0.8125rem] transition-colors duration-200 ${
                kind === value
                  ? "bg-ink text-canvas"
                  : "border border-line text-ink hover:border-line-strong"
              }`}
            >
              {value === "all" ? "All forms" : value === "survey" ? "Surveys" : "Feedback forms"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {(["forms", "responses"] as View[]).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={view === value}
              onClick={() => setQuery({ view: value })}
              className={`rounded-full px-3 py-1.5 text-[0.8125rem] transition-colors duration-200 ${
                view === value
                  ? "bg-ink text-canvas"
                  : "border border-line text-ink hover:border-line-strong"
              }`}
            >
              {value === "forms" ? "Build" : "Responses"}
            </button>
          ))}
        </div>
      </div>

      {selectedId && selectedRow && view === "forms" ? (
        <div className="flex flex-col gap-4">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setQuery({ id: null })}
          >
            Back to all forms
          </Button>
          {selectedRow.kind === "survey" ? (
            <SurveyDetailEditor id={selectedId} isUsg={side === "usg"} />
          ) : (
            <FeedbackFormBuilder
              formId={selectedId}
              side={side}
              onBack={() => setQuery({ id: null })}
              onChanged={() => void load()}
            />
          )}
        </div>
      ) : selectedId && selectedRow && view === "responses" ? (
        <div className="flex flex-col gap-4">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setQuery({ id: null })}
          >
            Back to all forms
          </Button>
          <section className="card-lift rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
            <p className="eyebrow">{KIND_LABEL[selectedRow.kind]}</p>
            <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink-deep">
              {selectedRow.title}
            </h2>
          </section>
          {selectedRow.kind === "survey" ? (
            <SurveyResultsPanel id={selectedId} />
          ) : (
            <FeedbackResponsesPanel />
          )}
        </div>
      ) : (
        <>
          <section data-tour="forms-create" className="grid gap-4 lg:grid-cols-2">
            {canManageSurveys ? (
              <form onSubmit={createSurvey} className="card-lift rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
                <p className="eyebrow inline-flex items-center gap-2">
                  <IconPencil className="h-3.5 w-3.5 text-brass-deep" strokeWidth={2} aria-hidden="true" />
                  New survey
                </p>
                <div className="mt-5 flex flex-col gap-4">
                  <TextField id="forms-survey-title" label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
                  <TextField id="forms-survey-desc" label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} optional />
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
                      id="forms-survey-emails"
                      label="Allowed emails (one per line)"
                      value={allowedEmails}
                      onChange={(e) => setAllowedEmails(e.target.value)}
                      required
                    />
                  ) : null}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField id="forms-survey-limit" label="Response limit (optional)" type="number" value={responseLimit} onChange={(e) => setResponseLimit(e.target.value)} optional />
                    <TextField id="forms-survey-deadline" label="Deadline (optional)" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} optional />
                  </div>
                  <Button type="submit" disabled={creatingSurvey}>
                    <IconPencil className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                    <SwapText isPending={creatingSurvey} idle="Create survey" pending="Creating…" />
                  </Button>
                </div>
              </form>
            ) : (
              <section className="rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
                <NotAvailable />
              </section>
            )}
            <section className="card-lift rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
              <p className="eyebrow">New feedback form</p>
              <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink-deep">
                Ask for feedback
              </h2>
              <p className="mt-3 text-[0.875rem] leading-relaxed text-body">
                Choose the audience and questions in the builder. Existing links keep working.
              </p>
              <Button
                type="button"
                className="mt-5"
                data-testid="feedback-form-new"
                disabled={creatingFeedback}
                onClick={() => void createFeedback()}
              >
                <IconPencil className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                <SwapText isPending={creatingFeedback} idle="Create feedback form" pending="Creating…" />
              </Button>
            </section>
          </section>

          <section data-tour="forms-list" className="card-lift rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
            <p className="eyebrow">Your forms ({visibleRows.length})</p>
            {loading ? (
              <p className="mt-4 text-[0.9375rem] text-muted">Loading…</p>
            ) : visibleRows.length === 0 ? (
              <p className="mt-4 text-[0.875rem] text-muted">No forms yet.</p>
            ) : (
              <ul className="mt-4 flex flex-col gap-3">
                {visibleRows.map((row) => (
                  <li key={`${row.kind}-${row.id}`} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-line bg-paper px-4 py-3">
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => setQuery({ kind: row.kind, view: "forms", id: row.id })}
                        className="text-left text-[0.9375rem] font-medium text-ink-deep hover:underline"
                      >
                        {row.title}
                      </button>
                      <p className="text-[0.75rem] text-muted">
                        {KIND_LABEL[row.kind]} · {row.status} · {row.responseCount} response(s)
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        onClick={() => setQuery({ kind: row.kind, view: "responses", id: row.id })}
                        className="pressable rounded-full border border-line px-3 py-1.5 text-[0.7rem] font-semibold text-ink hover:bg-ink/[0.04]"
                      >
                        Responses
                      </button>
                      {row.publicPath ? (
                        <button
                          type="button"
                          onClick={() => void copyLink(row)}
                          className="pressable rounded-full border border-line px-3 py-1.5 text-[0.7rem] font-semibold text-ink hover:bg-ink/[0.04]"
                        >
                          Copy link
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
