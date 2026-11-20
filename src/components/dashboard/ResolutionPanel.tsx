"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { DraftWithAiButton } from "@/components/ai/DraftWithAiButton";
import { Reveal } from "@/components/fx/Reveal";
import { ActionError, selectClass, ROW_STAGGER_MS } from "@/components/dashboard/workspace-shared";
import { IconArrowLeft, IconPencil } from "@/components/ui/Icons";
import { uploadFile } from "@/lib/upload-client";
import {
  STATUS_CLASS,
  STATUS_LABEL,
  formatDate,
  type ResolutionDetail,
  type ResolutionRow,
} from "@/lib/resolutions";

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

function StatusBadge({ status }: { status: ResolutionRow["status"] }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_CLASS[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ResolutionPanel({ isUsg }: { isUsg: boolean }) {
  const [rows, setRows] = useState<ResolutionRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [canReview, setCanReview] = useState(false);
  const [selected, setSelected] = useState<ResolutionDetail | null>(null);
  const [detailState, setDetailState] = useState<"idle" | "loading" | "error">("idle");
  const [showCreate, setShowCreate] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch("/api/resolutions");
      const json = await res.json();
      if (!json.ok) throw new Error(json.message);
      setRows((json.rows as ResolutionRow[]) ?? []);
      setCanReview(json.canReview === true);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const open = useCallback(async (id: string) => {
    setDetailState("loading");
    setSelected(null);
    setActionError(null);
    try {
      const res = await fetch(`/api/resolutions/${id}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.message);
      setSelected(json.item as ResolutionDetail);
      if (typeof json.canReview === "boolean") setCanReview(json.canReview);
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

  return (
    <div className="grid gap-6">
      <div className="flex items-center gap-3">
        <p className="text-sm text-muted">
          {isUsg
            ? "Formal positions from your units, and the ones you file for the office."
            : "Formal positions for your unit, and what the office has published."}
        </p>
        {!selected && (
          <Button size="sm" className="ml-auto" onClick={() => setShowCreate(true)}>
            <IconPencil className="h-4 w-4" /> File resolution
          </Button>
        )}
      </div>

      <ActionError message={actionError} />

      {!selected && (
        <>
          {state === "loading" && <div className="text-muted">Loading...</div>}
          {state === "error" && (
            <p role="alert" className="text-sm text-[#a5442c]">
              We could not load the resolutions. Refresh to try again.
            </p>
          )}
          {state === "ready" && rows.length === 0 && (
            <div className="rounded-2xl border border-line bg-paper p-6 text-sm text-muted">
              No resolutions yet.
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
                        <div className="text-lg font-medium">
                          {row.resolutionNo ? `${row.resolutionNo} — ` : ""}
                          {row.title}
                        </div>
                        <div className="text-sm text-muted">
                          {row.unitName ?? "Organization-wide"} • {formatDate(row.createdAt)}
                          {row.hasAttachment ? " • Attachment" : ""}
                        </div>
                        {row.shortSummary && (
                          <p className="mt-1 text-sm text-body">{row.shortSummary}</p>
                        )}
                        {row.proposedBudget !== null && (
                          <p className="mt-1 text-sm text-muted">
                            Proposed budget: ₱{row.proposedBudget.toLocaleString("en-PH", { minimumFractionDigits: 2 })}
                          </p>
                        )}
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
            <button
              onClick={closeDetail}
              className="inline-flex items-center gap-1.5 text-sm text-muted"
            >
              <IconArrowLeft className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              Back
            </button>
            <StatusBadge status={selected.status} />
          </div>

          <h2 className="text-xl font-medium">
            {selected.resolutionNo ? `${selected.resolutionNo} — ` : ""}
            {selected.title}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {selected.unitName ?? "Organization-wide"} • filed {formatDate(selected.createdAt)}
            {selected.decidedAt ? ` • decided ${formatDate(selected.decidedAt)}` : ""}
          </p>
          {selected.shortSummary && <p className="mt-3 text-sm text-body">{selected.shortSummary}</p>}
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
            {selected.datePassed && (
              <span>Date passed: {formatDate(`${selected.datePassed}T00:00:00`)}</span>
            )}
            {selected.proposedBudget !== null && (
              <span>
                Proposed budget: ₱
                {selected.proposedBudget.toLocaleString("en-PH", { minimumFractionDigits: 2 })}
              </span>
            )}
          </div>
          {selected.hasAttachment && (
            <a
              href={`/api/files/resolution/${selected.id}`}
              className="mt-3 inline-flex text-sm text-accent underline"
            >
              Download {selected.originalName ?? "attachment"}
            </a>
          )}
          <p className="mt-4 whitespace-pre-wrap text-body">{selected.body}</p>

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
                      <span>{formatDate(entry.createdAt)}</span>
                    </div>
                    <div className="mt-1 font-medium">{entry.decision.replace("_", " ")}</div>
                    {entry.remark && <p className="mt-1 text-muted">{entry.remark}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {canReview && (
            <ReviewActions
              resolutionId={selected.id}
              onDone={async () => {
                await open(selected.id);
                await load();
              }}
              onError={setActionError}
            />
          )}
        </div>
      )}

      {detailState === "loading" && <div className="text-muted">Loading...</div>}
      {detailState === "error" && (
        <p role="alert" className="text-sm text-[#a5442c]">
          We could not load that resolution. Go back and try again.
        </p>
      )}

      {showCreate && (
        <CreateResolutionModal
          isUsg={isUsg}
          onClose={() => setShowCreate(false)}
          onDone={() => {
            setShowCreate(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function ReviewActions({
  resolutionId,
  onDone,
  onError,
}: {
  resolutionId: string;
  onDone: () => Promise<void> | void;
  onError: (message: string | null) => void;
}) {
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);

  const review = useCallback(
    async (decision: "under_review" | "approved" | "returned" | "published") => {
      if (busy) return;
      setBusy(true);
      onError(null);
      try {
        await mutate(`/api/resolutions/${resolutionId}/review`, {
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
    [busy, remark, resolutionId, onDone, onError],
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
        <Button size="sm" disabled={busy} onClick={() => void review("under_review")}>
          Mark under review
        </Button>
        <Button size="sm" disabled={busy} onClick={() => void review("approved")}>
          Approve
        </Button>
        <Button size="sm" disabled={busy || !remark.trim()} onClick={() => void review("returned")}>
          Return
        </Button>
        <Button size="sm" disabled={busy} onClick={() => void review("published")}>
          Publish
        </Button>
      </div>
    </div>
  );
}

function CreateResolutionModal({
  isUsg,
  onClose,
  onDone,
}: {
  isUsg: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [resolutionNo, setResolutionNo] = useState("");
  const [datePassed, setDatePassed] = useState("");
  const [shortSummary, setShortSummary] = useState("");
  const [body, setBody] = useState("");
  const [proposedBudget, setProposedBudget] = useState("");
  const [unitId, setUnitId] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentPath, setAttachmentPath] = useState("");
  const [uploading, setUploading] = useState(false);
  const [units, setUnits] = useState<Array<{ id: string; name: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isUsg) return;
    (async () => {
      try {
        const res = await fetch("/api/units");
        const json = await res.json();
        if (json.ok && Array.isArray(json.units)) {
          setUnits(
            json.units
              .map((u: { id?: string; unitId?: string; name?: string; unitName?: string }) => ({
                id: String(u.id ?? u.unitId ?? ""),
                name: String(u.name ?? u.unitName ?? "Unit"),
              }))
              .filter((u: { id: string }) => u.id),
          );
        }
      } catch {
        // A missing unit list just means the resolution stays org-wide.
      }
    })();
  }, [isUsg]);

  const attach = async (file: File | undefined) => {
    if (!file) return;
    setAttachment(file);
    setAttachmentPath("");
    setUploading(true);
    setError(null);
    try {
      const result = await uploadFile(file, {
        target: "resolution",
        unitId: unitId || undefined,
        nonce: crypto.randomUUID(),
        version: 1,
      });
      if (!result.ok || !result.storagePath) throw new Error("We could not upload that attachment.");
      setAttachmentPath(result.storagePath);
    } catch (e) {
      setAttachment(null);
      setError(actionMessage(e, "We could not upload that attachment."));
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await mutate("/api/resolutions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          resolutionNo: resolutionNo.trim(),
          datePassed,
          shortSummary: shortSummary.trim(),
          body: body.trim(),
          proposedBudget: proposedBudget.trim(),
          storagePath: attachmentPath,
          originalName: attachment?.name ?? "",
          mimeType: attachment?.type ?? "",
          sizeBytes: attachment?.size ?? 0,
          unitId: unitId || null,
        }),
      });
      onDone();
    } catch (e) {
      setError(actionMessage(e, "We could not file that resolution."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-2xl border border-line bg-paper p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-lg font-medium">File resolution</div>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="grid gap-3">
          <div>
            <div className="mb-1 text-sm text-muted">Title</div>
            <input
              id="resolution-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={selectClass}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-sm text-muted">Resolution no.</div>
              <input
                id="resolution-no"
                value={resolutionNo}
                onChange={(e) => setResolutionNo(e.target.value)}
                placeholder="e.g. 2026-001"
                className={selectClass}
              />
            </div>
            <div>
              <div className="mb-1 text-sm text-muted">Date passed</div>
              <input
                id="resolution-date-passed"
                type="date"
                value={datePassed}
                onChange={(e) => setDatePassed(e.target.value)}
                className={selectClass}
              />
            </div>
          </div>
          <div>
            <div className="mb-1 text-sm text-muted">Short summary</div>
            <textarea
              id="resolution-summary"
              value={shortSummary}
              onChange={(e) => setShortSummary(e.target.value)}
              rows={2}
              placeholder="What does this resolution do?"
              className={selectClass}
            />
          </div>
          <div>
            <div className="mb-1 text-sm text-muted">Proposed budget (PHP)</div>
            <input
              id="resolution-budget"
              type="number"
              min="0"
              step="0.01"
              value={proposedBudget}
              onChange={(e) => setProposedBudget(e.target.value)}
              placeholder="0.00"
              className={selectClass}
            />
          </div>
          <div>
            <div className="mb-1 text-sm text-muted">Attachment</div>
            <input
              id="resolution-attachment"
              type="file"
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
              onChange={(e) => void attach(e.target.files?.[0])}
              className={selectClass}
            />
            {uploading && <p className="mt-1 text-xs text-muted">Uploading attachment...</p>}
            {attachmentPath && !uploading && (
              <p className="mt-1 text-xs text-muted">Attached: {attachment?.name}</p>
            )}
          </div>
          <div>
            <div className="mb-1 text-sm text-muted">Resolution text</div>
            <textarea
              id="resolution-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              className={selectClass}
            />
          </div>
          {isUsg && (
            <div>
              <div className="mb-1 text-sm text-muted">Scope</div>
              <select
                id="resolution-scope"
                value={unitId}
                onChange={(e) => setUnitId(e.target.value)}
                className={selectClass}
              >
                <option value="">Organization-wide</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <DraftWithAiButton
            kind="resolution"
            label="Draft resolution with AI"
            disabled={saving}
            getFields={() => ({
              title,
              resolutionTitle: title,
              scope: units.find((unit) => unit.id === unitId)?.name ?? "Organization-wide",
              purpose: body,
            })}
            onUse={setBody}
          />
          <ActionError message={error} />
          <Button
            disabled={
              saving ||
              uploading ||
              title.trim().length < 4 ||
              resolutionNo.trim().length < 1 ||
              !datePassed ||
              shortSummary.trim().length < 10 ||
              body.trim().length < 10 ||
              proposedBudget.trim() === "" ||
              !attachmentPath
            }
            onClick={submit}
          >
            SUBMIT FOR USG REVIEW
          </Button>
        </div>
      </div>
    </div>
  );
}
