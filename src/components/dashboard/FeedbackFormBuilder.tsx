"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ActionError, UNIT_TYPE_OPTIONS, selectClass } from "@/components/dashboard/workspace-shared";
import {
  FeedbackQuestionEditor,
  feedbackQuestionIssue,
} from "@/components/dashboard/FeedbackQuestionEditor";
import { useDashboard } from "@/components/dashboard/dashboard-context";
import type {
  FeedbackAccessMode,
  FeedbackForm,
  FeedbackFormScope,
  FeedbackIdentityMode,
  FeedbackQuestion,
  FeedbackQuestionInput,
  FeedbackScope,
} from "@/lib/feedback-forms";

type UnitOption = { id: string; name: string; unitType: string };

const STATUS_LABEL: Record<FeedbackForm["status"], string> = {
  draft: "Draft",
  open: "Open",
  closed: "Closed",
};

function toQuestionInput(question: FeedbackQuestion): FeedbackQuestionInput {
  return {
    qtype: question.qtype,
    fieldKey: question.fieldKey,
    title: question.title,
    description: question.description,
    required: question.required,
    options: question.options,
    scaleMin: question.scaleMin,
    scaleMax: question.scaleMax,
    scaleLabelLow: question.scaleLabelLow,
    scaleLabelHigh: question.scaleLabelHigh,
  };
}

function messageFrom(json: Record<string, unknown>, fallback: string) {
  return typeof json.message === "string" && json.message.trim()
    ? json.message
    : fallback;
}

function absoluteUrl(path: string) {
  return new URL(path, window.location.origin).toString();
}

