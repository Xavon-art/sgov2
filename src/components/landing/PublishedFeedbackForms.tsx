"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Reveal } from "@/components/fx/Reveal";
import { Section } from "@/components/landing/Section";
import type { PublicFeedbackFormSummary } from "@/lib/feedback-forms";

const SUBMISSIONS_KEY = "feedback-submissions";

function readSubmittedSlugs(): Set<string> {
  try {
    const raw = window.localStorage.getItem(SUBMISSIONS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Set();
    return new Set(Object.keys(parsed));
  } catch {
    return new Set();
  }
}

function slugFromPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export function PublishedFeedbackForms() {
  const [forms, setForms] = useState<PublicFeedbackFormSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [submittedSlugs, setSubmittedSlugs] = useState<Set<string>>(new Set());

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSubmittedSlugs(readSubmittedSlugs());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/feedback/public", { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          forms?: PublicFeedbackFormSummary[];
        };
        if (alive && res.ok && json.ok) setForms(json.forms ?? []);
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Section
      id="feedback-forms"
      tone="paper"
      eyebrow="Share your view"
      title="Open feedback from student government."
      lede="Published forms are listed here by the organization running them. Choose one to respond."
    >
      <Reveal className="mt-12" delay={0.05}>
        {!loaded ? (
          <p className="text-sm text-body">Loading published forms...</p>
        ) : forms.length === 0 ? (
          <div className="rounded-2xl border border-line bg-canvas px-6 py-10 text-center">
            <p className="text-sm text-body">
              No open feedback forms right now. Check back after an office publishes one.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {forms.map((form) => {
              const href = form.publicPath || "/forms/feedback/";
              const submitted = submittedSlugs.has(slugFromPath(href));
              return (
                <Link
                  key={href}
                  href={href}
                  className="group flex h-full flex-col rounded-2xl border border-line bg-canvas p-6 transition hover:border-brass/60"
                >
                  <p className="font-display text-xl font-medium text-ink-deep">{form.title}</p>
                  {form.description ? (
                    <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-body">
                      {form.description}
                    </p>
                  ) : (
                    <p className="mt-3 text-sm leading-relaxed text-ink-muted">
                      Share your response through the published form.
                    </p>
                  )}
                  {submitted ? (
                    <span
                      data-testid="published-feedback-submitted"
                      className="mt-4 inline-flex w-fit items-center rounded-full border border-brass/40 bg-brass-soft/30 px-2.5 py-0.5 text-xs font-medium text-brass-deep"
                    >
                      Submitted
                    </span>
                  ) : null}
                  <div className="mt-5 flex items-center justify-between text-xs text-ink-muted">
                    <span>{form.questionCount} questions</span>
                    <span>
                      {form.identityMode === "anonymous" ? "Anonymous" : "Identified"}
                    </span>
                  </div>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-deep">
                    Open form
                    <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
                      →
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </Reveal>
    </Section>
  );
}
