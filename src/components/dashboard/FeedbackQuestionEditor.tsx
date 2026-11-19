"use client";

import { Button } from "@/components/ui/Button";
import { selectClass } from "@/components/dashboard/workspace-shared";
import type {
  FeedbackFieldKey,
  FeedbackQuestionInput,
  FeedbackQtype,
} from "@/lib/feedback-forms";

const QUESTION_TYPES: Array<{ value: FeedbackQtype; label: string }> = [
  { value: "short_text", label: "Short answer" },
  { value: "long_text", label: "Long answer" },
  { value: "multiple_choice", label: "Multiple choice" },
  { value: "checkbox", label: "Checkboxes" },
  { value: "dropdown", label: "Dropdown" },
  { value: "rating", label: "Rating" },
  { value: "linear_scale", label: "Linear scale" },
  { value: "date", label: "Date" },
  { value: "time", label: "Time" },
];

const QUICK_ADD: Array<{ key: FeedbackFieldKey; label: string }> = [
  { key: "full_name", label: "Full name" },
  { key: "email", label: "Email" },
  { key: "student_number", label: "Student number" },
  { key: "year_level", label: "Year level" },
  { key: "program", label: "Program" },
  { key: "section", label: "Section" },
  { key: "campus", label: "Campus" },
];

const CHOICE_TYPES = new Set<FeedbackQtype>([
  "multiple_choice",
  "checkbox",
  "dropdown",
]);

function blankQuestion(): FeedbackQuestionInput {
  return {
    qtype: "short_text",
    fieldKey: null,
    title: "",
    description: null,
    required: false,
    options: [],
    scaleMin: null,
    scaleMax: null,
    scaleLabelLow: null,
    scaleLabelHigh: null,
  };
}

function withType(
  question: FeedbackQuestionInput,
  qtype: FeedbackQtype,
): FeedbackQuestionInput {
  const next: FeedbackQuestionInput = {
    ...question,
    qtype,
    options: [],
    scaleMin: null,
    scaleMax: null,
    scaleLabelLow: null,
    scaleLabelHigh: null,
  };
  if (qtype !== "short_text") next.fieldKey = null;
  if (CHOICE_TYPES.has(qtype)) {
    next.options =
      question.options.length >= 2
        ? question.options
        : ["Option 1", "Option 2"];
  }
  if (qtype === "linear_scale") {
    next.scaleMin = 1;
    next.scaleMax = 5;
  }
  return next;
}

export function feedbackQuestionIssue(
  question: FeedbackQuestionInput,
): string | null {
  if (!question.title.trim()) return "Every question needs a title.";
  if (CHOICE_TYPES.has(question.qtype)) {
    if (question.options.length < 2) {
      return "Choice questions need at least two options.";
    }
    if (question.options.some((option) => !option.trim())) {
      return "Every choice option needs a label.";
    }
  }
  if (question.qtype === "linear_scale") {
    if (
      question.scaleMin === null ||
      question.scaleMax === null ||
      question.scaleMin >= question.scaleMax
    ) {
      return "Linear scale questions need a minimum below the maximum.";
    }
  }
  return null;
}

