"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/fx/Reveal";
import { ActionError, ROW_STAGGER_MS, selectClass } from "@/components/dashboard/workspace-shared";
import { IconArrowLeft, IconPencil } from "@/components/ui/Icons";
import {
  ACCOMPLISHMENT_STATUS_CLASS,
  ACCOMPLISHMENT_STATUS_LABEL,
  formatAccomplishmentDate,
  type AccomplishmentDecision,
  type AccomplishmentReportDetail,
  type AccomplishmentReportRow,
  type AccomplishmentReportStatus,
} from "@/lib/accomplishment-reports";
import type { DocumentRow } from "@/lib/document-search";

type EventOption = { id: string; title: string };

async function mutate(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, init);
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || json.ok !== true) {
    const message =
      typeof json.message === "string" && json.message.trim()
        ? json.message
        : typeof json.reason === "string" && json.reason.trim()
          ? json.reason
          : "That action could not be completed.";
    throw new Error(message);
  }
  return json;
}

function actionMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function StatusBadge({ status }: { status: AccomplishmentReportStatus }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${ACCOMPLISHMENT_STATUS_CLASS[status]}`}>
      {ACCOMPLISHMENT_STATUS_LABEL[status]}
    </span>
  );
}

export function AccomplishmentPanel({ isUsg }: { isUsg: boolean }) {
  const [events, setEvents] = useState<EventOption[]>([]);
  const [eventId, setEventId] = useState("");
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [attachmentSubmissionId, setAttachmentSubmissionId] = useState("");
  const [rows, setRows] = useState<AccomplishmentReportRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [selected, setSelected] = useState<AccomplishmentReportDetail | null>(null);
  const [detailState, setDetailState] = useState<"idle" | "loading" | "error">("idle");
  const [showCreate, setShowCreate] = useState(false);
  const [narrative, setNarrative] = useState("");
  const [highlights, setHighlights] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const loadOptions = useCallback(async () => {
    const [eventRes, documentRes] = await Promise.all([
      fetch("/api/events"),
      fetch("/api/documents?limit=100"),
    ]);
    const eventJson = await eventRes.json().catch(() => ({}));
    const documentJson = await documentRes.json().catch(() => ({}));
    if (eventJson.ok && Array.isArray(eventJson.events)) {
      const options = eventJson.events
        .map((event: { id?: string; title?: string }) => ({
          id: String(event.id ?? ""),
          title: String(event.title ?? "Untitled event"),
        }))
        .filter((event: EventOption) => Boolean(event.id));
      setEvents(options);
      setEventId((current) => current || options[0]?.id || "");
    }
    if (documentJson.ok && Array.isArray(documentJson.rows)) {
      setDocuments(documentJson.rows as DocumentRow[]);
    }
  }, []);

  const loadReports = useCallback(async () => {
    setState("loading");
    try {
      const query = eventId ? `?eventId=${encodeURIComponent(eventId)}` : "";
      const res = await fetch(`/api/accomplishment-reports${query}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.message);
      setRows((json.rows as AccomplishmentReportRow[]) ?? []);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [eventId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadOptions();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadOptions]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadReports();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadReports]);

  const open = useCallback(async (id: string) => {
    setDetailState("loading");
    setSelected(null);
    setActionError(null);
    try {
      const res = await fetch(`/api/accomplishment-reports/${id}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.message);
      setSelected(json.item as AccomplishmentReportDetail);
      setDetailState("idle");
    } catch {
      setDetailState("error");
    }
  }, []);

  const closeDetail = useCallback(() => {
    setSelected(null);
    setDetailState("idle");
    setActionError(null);
  }, []);

  const submit = async () => {
    if (!eventId) {
      setActionError("Choose an event first.");
      return;
    }
    setActionError(null);
    try {
      await mutate("/api/accomplishment-reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventId,
          narrative,
          highlights,
          attachmentSubmissionId: attachmentSubmissionId || null,
        }),
      });
      setShowCreate(false);
      setNarrative("");
      setHighlights("");
      setAttachmentSubmissionId("");
      await loadReports();
    } catch (error) {
      setActionError(actionMessage(error, "We could not file that report."));
    }
  };

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <div className="mb-1 text-sm text-muted">Event</div>
          <select
            value={eventId}
            onChange={(e) => {
              setEventId(e.target.value);
              setSelected(null);
            }}
            className={selectClass}
          >
            {events.length === 0 && <option value="">No events available</option>}
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.title}
              </option>
            ))}
          </select>
        </div>
        {!selected && (
          <Button size="sm" className="ml-auto" onClick={() => setShowCreate(true)}>
            <IconPencil className="h-4 w-4" /> File report
          </Button>
        )}
      </div>

      <ActionError message={actionError} />

      {!selected && (
        <>
          {state === "loading" && <div className="text-muted">Loading...</div>}
          {state === "error" && (
            <p role="alert" className="text-sm text-[#a5442c]">
              We could not load the accomplishment reports. Refresh to try again.
            </p>
          )}
          {state === "ready" && rows.length === 0 && (
            <div className="rounded-2xl border border-line bg-paper p-6 text-sm text-muted">
              No accomplishment reports for this event yet.
            </div>
          )}
          {state === "ready" && (
            <div className="grid gap-3">
              {rows.map((row, i) => (
                <Reveal key={row.id} delay={i * ROW_STAGGER_MS}>
                  <button
                    onClick={() => void open(row.id)}
                    className="w-full rounded-2xl border border-line bg-paper p-5 text-left transition hover:border-ink/20"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-lg font-medium">{row.eventTitle}</div>
                        <div className="text-sm text-muted">
                          {row.unitName} • {formatAccomplishmentDate(row.submittedAt)}
                        </div>
                      </div>
                      <StatusBadge status={row.status} />
                    </div>
                  </button>
                </Reveal>
              ))}
            </div>
          )}
        </>
      )}

      {selected && (
        <div className="rounded-2xl border border-line bg-paper p-6">
          <div className="mb-4 flex items-center justify-between">
            <button onClick={closeDetail} className="inline-flex items-center gap-1.5 text-sm text-muted">
              <IconArrowLeft className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              Back
            </button>
            <StatusBadge status={selected.status} />
          </div>
          <h2 className="text-xl font-medium">{selected.eventTitle}</h2>
          <p className="mt-1 text-sm text-muted">
            {selected.unitName} • filed {formatAccomplishmentDate(selected.submittedAt)}
            {selected.reviewedAt ? ` • reviewed ${formatAccomplishmentDate(selected.reviewedAt)}` : ""}
          </p>
          <p className="mt-4 whitespace-pre-wrap text-body">{selected.narrative}</p>
          {selected.highlights && (
            <p className="mt-3 rounded-xl border border-line/60 bg-canvas/40 p-3 text-sm text-muted">
              Highlights: {selected.highlights}
            </p>
          )}
          {selected.attachmentSubmissionId && (
            <a
              href={`/api/files/${selected.attachmentSubmissionId}`}
              className="mt-3 inline-block text-sm underline"
            >
              Open attachment
            </a>
          )}
          {selected.decisionRemark && (
            <p className="mt-4 rounded-xl border border-line/60 bg-canvas/40 p-3 text-sm text-muted">
              Note: {selected.decisionRemark}
            </p>
          )}
          {selected.timeline.length > 0 && (
            <div className="mt-6">
              <div className="mb-2 text-sm font-medium">Review timeline</div>
              <div className="grid gap-2">
                {selected.timeline.map((entry, idx) => (
                  <div key={idx} className="rounded-xl border border-line p-3 text-sm">
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span>{entry.reviewerName ?? "USG office"}</span>
                      <span>{formatAccomplishmentDate(entry.createdAt)}</span>
                    </div>
                    <div className="mt-1 font-medium">{entry.decision}</div>
                    {entry.remark && <p className="mt-1 text-muted">{entry.remark}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {isUsg && selected.canReview !== false && (
            <ReviewActions
              reportId={selected.id}
              onDone={async () => {
                await open(selected.id);
                await loadReports();
              }}
              onError={setActionError}
            />
          )}
        </div>
      )}

      {detailState === "loading" && <div className="text-muted">Loading...</div>}
      {detailState === "error" && (
        <p role="alert" className="text-sm text-[#a5442c]">
          We could not load that report. Go back and try again.
        </p>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-2xl border border-line bg-paper p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-lg font-medium">File accomplishment report</div>
              <button onClick={() => setShowCreate(false)}>✕</button>
            </div>
            <div className="grid gap-3">
              <div>
                <div className="mb-1 text-sm text-muted">Narrative</div>
                <textarea
                  value={narrative}
                  onChange={(e) => setNarrative(e.target.value)}
                  rows={5}
                  className={selectClass}
                />
              </div>
              <div>
                <div className="mb-1 text-sm text-muted">Highlights</div>
                <textarea
                  value={highlights}
                  onChange={(e) => setHighlights(e.target.value)}
                  rows={2}
                  className={selectClass}
                />
              </div>
              {documents.length > 0 && (
                <div>
                  <div className="mb-1 text-sm text-muted">Attachment</div>
                  <select
                    value={attachmentSubmissionId}
                    onChange={(e) => setAttachmentSubmissionId(e.target.value)}
                    className={selectClass}
                  >
                    <option value="">No attachment</option>
                    {documents.map((document) => (
                      <option key={document.submissionId} value={document.submissionId}>
                        {document.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <Button disabled={narrative.trim().length < 10} onClick={() => void submit()}>
                Submit report
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewActions({
  reportId,
  onDone,
  onError,
}: {
  reportId: string;
  onDone: () => Promise<void> | void;
  onError: (message: string | null) => void;
}) {
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);

  const review = useCallback(
    async (decision: AccomplishmentDecision) => {
      if (busy) return;
      setBusy(true);
      onError(null);
      try {
        await mutate(`/api/accomplishment-reports/${reportId}/review`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision, remark }),
        });
        setRemark("");
        await onDone();
      } catch (error) {
        onError(actionMessage(error, "We could not record that decision."));
      } finally {
        setBusy(false);
      }
    },
    [busy, remark, reportId, onDone, onError],
  );

  return (
    <div className="mt-6 border-t border-line pt-4">
      <div className="mb-2 text-sm font-medium">Review</div>
      <textarea
        value={remark}
        onChange={(e) => setRemark(e.target.value)}
        rows={2}
        placeholder="Remark (required when returning)"
        className={`${selectClass} w-full`}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => void review("acknowledged")}>
          Acknowledge
        </Button>
        <Button size="sm" disabled={busy || !remark.trim()} onClick={() => void review("returned")}>
          Return
        </Button>
      </div>
    </div>
  );
}
