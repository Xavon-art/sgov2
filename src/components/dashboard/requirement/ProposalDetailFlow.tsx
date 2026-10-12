"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProposalDetail, ProposalRequirement, ProposalsListRow } from "./types";
import { REQUIREMENT_STATUS_LABEL } from "./types";
import { formatDate, formatSize, statusChipClass, statusLabel } from "./helpers";
import { ActivityIcon } from "./ActivityIcon";
import { Timeline } from "./Timeline";
import { ProposalForm } from "./ProposalForm";
import { VerificationChecklist } from "./VerificationChecklist";
import { RequirementCheckPanel } from "./RequirementCheckPanel";
import { ProgressStepper } from "./ProgressStepper";
import { ReviewProposalPanel } from "./ReviewProposalPanel";
import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/Field";
import { MAX_FILE_BYTES, UPLOAD_CHUNK_BYTES } from "@/lib/documents";

/**
 * One proposal, fully open: the lifecycle progress, the timeline, every version's
 * documents, and then the panel that matches who is looking -- the USG's review
 * and verification controls, or the LSG's answers to additional requirements and
 * its resubmit path.
 */
export function ProposalDetailFlow({
  row,
  reviewer = false,
  onChanged,
  onClose,
}: {
  row: ProposalsListRow;
  reviewer?: boolean;
  onChanged?: () => void;
  onClose?: () => void;
}) {
  const [detail, setDetail] = useState<ProposalDetail | null>(null);
  const [error, setError] = useState("");
  const [resubmitting, setResubmitting] = useState(false);

  const fetchDetail = useCallback(async () => {
    const res = await fetch(`/api/proposals/${row.id}`);
    const data = (await res.json()) as
      | { ok: true; proposal: ProposalDetail }
      | { ok: false; message: string };
    return data;
  }, [row.id]);

  const apply = (data: { ok: boolean; message?: string; proposal?: ProposalDetail }) => {
    if (data.ok && data.proposal) setDetail(data.proposal);
    else setError(data.message ?? "We could not load that proposal.");
  };

  const refresh = async () => {
    onChanged?.();
    const data = await fetchDetail();
    apply(data);
  };

  useEffect(() => {
    let alive = true;
    void (async () => {
      const data = await fetchDetail();
      if (alive) apply(data);
    })();
    return () => {
      alive = false;
    };
  }, [fetchDetail]);

  if (error && !detail) {
    return (
      <section className="rounded-2xl border border-line bg-paper/70 p-6">
        <p role="alert" className="text-[0.875rem] font-medium text-[#a5442c]">
          {error}
        </p>
        {onClose ? (
          <Button variant="ghost" className="mt-4" onClick={onClose}>
            Close
          </Button>
        ) : null}
      </section>
    );
  }

  if (!detail) {
    return (
      <section className="rounded-2xl border border-line bg-paper/70 p-6">
        <p role="status" className="text-[0.875rem] text-body">
          Loading the proposal…
        </p>
      </section>
    );
  }

  const latest = detail.versions[0];
  const reviewable =
    reviewer &&
    (detail.status === "submitted" ||
      detail.status === "under_review" ||
      detail.status === "requirements_requested");
  const canResubmit = !reviewer && detail.status === "returned";
  const canRespond = !reviewer && detail.status === "requirements_requested";
  const template = latest
    ? latest.items.map((it) => ({ itemId: it.itemId, label: it.label, itemKind: it.itemKind }))
    : [];

  return (
    <section className="rounded-2xl border border-line bg-paper/70 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brass-soft/40">
              <ActivityIcon type={detail.activityType} className="h-4 w-4 text-brass-deep" />
            </span>
            <p className="text-[1.0625rem] font-semibold text-ink">{detail.title}</p>
            <span
              className={`rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold tracking-[0.06em] uppercase ${statusChipClass(detail.status)}`}
            >
              {statusLabel(detail.status)}
            </span>
          </div>
          <p className="mt-2 text-[0.8125rem] leading-relaxed text-body">
            {detail.description}
          </p>
          <p className="mt-1 text-[0.75rem] text-muted">
            {[detail.unitName, detail.programName ?? "Standalone", formatDate(detail.eventDate)]
              .filter(Boolean)
              .join(" · ")}
            {detail.venue ? ` · ${detail.venue}` : ""}
          </p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-[0.8125rem] font-semibold text-ink-soft hover:text-ink"
          >
            Close
          </button>
        ) : null}
      </div>

      <div className="mt-5 border-t border-line/70 pt-5">
        <ProgressStepper status={detail.status} />
      </div>

      <div className="mt-6">
        <p className="text-[0.8125rem] font-semibold tracking-[0.08em] text-ink-soft uppercase">
          Approval history
        </p>
        <Timeline proposal={detail} />
      </div>

      <div className="mt-6 flex flex-col gap-4">
        {detail.versions.map((v) => (
          <div key={v.id} className="rounded-xl border border-line/70 bg-canvas/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[0.875rem] font-semibold text-ink">v{v.versionNumber}</p>
              <p className="text-[0.6875rem] text-muted">
                {formatDate(v.submittedAt)} · {v.submittedBy}
              </p>
            </div>
            {v.submissionNote ? (
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-body">{v.submissionNote}</p>
            ) : null}
            <ul className="mt-3 flex flex-col gap-2">
              {v.items.map((it) => (
                <li
                  key={it.itemId}
                  className="flex items-center justify-between gap-3 rounded-lg border border-line/70 bg-paper/60 px-3 py-2"
                >
                  <span className="truncate text-[0.8125rem] text-ink-soft">{it.label}</span>
                  {it.submissionKind === "file" && it.submissionId ? (
                    <a
                      key={it.submissionId}
                      href={`/api/files/${it.submissionId}`}
                      className="shrink-0 text-[0.75rem] font-semibold text-brass-deep underline-offset-2 hover:underline"
                    >
                      {it.originalName ?? "file"} · {formatSize(it.sizeBytes)}
                    </a>
                  ) : it.submissionKind === "link" && it.linkUrl ? (
                    <a
                      href={it.linkUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 truncate text-[0.75rem] font-semibold text-brass-deep underline-offset-2 hover:underline"
                    >
                      {it.linkUrl.length > 40 ? `${it.linkUrl.slice(0, 40)}…` : it.linkUrl}
                    </a>
                  ) : (
                    <span className="shrink-0 text-[0.75rem] text-muted">—</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {reviewable ? (
        <div className="mt-6">
          <ReviewProposalPanel proposal={detail} onDone={refresh} />
        </div>
      ) : null}

      {canRespond ? (
        <div className="mt-6">
          <RequirementResponseSection proposal={detail} onDone={refresh} />
        </div>
      ) : null}

      {latest ? (
        <div className="mt-6 border-t border-line/70 pt-5">
          <RequirementCheckPanel proposalId={detail.id} versionId={latest.id} />
        </div>
      ) : null}

      {latest?.items.some((it) => it.submissionKind === "file") ? (
        <div className="mt-6 border-t border-line/70 pt-5">
          <p className="text-[0.8125rem] font-semibold tracking-[0.08em] text-ink-soft uppercase">
            Document checklist
          </p>
          <p className="mt-1 text-[0.8125rem] text-muted">
            {reviewer
              ? "Open each file, then rule on it. A question needs a reason."
              : "What the office has checked on your files so far."}
          </p>
          <div className="mt-4">
            <VerificationChecklist
              proposalId={detail.id}
              reviewer={reviewer}
              onChanged={onChanged}
            />
          </div>
        </div>
      ) : null}

      {canResubmit && !resubmitting ? (
        <div className="mt-6 border-t border-line/70 pt-5">
          <Button variant="brass" onClick={() => setResubmitting(true)}>
            Resubmit revision
          </Button>
        </div>
      ) : null}

      {canResubmit && resubmitting ? (
        <div className="mt-6">
          <ProposalForm
            template={template}
            proposalId={detail.id}
            initialVersion={latest?.versionNumber ?? 1}
            heading={`Revision ${(latest?.versionNumber ?? 1) + 1} of ${detail.title}`}
            onDone={() => {
              setResubmitting(false);
              onChanged?.();
              void (async () => {
                const data = await fetchDetail();
                apply(data);
              })();
            }}
          />
        </div>
      ) : null}
    </section>
  );
}

type ResponseFile = {
  status: "empty" | "uploading" | "ready";
  fileName: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  sentBytes: number;
};

const emptyResponseFile: ResponseFile = {
  status: "empty",
  fileName: "",
  storagePath: "",
  mimeType: "",
  sizeBytes: 0,
  sentBytes: 0,
};

async function postUpload(action: string, body: Record<string, unknown>) {
  const res = await fetch("/api/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.message ?? "That file could not be uploaded.");
  return data as Record<string, number | string | boolean>;
}

/**
 * Sends one answer document to the database in pieces, against a
 * `proposal_requirement` rather than a requirement item. A requirement response
 * has no resume semantics -- the claim is reserved or refused -- so the walk
 * always starts at byte zero.
 */
async function claimAndSendRequirement(
  nonce: string,
  requirementId: string,
  file: File,
  version: number,
  onProgress: (sent: number) => void,
): Promise<{ storagePath: string }> {
  const claimed = await postUpload("claim", {
    target: "requirement",
    nonce,
    requirementId,
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    version,
  });

  const storagePath = String(claimed.storagePath);
  let sent = 0;
  onProgress(sent);

  while (sent < file.size) {
    const end = Math.min(sent + UPLOAD_CHUNK_BYTES, file.size);
    const res = await fetch("/api/uploads", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "x-smartgov-path": storagePath,
        "x-smartgov-offset": String(sent),
        "x-smartgov-total": String(file.size),
      },
      body: file.slice(sent, end),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.message ?? "The file upload failed. Try again.");
    }
    sent = Number(data.writtenBytes ?? end);
    onProgress(sent);
  }

  await postUpload("commit", { storagePath, actualBytes: file.size });

  return { storagePath };
}

/**
 * The LSG's end of the requirements loop. Each open requirement takes either a
 * document or a link; they are answered together and submit flips the proposal
 * back to the USG for verification. Requirements already answered are shown
 * read-only with the verdict they drew.
 */
function RequirementResponseSection({
  proposal,
  onDone,
}: {
  proposal: ProposalDetail;
  onDone: () => void;
}) {
  const [kinds, setKinds] = useState<Record<string, "file" | "link">>({});
  const [files, setFiles] = useState<Record<string, ResponseFile>>({});
  const [links, setLinks] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const version = proposal.versions[0]?.versionNumber ?? 1;
  const open = proposal.requirements.filter((r) => r.status === "requested");
  const answered = proposal.requirements.filter((r) => r.status !== "requested");

  const onFile = async (requirement: ProposalRequirement, file: File | null) => {
    setError("");
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError("That file is larger than the 10 MB limit.");
      return;
    }
    setFiles((m) => ({
      ...m,
      [requirement.id]: {
        status: "uploading",
        fileName: file.name,
        storagePath: "",
        mimeType: file.type,
        sizeBytes: file.size,
        sentBytes: 0,
      },
    }));
    try {
      const { storagePath } = await claimAndSendRequirement(
        proposal.id,
        requirement.id,
        file,
        version,
        (sent) =>
          setFiles((m) => ({
            ...m,
            [requirement.id]: { ...m[requirement.id], sentBytes: sent },
          })),
      );
      setFiles((m) => ({
        ...m,
        [requirement.id]: {
          status: "ready",
          fileName: file.name,
          storagePath,
          mimeType: file.type,
          sizeBytes: file.size,
          sentBytes: file.size,
        },
      }));
    } catch (err) {
      setFiles((m) => ({ ...m, [requirement.id]: emptyResponseFile }));
      setError(err instanceof Error ? err.message : "That file could not be uploaded.");
    }
  };

  const submit = async () => {
    setError("");
    const items: Array<Record<string, unknown>> = [];
    for (const r of open) {
      const kind = kinds[r.id] ?? "file";
      if (kind === "file") {
        const f = files[r.id];
        if (!f || f.status !== "ready") {
          setError(`Upload the file for "${r.label}" before submitting.`);
          return;
        }
        items.push({
          requirementId: r.id,
          kind: "file",
          originalName: f.fileName,
          storagePath: f.storagePath,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
        });
      } else {
        const url = (links[r.id] ?? "").trim();
        if (!url) {
          setError(`Add a link for "${r.label}" before submitting.`);
          return;
        }
        items.push({ requirementId: r.id, kind: "link", linkUrl: url });
      }
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/proposals/${proposal.id}/requirements/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, note: note.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.message ?? "We could not send those responses.");
        return;
      }
      onDone();
    } catch {
      setError("We could not send those responses.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-paper/70 p-6">
      <p className="font-semibold text-ink">Additional requirements</p>
      <p className="mt-1 text-[0.8125rem] leading-relaxed text-body">
        The board approved this proposal with conditions. Answer each one, then send them
        together; the proposal goes back for verification.
      </p>

      {open.length > 0 ? (
        <div className="mt-5 flex flex-col gap-3">
          {open.map((r) => {
            const kind = kinds[r.id] ?? "file";
            return (
              <div key={r.id} className="rounded-xl border border-line/70 bg-canvas/40 p-4">
                <p className="text-[0.875rem] font-medium text-ink">{r.label}</p>
                {r.detail ? (
                  <p className="mt-0.5 text-[0.8125rem] text-body">{r.detail}</p>
                ) : null}
                <div className="mt-3 flex gap-2">
                  {(["file", "link"] as const).map((k) => (
                    <Button
                      key={k}
                      size="sm"
                      variant={kind === k ? "primary" : "paper"}
                      disabled={busy}
                      onClick={() => setKinds((m) => ({ ...m, [r.id]: k }))}
                    >
                      {k === "file" ? "Upload file" : "Paste link"}
                    </Button>
                  ))}
                </div>
                {kind === "file" ? (
                  <label className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-line bg-paper/70 px-3 py-2.5">
                    <span className="truncate text-[0.8125rem] text-ink-soft">
                      {files[r.id]?.status === "ready"
                        ? files[r.id].fileName
                        : files[r.id]?.status === "uploading"
                          ? `Uploading… ${Math.round(
                              ((files[r.id]?.sentBytes ?? 0) / (files[r.id]?.sizeBytes || 1)) * 100,
                            )}%`
                          : "Choose a file"}
                    </span>
                    <input
                      aria-label={`File for ${r.label}`}
                      type="file"
                      className="hidden"
                      onChange={(e) => onFile(r, e.target.files?.[0] ?? null)}
                    />
                    <span className="shrink-0 cursor-pointer text-[0.75rem] font-semibold text-brass-deep">
                      {files[r.id]?.status === "ready" ? "Replace" : "Browse"}
                    </span>
                  </label>
                ) : (
                  <input
                    aria-label={`Link for ${r.label}`}
                    type="url"
                    value={links[r.id] ?? ""}
                    onChange={(e) => setLinks((m) => ({ ...m, [r.id]: e.target.value }))}
                    placeholder="https://"
                    className="mt-2 h-11 w-full rounded-lg border border-line bg-paper/70 px-3 text-[0.875rem] text-ink-deep outline-none focus:border-ink/25"
                  />
                )}
              </div>
            );
          })}

          <TextArea
            id="requirement-note"
            label="Note to the board"
            value={note}
            maxLength={300}
            optional
            onChange={(e) => setNote(e.target.value)}
          />

          {error ? (
            <p role="alert" className="text-[0.8125rem] font-medium text-[#a5442c]">
              {error}
            </p>
          ) : null}

          <div>
            <Button variant="brass" onClick={submit} disabled={busy}>
              {busy ? "Sending…" : "Send responses"}
            </Button>
          </div>
        </div>
      ) : null}

      {answered.length > 0 ? (
        <div className="mt-5 border-t border-line/70 pt-4">
          <p className="text-[0.75rem] font-semibold tracking-[0.08em] text-ink-soft uppercase">
            Answered
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {answered.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-line/70 bg-paper/60 px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[0.8125rem] text-ink">{r.label}</span>
                  <span className="text-[0.6875rem] text-muted">
                    {REQUIREMENT_STATUS_LABEL[r.status]}
                  </span>
                </span>
                {r.linkUrl ? (
                  <a
                    href={r.linkUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 truncate text-[0.75rem] font-semibold text-brass-deep underline-offset-2 hover:underline"
                  >
                    {r.linkUrl}
                  </a>
                ) : r.originalName ? (
                  <a
                    href={`/api/files/requirement/${r.id}`}
                    className="shrink-0 text-[0.75rem] font-semibold text-brass-deep underline-offset-2 hover:underline"
                  >
                    {r.originalName} · {formatSize(r.sizeBytes)}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}