export function FeedbackQuestionEditor({
  questions,
  onChange,
  locked = false,
}: {
  questions: FeedbackQuestionInput[];
  onChange: (next: FeedbackQuestionInput[]) => void;
  locked?: boolean;
}) {
  const update = (index: number, patch: Partial<FeedbackQuestionInput>) => {
    onChange(
      questions.map((question, current) =>
        current === index ? { ...question, ...patch } : question,
      ),
    );
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= questions.length) return;
    const next = [...questions];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const duplicate = (index: number) => {
    const next = [...questions];
    next.splice(index + 1, 0, {
      ...questions[index],
      title: `${questions[index].title || "Question"} (copy)`,
      fieldKey: null,
    });
    onChange(next);
  };

  const remove = (index: number) => {
    onChange(questions.filter((_, current) => current !== index));
  };

  const quickAdd = (key: FeedbackFieldKey, label: string) => {
    if (locked || questions.some((question) => question.fieldKey === key)) return;
    onChange([...questions, { ...blankQuestion(), fieldKey: key, title: label }]);
  };

  return (
    <section data-testid="feedback-question-editor" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold text-ink-deep">
            Questions
          </h3>
          <p className="mt-1 text-sm text-ink-muted">
            Add questions in the order respondents should answer them.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onChange([...questions, blankQuestion()])}
          disabled={locked}
        >
          Add question
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {QUICK_ADD.map((item) => {
          const used = questions.some((question) => question.fieldKey === item.key);
          return (
            <button
              key={item.key}
              type="button"
              data-testid={`feedback-quick-add-${item.key}`}
              className="rounded-full border border-line bg-paper px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors duration-200 hover:border-line-strong hover:text-ink disabled:pointer-events-none disabled:opacity-45"
              onClick={() => quickAdd(item.key, item.label)}
              disabled={locked || used}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {locked ? (
        <p
          data-reason="questions_locked"
          className="rounded-xl border border-line bg-paper/70 px-3.5 py-3 text-sm text-ink-muted"
        >
          Questions are locked after the first response. Existing answers stay attached to
          these questions.
        </p>
      ) : null}

      {questions.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line bg-paper/60 px-4 py-6 text-sm text-ink-muted">
          No questions yet. Add a question or use a quick-add field.
        </p>
      ) : null}

      <div className="grid gap-4">
        {questions.map((question, index) => {
          const issue = feedbackQuestionIssue(question);
          return (
            <article
              key={index}
              data-testid="feedback-question"
              className="rounded-2xl border border-line bg-paper p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">
                  Question {index + 1}
                </p>
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => duplicate(index)}
                    disabled={locked}
                  >
                    Duplicate
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => move(index, -1)}
                    disabled={locked || index === 0}
                  >
                    Move up
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => move(index, 1)}
                    disabled={locked || index === questions.length - 1}
                  >
                    Move down
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => remove(index)}
                    disabled={locked}
                  >
                    Remove
                  </Button>
                </div>
              </div>

              <div className="mt-4 grid gap-3">
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium text-ink-deep">Question</span>
                  <input
                    type="text"
                    className={selectClass}
                    value={question.title}
                    maxLength={200}
                    onChange={(event) => update(index, { title: event.target.value })}
                    disabled={locked}
                    placeholder="What do you want to ask?"
                  />
                </label>

                <label className="grid gap-1.5">
                  <span className="text-sm font-medium text-ink-deep">
                    Description (optional)
                  </span>
                  <textarea
                    className="min-h-20 w-full resize-y rounded-xl border border-line bg-paper/70 px-3.5 py-3 text-[0.9375rem] leading-relaxed text-ink-deep outline-none transition-[border-color,box-shadow,background-color] duration-300 hover:border-line-strong focus:border-ink/25 focus:bg-paper"
                    value={question.description ?? ""}
                    maxLength={1000}
                    onChange={(event) =>
                      update(index, {
                        description: event.target.value.trim() ? event.target.value : null,
                      })
                    }
                    disabled={locked}
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <label className="grid gap-1.5">
                    <span className="text-sm font-medium text-ink-deep">Type</span>
                    <select
                      className={selectClass}
                      value={question.qtype}
                      onChange={(event) =>
                        update(index, withType(question, event.target.value as FeedbackQtype))
                      }
                      disabled={locked}
                    >
                      {QUESTION_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex h-12 items-center gap-2 rounded-xl border border-line bg-paper/70 px-3.5 text-sm text-ink-deep">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--color-brass-deep)]"
                      checked={question.required}
                      onChange={(event) =>
                        update(index, { required: event.target.checked })
                      }
                      disabled={locked}
                    />
                    Required
                  </label>
                </div>

                {question.fieldKey ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-paper/70 px-3.5 py-2.5 text-xs text-ink-muted">
                    <span>
                      Quick field:{" "}
                      <span className="font-medium text-ink-deep">
                        {QUICK_ADD.find((item) => item.key === question.fieldKey)?.label ??
                          question.fieldKey}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="font-medium text-ink-soft underline-offset-2 hover:text-ink hover:underline disabled:pointer-events-none disabled:opacity-45"
                      onClick={() => update(index, { fieldKey: null })}
                      disabled={locked}
                    >
                      Clear
                    </button>
                  </div>
                ) : null}

                {CHOICE_TYPES.has(question.qtype) ? (
                  <div className="grid gap-2">
                    <p className="text-sm font-medium text-ink-deep">Options</p>
                    {question.options.map((option, optionIndex) => (
                      <div key={optionIndex} className="flex items-center gap-2">
                        <input
                          type="text"
                          className={selectClass}
                          value={option}
                          maxLength={120}
                          onChange={(event) => {
                            const nextOptions = [...question.options];
                            nextOptions[optionIndex] = event.target.value;
                            update(index, { options: nextOptions });
                          }}
                          disabled={locked}
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            update(index, {
                              options: question.options.filter(
                                (_, current) => current !== optionIndex,
                              ),
                            })
                          }
                          disabled={locked || question.options.length <= 2}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                    <div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          update(index, {
                            options: [
                              ...question.options,
                              `Option ${question.options.length + 1}`,
                            ],
                          })
                        }
                        disabled={locked || question.options.length >= 20}
                      >
                        Add option
                      </Button>
                    </div>
                  </div>
                ) : null}

                {question.qtype === "rating" ? (
                  <p className="rounded-xl border border-line bg-paper/70 px-3.5 py-2.5 text-xs text-ink-muted">
                    Respondents choose one to five stars.
                  </p>
                ) : null}

                {question.qtype === "linear_scale" ? (
                  <div className="grid gap-3 rounded-xl border border-line bg-paper/70 p-3.5">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="grid gap-1.5">
                        <span className="text-sm font-medium text-ink-deep">
                          Minimum
                        </span>
                        <select
                          className={selectClass}
                          value={question.scaleMin ?? 1}
                          onChange={(event) => {
                            const scaleMin = Number(event.target.value);
                            const scaleMax =
                              question.scaleMax !== null &&
                              question.scaleMax > scaleMin
                                ? question.scaleMax
                                : scaleMin + 1;
                            update(index, { scaleMin, scaleMax });
                          }}
                          disabled={locked}
                        >
                          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-1.5">
                        <span className="text-sm font-medium text-ink-deep">
                          Maximum
                        </span>
                        <select
                          className={selectClass}
                          value={question.scaleMax ?? 5}
                          onChange={(event) => {
                            const scaleMax = Number(event.target.value);
                            const scaleMin =
                              question.scaleMin !== null &&
                              question.scaleMin < scaleMax
                                ? question.scaleMin
                                : scaleMax - 1;
                            update(index, { scaleMin, scaleMax });
                          }}
                          disabled={locked}
                        >
                          {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="grid gap-1.5">
                        <span className="text-sm font-medium text-ink-deep">
                          Low label (optional)
                        </span>
                        <input
                          type="text"
                          className={selectClass}
                          value={question.scaleLabelLow ?? ""}
                          maxLength={80}
                          onChange={(event) =>
                            update(index, {
                              scaleLabelLow: event.target.value.trim()
                                ? event.target.value
                                : null,
                            })
                          }
                          disabled={locked}
                        />
                      </label>
                      <label className="grid gap-1.5">
                        <span className="text-sm font-medium text-ink-deep">
                          High label (optional)
                        </span>
                        <input
                          type="text"
                          className={selectClass}
                          value={question.scaleLabelHigh ?? ""}
                          maxLength={80}
                          onChange={(event) =>
                            update(index, {
                              scaleLabelHigh: event.target.value.trim()
                                ? event.target.value
                                : null,
                            })
                          }
                          disabled={locked}
                        />
                      </label>
                    </div>
                  </div>
                ) : null}

                {issue && !locked ? (
                  <p className="text-xs font-medium text-[#a5442c]">{issue}</p>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
