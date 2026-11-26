"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { DraftWithAiButton } from "@/components/ai/DraftWithAiButton";
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
import { uploadFile } from "@/lib/upload-client";
import { messageFor } from "@/lib/auth/messages";
import { MAX_FILE_BYTES } from "@/lib/documents";
import type { DocumentRow } from "@/lib/document-search";

type EventOption = {
  id: string;
  title: string;
  canReport: boolean;
  eventDate: string | null;
  status: string | null;
  honorStatus: string | null;
};

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

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isAccomplished(status: AccomplishmentReportStatus): boolean {
  return status === "approved";
}

export function AccomplishmentPanel({ isUsg }: { isUsg: boolean }) {
  const searchParams = useSearchParams();
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
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [optionsLoaded, setOptionsLoaded] = useState(false);
  const [handledLink, setHandledLink] = useState<string | null>(null);

  const loadOptions = useCallback(async () => {
    const [eventRes, documentRes] = await Promise.all([
      fetch("/api/events"),
      fetch("/api/documents?limit=100"),
    ]);
    const eventJson = await eventRes.json().catch(() => ({}));
    const documentJson = await documentRes.json().catch(() => ({}));
    if (eventJson.ok && Array.isArray(eventJson.events)) {
      const options = eventJson.events
        .map(
          (event: {
            id?: string;
            title?: string;
            canReport?: boolean;
            eventDate?: string | null;
            status?: string | null;
            honorStatus?: string | null;
          }) => ({
            id: String(event.id ?? ""),
            title: String(event.title ?? "Untitled event"),
            canReport: event.canReport === true,
            eventDate: typeof event.eventDate === "string" ? event.eventDate : null,
            status: typeof event.status === "string" ? event.status : null,
            honorStatus: typeof event.honorStatus === "string" ? event.honorStatus : null,
          }),
        )
        .filter((event: EventOption) => Boolean(event.id));
      setEvents(options);
    }
    if (documentJson.ok && Array.isArray(documentJson.rows)) {
      setDocuments(documentJson.rows as DocumentRow[]);
    }
    setOptionsLoaded(true);
  }, []);

  const loadReports = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch("/api/accomplishment-reports");
      const json = await res.json();
      if (!json.ok) throw new Error(json.message);
      setRows((json.rows as AccomplishmentReportRow[]) ?? []);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

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

  useEffect(() => {
    if (!optionsLoaded || state !== "ready") return;
    const reportId = searchParams.get("report");
    const eventParam = searchParams.get("event");
    const action = searchParams.get("action");
    if (reportId && handledLink !== `report:${reportId}`) {
      queueMicrotask(() => {
        setHandledLink(`report:${reportId}`);
        void open(reportId);
      });
      return;
    }
    if (eventParam && action === "report" && handledLink !== `event:${eventParam}`) {
      const event = events.find((option) => option.id === eventParam);
      if (!event || !event.canReport) return;
      queueMicrotask(() => {
        setHandledLink(`event:${eventParam}`);
        setEventId(eventParam);
        setShowCreate(true);
      });
    }
  }, [searchParams, optionsLoaded, state, events, handledLink, open]);

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

    if (pendingFiles.length > 10) {
      setActionError("Choose at most 10 files.");
      return;
    }

    const tooLarge = pendingFiles.find((file) => file.size > MAX_FILE_BYTES);
    if (tooLarge) {
      setActionError(messageFor("file_too_large"));
      return;
    }

    setUploading(true);
    try {
      const filePaths: string[] = [];
      for (const file of pendingFiles) {
        const uploaded = await uploadFile(file, {
          target: "accomplishment",
          eventId,
          nonce: crypto.randomUUID(),
          version: 1,
        });
        if (!uploaded.ok || !uploaded.storagePath) {
          throw new Error(messageFor(uploaded.reason));
        }
        filePaths.push(uploaded.storagePath);
      }

      await mutate("/api/accomplishment-reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventId,
          narrative,
          highlights,
          attachmentSubmissionId: attachmentSubmissionId || null,
          files: filePaths,
        }),
      });
      setShowCreate(false);
      setEventId("");
      setNarrative("");
      setHighlights("");
      setAttachmentSubmissionId("");
      setPendingFiles([]);
      await loadReports();
    } catch (error) {
      setActionError(actionMessage(error, "We could not file that report."));
    } finally {
      setUploading(false);
    }
  };

  const selectedEvent = events.find((event) => event.id === eventId);
  const sortedEvents = [...events].sort((a, b) => {
    const reportable = Number(b.canReport) - Number(a.canReport);
    if (reportable !== 0) return reportable;
    return (a.eventDate ?? "").localeCompare(b.eventDate ?? "");
  });
  const openReports = rows.filter((row) => !isAccomplished(row.status));
  const accomplished = rows.filter((row) => isAccomplished(row.status));

  const renderReportRow = (row: AccomplishmentReportRow, i: number) => (
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
  );

  return (
    <div className="grid gap-6">
      {!selected && (
        <section>
          <div className="mb-3">
            <h2 className="text-lg font-medium">Reportable events</h2>
            <p className="text-sm text-muted">
              Tap an event to file its accomplishment report.
            </p>
          </div>
          {events.length === 0 ? (
            <div className="rounded-2xl border border-line bg-paper p-6 text-sm text-muted">
              No events available.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {sortedEvents.map((event, i) => (
                <Reveal key={event.id} delay={i * ROW_STAGGER_MS}>
                  <button
                    type="button"
                    disabled={!event.canReport}
                    title={
                      event.canReport
                        ? `File an accomplishment report for ${event.title}`
                        : "Only the required units can file a report for this event."
                    }
                    onClick={() => {
                      setSelected(null);
                      setEventId(event.id);
                      setPendingFiles([]);
                      setActionError(null);
                      setShowCreate(true);
                    }}
                    className={`flex h-full w-full flex-col items-start justify-between gap-4 rounded-2xl border border-line bg-paper p-5 text-left transition ${
                      event.canReport
                        ? "hover:border-ink/20 hover:shadow-lift"
                        : "cursor-not-allowed opacity-60"
                    }`}
                  >
                    <div>
                      <div className="text-lg font-medium">{event.title}</div>
                      <div className="mt-1 text-xs text-muted">
                        {formatAccomplishmentDate(event.eventDate) || "No date"}
                        {event.status ? ` • ${event.status}` : ""}
                        {event.honorStatus ? ` • ${event.honorStatus}` : ""}
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                        event.canReport
                          ? "border-brass/50 bg-brass-soft/25 text-ink"
                          : "border-line text-muted"
                      }`}
                    >
                      {event.canReport ? (
                        <>
                          <IconPencil className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                          File report
                        </>
                      ) : (
                        "Not required"
                      )}
                    </span>
                  </button>
                </Reveal>
              ))}
            </div>
          )}
        </section>
      )}

      <ActionError message={actionError} />

      {!selected && (
        <>
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium">Accomplishment reports</h2>
              <p className="text-sm text-muted">Reports you can view and review.</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void loadReports()}
              disabled={state === "loading"}
            >
              Refresh
            </Button>
          </div>
          {state === "loading" && <div className="text-muted">Loading...</div>}
          {state === "error" && (
            <p role="alert" className="text-sm text-[#a5442c]">
              We could not load the accomplishment reports. Refresh to try again.
            </p>
          )}
          {state === "ready" && rows.length === 0 && (
            <div className="rounded-2xl border border-line bg-paper p-6 text-sm text-muted">
              No accomplishment reports yet.
            </div>
          )}
          {state === "ready" && rows.length > 0 && (
            <div className="grid gap-6">
              <section>
                <h3 className="mb-2 text-base font-medium">Open reports</h3>
                {openReports.length === 0 ? (
                  <p className="text-sm text-muted">No reports are still open.</p>
                ) : (
                  <div className="grid gap-3">{openReports.map(renderReportRow)}</div>
                )}
              </section>
              <section>
                <h3 className="mb-2 text-base font-medium">Accomplished Reports</h3>
                {accomplished.length === 0 ? (
                  <p className="text-sm text-muted">No accomplished reports yet.</p>
                ) : (
                  <div className="grid gap-3">{accomplished.map(renderReportRow)}</div>
                )}
              </section>
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
          {(selected.files?.length ?? 0) > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-sm font-medium">Uploaded files</div>
              <ul className="grid gap-1">
                {selected.files?.map((file) => (
                  <li key={file.id}>
                    <a
                      href={`/api/accomplishment-files/${file.id}`}
                      className="text-sm underline"
                    >
                      {file.name}
                    </a>{" "}
                    <span className="text-xs text-muted">{formatBytes(file.sizeBytes)}</span>
                  </li>
                ))}
              </ul>
            </div>
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
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-lg font-medium">File accomplishment report</div>
                {selectedEvent && <div className="text-sm text-muted">{selectedEvent.title}</div>}
              </div>
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
              <DraftWithAiButton
                kind="activity_report"
                label="Draft report with AI"
                disabled={uploading}
                getFields={() => ({
                  title: selectedEvent?.title ?? "",
                  eventDate: selectedEvent?.eventDate ?? "",
                  narrativeNotes: narrative,
                  highlights,
                })}
                onUse={setNarrative}
                onUseHighlights={(items) => setHighlights(items.join("\n"))}
              />
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
              <div>
                <div className="mb-1 text-sm text-muted">Files</div>
                <input
                  type="file"
                  multiple
                  disabled={uploading}
                  onChange={(e) => setPendingFiles(Array.from(e.target.files ?? []))}
                  className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-line file:bg-canvas file:px-3 file:py-1.5 file:text-sm"
                />
                {pendingFiles.length > 0 && (
                  <ul className="mt-2 grid gap-1 text-sm text-muted">
                    {pendingFiles.map((file, index) => (
                      <li key={`${file.name}-${index}`}>
                        {file.name} · {formatBytes(file.size)}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-1 text-xs text-muted">
                  Up to 10 files, 10 MB each.
                </p>
              </div>
              <Button
                disabled={uploading || narrative.trim().length < 10}
                onClick={() => void submit()}
              >
                {uploading ? "Uploading..." : "Submit report"}
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
        <Button size="sm" disabled={busy} onClick={() => void review("approved")}>
          Approve
        </Button>
        <Button size="sm" disabled={busy || !remark.trim()} onClick={() => void review("returned")}>
          Return
        </Button>
      </div>
    </div>
  );
}
