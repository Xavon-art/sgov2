"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/fx/Reveal";
import { ActionError, selectClass, ROW_STAGGER_MS } from "@/components/dashboard/workspace-shared";
import { IconPencil } from "@/components/ui/Icons";
import {
  DOCUMENT_STATUS_CLASS,
  DOCUMENT_STATUS_LABEL,
  GROUP_KIND_LABEL,
  formatDocumentDate,
  type DocumentGroupKind,
  type DocumentRow,
} from "@/lib/document-search";

async function mutate(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, init);
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || json.ok !== true) {
    const detail =
      typeof json.message === "string" && json.message.trim()
        ? json.message
        : typeof json.reason === "string" && json.reason.trim()
          ? json.reason
          : "That action could not be completed.";
    throw new Error(detail);
  }
  return json;
}

function actionMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

type LibraryRow = DocumentRow & { canApprove?: boolean };

function StatusBadge({ status }: { status: DocumentRow["status"] }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${DOCUMENT_STATUS_CLASS[status]}`}>
      {DOCUMENT_STATUS_LABEL[status]}
    </span>
  );
}

export function DocumentLibraryPanel() {
  const [rows, setRows] = useState<LibraryRow[]>([]);
  const [catalogCanApprove, setCanApprove] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState<DocumentRow | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch("/api/documents?limit=100");
      const json = await res.json();
      if (!json.ok) throw new Error(json.message);
      setRows((json.rows as LibraryRow[]) ?? []);
      setCanApprove(json.canApprove === true);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <div className="grid gap-6">
      <div className="flex items-start gap-3">
        <p className="text-sm text-muted">
          Every file and image filed by an LSG -- requirements, resolutions, requests, events,
          reports and task answers -- with its group, originating LSG and a working download.
        </p>
        <Button size="sm" className="ml-auto" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      <ActionError message={actionError} />

      {state === "loading" && <div className="text-muted">Loading...</div>}
      {state === "error" && (
        <p role="alert" className="text-sm text-[#a5442c]">
          We could not load the document catalog. Refresh to try again.
        </p>
      )}

      {state === "ready" && rows.length === 0 && (
        <div className="rounded-2xl border border-line bg-paper p-6 text-sm text-muted">
          No documents have been filed yet. Documents appear here once an LSG files a supported
          upload, link, resolution, request or event.
        </div>
      )}

      {state === "ready" && rows.length > 0 && (
        <div className="grid gap-3">
          {rows.map((row, i) => {
            const href = row.downloadUrl ?? row.externalUrl;
            const isExternal = !row.downloadUrl && Boolean(row.externalUrl);
            const isRequirement = row.sourceKind === "requirement_submission";
            const canApprove = catalogCanApprove && row.canApprove === true;

            return (
              <Reveal key={row.documentKey || row.submissionId} delay={i * ROW_STAGGER_MS}>
                <div className="rounded-2xl border border-line bg-paper p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-lg font-medium">{row.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                        <span className="font-semibold tracking-[0.06em] uppercase">{row.type}</span>
                        <span aria-hidden="true">·</span>
                        <span>LSG: {row.unitName ?? "Organization-wide"}</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatDocumentDate(row.submittedAt)}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {GROUP_KIND_LABEL[row.groupKind]}: {row.groupLabel ?? "—"}
                        </span>
                      </div>
                    </div>
                    <StatusBadge status={row.status} />
                  </div>

                  {row.description && (
                    <p className="mt-3 whitespace-pre-wrap text-sm text-body">{row.description}</p>
                  )}
                  {row.keywords && (
                    <p className="mt-2 text-xs text-muted">Keywords: {row.keywords}</p>
                  )}
                  {row.approvalRemark && (
                    <p className="mt-3 rounded-xl border border-line/60 bg-canvas/40 p-3 text-sm text-muted">
                      Note: {row.approvalRemark}
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {href ? (
                      <a
                        href={href}
                        target={isExternal ? "_blank" : undefined}
                        rel={isExternal ? "noreferrer" : undefined}
                        className="pressable inline-flex items-center gap-1.5 rounded-full border border-line-strong px-4 py-2 text-[0.875rem] font-medium text-ink hover:border-ink/40 hover:bg-ink/[0.035]"
                      >
                        {isExternal ? "Open support link" : "Download"}
                      </a>
                    ) : (
                      <span className="text-sm text-muted">No attachment filed</span>
                    )}
                    {isRequirement && (row.canEdit || canApprove) && (
                      <Button size="sm" onClick={() => setEditing(row)}>
                        <IconPencil className="h-4 w-4" /> Edit details
                      </Button>
                    )}
                    {canApprove && (isRequirement && (
                      <Button
                        size="sm"
                        onClick={() =>
                          setReviewing(reviewing === row.sourceId ? null : row.sourceId)
                        }
                      >
                        Review
                      </Button>
                    ))}
                  </div>

                  {canApprove && (isRequirement && reviewing === row.sourceId && (
                    <ReviewBox
                      submissionId={row.sourceId}
                      onDone={async () => {
                        setReviewing(null);
                        await load();
                      }}
                      onError={setActionError}
                    />
                  ))}
                </div>
              </Reveal>
            );
          })}
        </div>
      )}

      {editing && (
        <EditDocumentModal
          row={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function ReviewBox({
  submissionId,
  onDone,
  onError,
}: {
  submissionId: string;
  onDone: () => Promise<void> | void;
  onError: (message: string | null) => void;
}) {
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);

  const decide = useCallback(
    async (decision: "approved" | "rejected" | "pending") => {
      if (busy) return;
      setBusy(true);
      onError(null);
      try {
        await mutate(`/api/documents/${submissionId}/approve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision, remark }),
        });
        setRemark("");
        await onDone();
      } catch (e) {
        onError(actionMessage(e, "We could not record that decision."));
      } finally {
        setBusy(false);
      }
    },
    [busy, remark, submissionId, onDone, onError],
  );

  return (
    <div className="mt-4 border-t border-line pt-4">
      <label className="mb-1 block text-sm text-muted" htmlFor={`document-remark-${submissionId}`}>
        Review note
      </label>
      <input
        id={`document-remark-${submissionId}`}
        value={remark}
        onChange={(e) => setRemark(e.target.value)}
        placeholder="Required when rejecting"
        className={selectClass}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => void decide("approved")}>
          Approve
        </Button>
        <Button size="sm" disabled={busy || !remark.trim()} onClick={() => void decide("rejected")}>
          Reject
        </Button>
        <Button size="sm" disabled={busy} onClick={() => void decide("pending")}>
          Return to pending
        </Button>
      </div>
    </div>
  );
}

