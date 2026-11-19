"use client";

import type { FeedbackQuestion } from "@/lib/feedback-forms";

export const feedbackInputClass =
  "h-12 w-full rounded-xl border border-line bg-paper px-3.5 text-[0.9375rem] text-ink-deep outline-none transition-[border-color,box-shadow,background-color] duration-300 hover:border-line-strong focus:border-ink/25 focus:bg-paper";

export const feedbackTextareaClass =
  "min-h-28 w-full resize-y rounded-xl border border-line bg-paper px-3.5 py-3 text-[0.9375rem] leading-relaxed text-ink-deep outline-none transition-[border-color,box-shadow,background-color] duration-300 hover:border-line-strong focus:border-ink/25 focus:bg-paper";

export function isBlankAnswer(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function domId(index: number, suffix?: string) {
  return suffix ? `feedback-q-${index}-${suffix}` : `feedback-q-${index}`;
}

export function FeedbackQuestionField({
  question,
  index,
  value,
  onChange,
}: {
  question: FeedbackQuestion;
  index: number;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const id = domId(index);
  const label = question.title.trim() || `Question ${index + 1}`;
  const describedBy = question.description ? `${id}-description` : undefined;

  const labelBlock = (
    <>
      <label htmlFor={id} className="block text-[0.9375rem] font-medium text-ink-deep">
        {label}
        {question.required ? (
          <>
            <span className="ml-1 text-brass-deep" aria-hidden="true">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        ) : null}
      </label>
      {question.description ? (
        <p id={`${id}-description`} className="mt-1 text-sm leading-relaxed text-ink-muted">
          {question.description}
        </p>
      ) : null}
    </>
  );

  if (question.qtype === "long_text") {
    return (
      <div>
        {labelBlock}
        <textarea
          id={id}
          className={`mt-3 ${feedbackTextareaClass}`}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          required={question.required}
          aria-describedby={describedBy}
        />
      </div>
    );
  }

  if (question.qtype === "short_text") {
    return (
      <div>
        {labelBlock}
        <input
          id={id}
          type="text"
          className={`mt-3 ${feedbackInputClass}`}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          required={question.required}
          aria-describedby={describedBy}
        />
      </div>
    );
  }

  if (question.qtype === "date") {
    return (
      <div>
        {labelBlock}
        <input
          id={id}
          type="date"
          className={`mt-3 ${feedbackInputClass}`}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          required={question.required}
          aria-describedby={describedBy}
        />
      </div>
    );
  }

  if (question.qtype === "time") {
    return (
      <div>
        {labelBlock}
        <input
          id={id}
          type="time"
          className={`mt-3 ${feedbackInputClass}`}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          required={question.required}
          aria-describedby={describedBy}
        />
      </div>
    );
  }

  if (question.qtype === "checkbox") {
    const selected = Array.isArray(value) ? value.map(String) : [];
    return (
      <fieldset aria-describedby={describedBy} aria-required={question.required}>
        <legend className="block text-[0.9375rem] font-medium text-ink-deep">
          {label}
          {question.required ? (
            <>
              <span className="ml-1 text-brass-deep" aria-hidden="true">
                *
              </span>
              <span className="sr-only"> (required)</span>
            </>
          ) : null}
        </legend>
        {question.description ? (
          <p id={`${id}-description`} className="mt-1 text-sm leading-relaxed text-ink-muted">
            {question.description}
          </p>
        ) : null}
        <div className="mt-3 grid gap-2">
          {question.options.map((option, optionIndex) => {
            const optionId = domId(index, String(optionIndex));
            const checked = selected.includes(option);
            return (
              <label
                key={optionId}
                htmlFor={optionId}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-paper px-3.5 py-3 text-[0.9375rem] text-ink-deep transition-colors duration-200 hover:border-line-strong"
              >
                <input
                  id={optionId}
                  type="checkbox"
                  className="mt-0.5 size-4 accent-[var(--color-brass-deep)]"
                  checked={checked}
                  onChange={() => {
                    onChange(
                      checked
                        ? selected.filter((item) => item !== option)
                        : [...selected, option],
                    );
                  }}
                />
                <span>{option}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
    );
  }

  if (question.qtype === "multiple_choice" || question.qtype === "dropdown") {
    return (
      <div>
        {labelBlock}
        <select
          id={id}
          className={`mt-3 ${feedbackInputClass}`}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          required={question.required}
          aria-describedby={describedBy}
        >
          <option value="">Select an option</option>
          {question.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (question.qtype === "rating") {
    const current = typeof value === "number" ? value : Number(value) || 0;
    return (
      <div>
        {labelBlock}
        <select
          id={id}
          className={`mt-3 ${feedbackInputClass}`}
          value={current > 0 ? String(current) : ""}
          onChange={(event) =>
            onChange(event.target.value ? Number(event.target.value) : "")
          }
          required={question.required}
          aria-describedby={describedBy}
        >
          <option value="">Select a rating</option>
          {[1, 2, 3, 4, 5].map((score) => (
            <option key={score} value={score}>
              {score} of 5
            </option>
          ))}
        </select>
      </div>
    );
  }

  const min = question.scaleMin ?? 1;
  const max = question.scaleMax && question.scaleMax > min ? question.scaleMax : 5;
  const current = typeof value === "number" ? value : Number(value) || 0;
  const scaleValues = Array.from({ length: max - min + 1 }, (_, offset) => min + offset);
  return (
    <div>
      {labelBlock}
      <select
        id={id}
        className={`mt-3 ${feedbackInputClass}`}
        value={current > 0 ? String(current) : ""}
        onChange={(event) =>
          onChange(event.target.value ? Number(event.target.value) : "")
        }
        required={question.required}
        aria-describedby={describedBy}
      >
        <option value="">Select a value</option>
        {scaleValues.map((score) => (
          <option key={score} value={score}>
            {score}
          </option>
        ))}
      </select>
      {question.scaleLabelLow || question.scaleLabelHigh ? (
        <div className="mt-2 flex justify-between gap-4 text-xs text-ink-muted">
          <span>{question.scaleLabelLow ?? min}</span>
          <span className="text-right">{question.scaleLabelHigh ?? max}</span>
        </div>
      ) : null}
    </div>
  );
}