export function FeedbackFormBuilder({
  formId,
  side,
  onBack,
  onChanged,
}: {
  formId: string;
  side: "usg" | "lsg";
  onBack: () => void;
  onChanged: () => void;
}) {
  const { role } = useDashboard();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FeedbackForm | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<FeedbackScope>("unit");
  const [accessMode, setAccessMode] = useState<FeedbackAccessMode>("signed_in");
  const [identityMode, setIdentityMode] = useState<FeedbackIdentityMode>("identified");
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [unitTypes, setUnitTypes] = useState<string[]>([]);
  const [questions, setQuestions] = useState<FeedbackQuestionInput[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canTargetUnits = role.permissions.includes("can_target_units");
  const showUnitPicker = side === "usg" || canTargetUnits;
  const frozen = form?.openedAt !== null && form?.openedAt !== undefined;
  const questionsLocked = Boolean(form?.questionsLocked);
  const questionIssue = questions
    .map((question) => feedbackQuestionIssue(question))
    .find((issue): issue is string => Boolean(issue));
  const canSave =
    Boolean(form) &&
    title.trim().length >= 3 &&
    (questionsLocked || (questions.length > 0 && !questionIssue)) &&
    !busy;

  const load = useCallback(async () => {
    setState("loading");
    setLoadError(null);
    try {
      const response = await fetch(`/api/feedback/forms/${formId}`, {
        cache: "no-store",
      });
      const json = (await response.json()) as Record<string, unknown> & {
        form?: FeedbackForm;
        scopes?: FeedbackFormScope[];
        questions?: FeedbackQuestion[];
      };
      if (!response.ok || json.ok !== true || !json.form) {
        throw new Error(messageFrom(json, "We could not load this form."));
      }
      const nextForm = json.form;
      setForm(nextForm);
      setTitle(nextForm.title);
      setDescription(nextForm.description ?? "");
      setScope(nextForm.scope);
      setAccessMode(nextForm.accessMode);
      setIdentityMode(nextForm.identityMode);
      setUnitIds(
        (json.scopes ?? [])
          .map((item) => item.unitId)
          .filter((value): value is string => Boolean(value)),
      );
      setUnitTypes(
        (json.scopes ?? [])
          .map((item) => item.unitType)
          .filter((value): value is string => Boolean(value)),
      );
      setQuestions((json.questions ?? []).map(toQuestionInput));
      setState("ready");
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "We could not load this form.",
      );
      setState("error");
    }
  }, [formId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/units", { cache: "no-store" })
      .then((response) => response.json())
      .then((json: { units?: UnitOption[] }) => {
        if (!cancelled) setUnits(json.units ?? []);
      })
      .catch(() => {
        if (!cancelled) setUnits([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleUnit = (unitId: string) => {
    if (scope === "unit") {
      setUnitIds([unitId]);
      return;
    }
    setUnitIds((current) =>
      current.includes(unitId)
        ? current.filter((value) => value !== unitId)
        : [...current, unitId],
    );
  };

  const toggleUnitType = (unitType: string) => {
    setUnitTypes((current) =>
      current.includes(unitType)
        ? current.filter((value) => value !== unitType)
        : [...current, unitType],
    );
  };

  const validateAudience = () => {
    if (scope === "unit_type" && unitTypes.length === 0) {
      return "Select at least one unit type.";
    }
    if (showUnitPicker && (scope === "units" || scope === "unit")) {
      if (unitIds.length === 0) return "Select at least one unit.";
      if (scope === "unit" && unitIds.length !== 1) {
        return "Single-unit forms target exactly one unit.";
      }
    }
    return null;
  };

  const save = async () => {
    if (!form) return;
    setActionError(null);
    setNotice(null);
    if (title.trim().length < 3) {
      setActionError("Give the form a title with at least three characters.");
      return;
    }
    const audienceError = validateAudience();
    if (audienceError) {
      setActionError(audienceError);
      return;
    }
    if (!questionsLocked && questions.length === 0) {
      setActionError("Add at least one question before saving.");
      return;
    }
    if (!questionsLocked && questionIssue) {
      setActionError(questionIssue);
      return;
    }

    setBusy(true);
    const failures: string[] = [];
    try {
      const metaResponse = await fetch(`/api/feedback/forms/${form.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() ? description.trim() : null,
          scope,
          unitIds: scope === "units" || scope === "unit" ? unitIds : [],
          unitTypes: scope === "unit_type" ? unitTypes : [],
          accessMode,
          identityMode,
        }),
      });
      const metaJson = (await metaResponse.json()) as Record<string, unknown>;
      if (!metaResponse.ok || metaJson.ok !== true) {
        failures.push(messageFrom(metaJson, "Could not save the form details."));
      }
    } catch (error) {
      failures.push(
        error instanceof Error ? error.message : "Could not save the form details.",
      );
    }

    if (!questionsLocked) {
      try {
        const questionResponse = await fetch(
          `/api/feedback/forms/${form.id}/questions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ questions }),
          },
        );
        const questionJson = (await questionResponse.json()) as Record<
          string,
          unknown
        >;
        if (!questionResponse.ok || questionJson.ok !== true) {
          failures.push(
            messageFrom(questionJson, "Could not save the questions."),
          );
        }
      } catch (error) {
        failures.push(
          error instanceof Error ? error.message : "Could not save the questions.",
        );
      }
    }

    setBusy(false);
    if (failures.length > 0) {
      setActionError(failures.join(" "));
      return;
    }
    setNotice("Saved.");
    await load();
    onChanged();
  };

  const changeStatus = async (status: "open" | "closed") => {
    if (!form) return;
    setStatusBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/feedback/forms/${form.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = (await response.json()) as Record<string, unknown>;
      if (!response.ok || json.ok !== true) {
        throw new Error(messageFrom(json, "Could not change the form status."));
      }
      setNotice(status === "open" ? "Form opened." : "Form closed.");
      await load();
      onChanged();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Could not change the form status.",
      );
    } finally {
      setStatusBusy(false);
    }
  };

  const regenerateLink = async () => {
    if (!form) return;
    setStatusBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/feedback/forms/${form.id}/link`, {
        method: "POST",
      });
      const json = (await response.json()) as Record<string, unknown> & {
        publicPath?: string;
      };
      if (!response.ok || json.ok !== true || !json.publicPath) {
        throw new Error(messageFrom(json, "Could not regenerate the link."));
      }
      setForm((current) =>
        current ? { ...current, publicPath: json.publicPath ?? null } : current,
      );
      setNotice("Public link regenerated.");
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Could not regenerate the link.",
      );
    } finally {
      setStatusBusy(false);
    }
  };

  const copyLink = async () => {
    if (!form?.publicPath) return;
    try {
      await navigator.clipboard.writeText(absoluteUrl(form.publicPath));
      setNotice("Public link copied.");
    } catch {
      setActionError("Could not copy the link. Select it manually instead.");
    }
  };

  const remove = async () => {
    if (!form) return;
    if (form.responseCount > 0) {
      setActionError("Forms with responses cannot be deleted.");
      return;
    }
    if (!window.confirm("Delete this feedback form? This cannot be undone.")) {
      return;
    }
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/feedback/forms/${form.id}`, {
        method: "DELETE",
      });
      const json = (await response.json()) as Record<string, unknown>;
      if (!response.ok || json.ok !== true) {
        throw new Error(messageFrom(json, "Could not delete the form."));
      }
      onChanged();
      onBack();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Could not delete the form.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (state === "loading") {
    return (
      <div data-testid="feedback-form-builder" className="grid gap-3">
        <div className="h-24 animate-pulse rounded-2xl bg-ink/[0.05]" />
        <div className="h-48 animate-pulse rounded-2xl bg-ink/[0.05]" />
      </div>
    );
  }

  if (state === "error" || !form) {
    return (
      <div
        data-testid="feedback-form-builder"
        className="rounded-2xl border border-line bg-paper p-5"
      >
        <ActionError message={loadError ?? "We could not load this form."} />
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => void load()}>
            Try again
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onBack}>
            Back to forms
          </Button>
        </div>
      </div>
    );
  }

  const statusTone =
    form.status === "open"
      ? "border-[#b6d2b0] bg-[#3f7d3a]/[0.08] text-[#2f5f2b]"
      : form.status === "closed"
        ? "border-line bg-ink/[0.04] text-ink-muted"
        : "border-[#e3cfa0] bg-[#a8822f]/[0.08] text-[#7a5d1c]";

  return (
    <section data-testid="feedback-form-builder" className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            type="button"
            className="text-xs font-medium text-ink-muted underline-offset-2 hover:text-ink hover:underline"
            onClick={onBack}
          >
            Back to forms
          </button>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-ink-deep">
              {title.trim() || "Untitled feedback form"}
            </h2>
            <span
              className={`rounded-full border px-2.5 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] ${statusTone}`}
            >
              {STATUS_LABEL[form.status]}
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            {form.responseCount} response{form.responseCount === 1 ? "" : "s"} ·{" "}
            {form.questionCount} question{form.questionCount === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => void save()}
            disabled={!canSave}
          >
            {busy ? "Saving…" : "Save"}
          </Button>
          {form.status === "draft" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void changeStatus("open")}
              disabled={statusBusy || form.questionCount === 0}
            >
              Open form
            </Button>
          ) : null}
          {form.status === "open" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void changeStatus("closed")}
              disabled={statusBusy}
            >
              Close form
            </Button>
          ) : null}
          {form.status === "closed" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void changeStatus("open")}
              disabled={statusBusy}
            >
              Reopen form
            </Button>
          ) : null}
        </div>
      </div>

      <ActionError message={actionError} />
      {notice ? (
        <p
          role="status"
          className="rounded-xl border border-[#b6d2b0] bg-[#3f7d3a]/[0.08] px-3.5 py-2.5 text-[0.8125rem] font-medium text-[#2f5f2b]"
        >
          {notice}
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid gap-5">
          <section className="rounded-2xl border border-line bg-paper p-5">
            <h3 className="font-display text-lg font-semibold text-ink-deep">
              Details
            </h3>
            <div className="mt-4 grid gap-3">
              <label className="grid gap-1.5">
                <span className="text-sm font-medium text-ink-deep">Title</span>
                <input
                  type="text"
                  className={selectClass}
                  value={title}
                  maxLength={200}
                  onChange={(event) => setTitle(event.target.value)}
                  disabled={busy}
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-sm font-medium text-ink-deep">
                  Description (optional)
                </span>
                <textarea
                  className="min-h-24 w-full resize-y rounded-xl border border-line bg-paper/70 px-3.5 py-3 text-[0.9375rem] leading-relaxed text-ink-deep outline-none transition-[border-color,box-shadow,background-color] duration-300 hover:border-line-strong focus:border-ink/25 focus:bg-paper"
                  value={description}
                  maxLength={4000}
                  onChange={(event) => setDescription(event.target.value)}
                  disabled={busy}
                />
              </label>
            </div>
          </section>

          <FeedbackQuestionEditor
            questions={questions}
            onChange={setQuestions}
            locked={questionsLocked}
          />
        </div>

        <div className="grid content-start gap-5">
          <section className="rounded-2xl border border-line bg-paper p-5">
            <h3 className="font-display text-lg font-semibold text-ink-deep">
              Audience
            </h3>
            {frozen ? (
              <p
                data-reason="form_locked"
                className="mt-2 rounded-xl border border-line bg-paper/70 px-3.5 py-2.5 text-xs text-ink-muted"
              >
                Audience, access, and identity are locked after the form opens.
              </p>
            ) : null}
            <div className="mt-4 grid gap-3">
              <label className="grid gap-1.5">
                <span className="text-sm font-medium text-ink-deep">Scope</span>
                <select
                  className={selectClass}
                  value={scope}
                  onChange={(event) => setScope(event.target.value as FeedbackScope)}
                  disabled={frozen || busy}
                >
                  {side === "usg" ? (
                    <>
                      <option value="university">Entire university</option>
                      <option value="unit_type">By unit type</option>
                    </>
                  ) : null}
                  <option value="units">Selected units</option>
                  <option value="unit">Single unit</option>
                </select>
              </label>

              {scope === "unit_type" ? (
                <div className="grid gap-2">
                  <p className="text-sm font-medium text-ink-deep">Unit types</p>
                  {UNIT_TYPE_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className="flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-paper/70 px-3 py-2.5 text-sm text-ink-deep"
                    >
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--color-brass-deep)]"
                        checked={unitTypes.includes(option.value)}
                        onChange={() => toggleUnitType(option.value)}
                        disabled={frozen || busy}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              ) : null}

              {scope === "units" || scope === "unit" ? (
                showUnitPicker ? (
                  <div className="grid gap-2">
                    <p className="text-sm font-medium text-ink-deep">
                      {scope === "unit" ? "Unit" : "Units"}
                    </p>
                    {units.length === 0 ? (
                      <p className="text-xs text-ink-muted">No units available.</p>
                    ) : (
                      <div className="grid max-h-64 gap-2 overflow-y-auto pr-1">
                        {units.map((unit) => (
                          <label
                            key={unit.id}
                            className="flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-paper/70 px-3 py-2.5 text-sm text-ink-deep"
                          >
                            <input
                              type={scope === "unit" ? "radio" : "checkbox"}
                              name={`feedback-unit-${form.id}`}
                              className="size-4 accent-[var(--color-brass-deep)]"
                              checked={unitIds.includes(unit.id)}
                              onChange={() => toggleUnit(unit.id)}
                              disabled={frozen || busy}
                            />
                            <span>
                              {unit.name}
                              <span className="ml-1.5 text-xs text-ink-muted">
                                {unit.unitType}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="rounded-xl border border-line bg-paper/70 px-3.5 py-2.5 text-xs text-ink-muted">
                    Your own units are targeted automatically.
                  </p>
                )
              ) : null}

              {side === "usg" || canTargetUnits ? (
                <p className="text-xs text-ink-muted">
                  Cross-unit targeting is enabled for you.
                </p>
              ) : null}
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-paper p-5">
            <h3 className="font-display text-lg font-semibold text-ink-deep">
              Access
            </h3>
            <div className="mt-4 grid gap-2">
              <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-line bg-paper/70 px-3 py-2.5 text-sm text-ink-deep">
                <input
                  type="radio"
                  name={`feedback-access-${form.id}`}
                  className="mt-0.5 size-4 accent-[var(--color-brass-deep)]"
                  checked={accessMode === "signed_in"}
                  onChange={() => setAccessMode("signed_in")}
                  disabled={frozen || busy}
                />
                <span>
                  <span className="font-medium">Signed-in only</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    No public link is created.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-line bg-paper/70 px-3 py-2.5 text-sm text-ink-deep">
                <input
                  type="radio"
                  name={`feedback-access-${form.id}`}
                  className="mt-0.5 size-4 accent-[var(--color-brass-deep)]"
                  checked={accessMode === "public_link"}
                  onChange={() => setAccessMode("public_link")}
                  disabled={frozen || busy}
                />
                <span>
                  <span className="font-medium">Public link</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    Anyone with the link can answer.
                  </span>
                </span>
              </label>
            </div>

            {accessMode === "public_link" ? (
              <div className="mt-3 rounded-xl border border-line bg-paper/70 p-3">
                {form.publicPath ? (
                  <>
                    <p className="break-all text-xs text-ink-muted">
                      {absoluteUrl(form.publicPath)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void copyLink()}
                      >
                        Copy link
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => void regenerateLink()}
                        disabled={statusBusy}
                      >
                        Regenerate link
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-ink-muted">
                    Open the form to generate a public link.
                  </p>
                )}
              </div>
            ) : null}
          </section>

          <section className="rounded-2xl border border-line bg-paper p-5">
            <h3 className="font-display text-lg font-semibold text-ink-deep">
              Identity
            </h3>
            <div className="mt-4 grid gap-2">
              <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-line bg-paper/70 px-3 py-2.5 text-sm text-ink-deep">
                <input
                  type="radio"
                  name={`feedback-identity-${form.id}`}
                  className="mt-0.5 size-4 accent-[var(--color-brass-deep)]"
                  checked={identityMode === "identified"}
                  onChange={() => setIdentityMode("identified")}
                  disabled={frozen || busy}
                />
                <span>
                  <span className="font-medium">Identified</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    Signed-in respondents are named from their account.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-line bg-paper/70 px-3 py-2.5 text-sm text-ink-deep">
                <input
                  type="radio"
                  name={`feedback-identity-${form.id}`}
                  className="mt-0.5 size-4 accent-[var(--color-brass-deep)]"
                  checked={identityMode === "anonymous"}
                  onChange={() => setIdentityMode("anonymous")}
                  disabled={frozen || busy}
                />
                <span>
                  <span className="font-medium">Anonymous</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    Responses are not linked to an account.
                  </span>
                </span>
              </label>
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-paper p-5">
            <h3 className="font-display text-lg font-semibold text-ink-deep">
              Danger zone
            </h3>
            <p className="mt-1 text-xs text-ink-muted">
              Forms with responses cannot be deleted.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => void remove()}
              disabled={busy || form.responseCount > 0}
            >
              Delete form
            </Button>
          </section>
        </div>
      </div>
    </section>
  );
}