function EditDocumentModal({
  row,
  onClose,
  onDone,
}: {
  row: DocumentRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(row.title);
  const [description, setDescription] = useState(row.description);
  const [keywords, setKeywords] = useState(row.keywords);
  const [groupKind, setGroupKind] = useState<DocumentGroupKind>(row.groupKind);
  const [groupId, setGroupId] = useState("");
  const [groupLabel, setGroupLabel] = useState(row.groupLabel ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await mutate(`/api/documents/${row.sourceId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          keywords,
          groupKind,
          groupId: groupId || null,
          groupLabel,
        }),
      });
      onDone();
    } catch (e) {
      setError(actionMessage(e, "We could not save those document details."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-2xl border border-line bg-paper p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-lg font-medium">Document details</div>
          <button onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="grid gap-3">
          <div>
            <label className="mb-1 block text-sm text-muted" htmlFor="document-title">
              Title
            </label>
            <input
              id="document-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={selectClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted" htmlFor="document-description">
              Description
            </label>
            <textarea
              id="document-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className={selectClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted" htmlFor="document-keywords">
              Keywords
            </label>
            <input
              id="document-keywords"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="budget, report, 2026"
              className={selectClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted" htmlFor="document-group-kind">
              Group
            </label>
            <select
              id="document-group-kind"
              value={groupKind}
              onChange={(e) => setGroupKind(e.target.value as DocumentGroupKind)}
              className={selectClass}
            >
              <option value="requirement">Requirement</option>
              <option value="resolution">Resolution</option>
              <option value="event">Event</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted" htmlFor="document-group-id">
              Group reference (optional)
            </label>
            <input
              id="document-group-id"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              placeholder="UUID of the resolution or event"
              className={selectClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted" htmlFor="document-group-label">
              Group label
            </label>
            <input
              id="document-group-label"
              value={groupLabel}
              onChange={(e) => setGroupLabel(e.target.value)}
              className={selectClass}
            />
          </div>
          <ActionError message={error} />
          <Button disabled={saving || title.trim().length < 2} onClick={submit}>
            Save details
          </Button>
        </div>
      </div>
    </div>
  );
}
