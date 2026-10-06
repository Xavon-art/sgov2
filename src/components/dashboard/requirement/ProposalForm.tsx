"use client";

import { useRef, useState } from "react";
import type { ItemKind } from "./types";
import { ACTIVITY_OPTIONS } from "./helpers";
import { Button } from "@/components/ui/Button";
import { TextField, TextArea } from "@/components/ui/Field";
import { MAX_FILE_BYTES, UPLOAD_CHUNK_BYTES } from "@/lib/documents";

type TemplateItem = { itemId: string; label: string; itemKind: ItemKind };

const selectClass =
  "h-12 w-full appearance-none rounded-xl border border-line bg-paper/70 px-3.5 text-[0.9375rem] text-ink-deep outline-none transition-[border-color,box-shadow,background-color] duration-300 hover:border-line-strong focus:border-ink/25 focus:bg-paper";

async function postJson(action: string, body: Record<string, unknown>) {
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
 * Sends one file to the database in pieces.
 *
 * The route owns the storage path, so this sends only what the browser actually
 * knows: which requirement item, which file, how big it is, and the draft nonce it
 * wants the slot named under. It then walks the file a chunk at a time, starting at
 * whatever the server says is already there, so a dropped connection costs the
 * bytes of the chunk in flight rather than the whole file.
 */
async function claimAndSend(
  nonce: string,
  item: TemplateItem,
  file: File,
  version: number,
  onProgress: (sent: number) => void,
): Promise<{ storagePath: string }> {
  const claimed = await postJson("claim", {
    nonce,
    itemId: item.itemId,
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    version,
  });

  const storagePath = String(claimed.storagePath);
  let sent = Number(claimed.writtenBytes ?? 0);
  onProgress(sent);

  while (sent < file.size) {
    const end = Math.min(sent + UPLOAD_CHUNK_BYTES, file.size);

    // Raw bytes rather than JSON: base64 would inflate the body by a third, and the
    // body is exactly what the hosting edge caps. The offset rides in a header.
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

  await postJson("commit", { storagePath, actualBytes: file.size });

  return { storagePath };
}

type FileEntry = {
  status: "empty" | "uploading" | "ready";
  fileName: string;
  storagePath: string;
  sizeBytes: number;
  sentBytes: number;
};

const emptyFile: FileEntry = {
  status: "empty",
  fileName: "",
  storagePath: "",
  sizeBytes: 0,
  sentBytes: 0,
};

/**
 * Both shells share this. New drafts and returned revisions walk the same
 * claim → chunk → commit → submit flow; the only difference is the target route and
 * the version number used to mint storage slots.
 */
export function ProposalForm({
  template,
  programId = null,
  unitId = null,
  proposalId = null,
  initialVersion = 1,
  heading,
  onDone,
}: {
  template: TemplateItem[];
  programId?: string | null;
  unitId?: string | null;
  proposalId?: string | null;
  initialVersion?: number;
  heading: string;
  onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [activityType, setActivityType] = useState<string>("community");
  const [eventDate, setEventDate] = useState("");
  const [venue, setVenue] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<Record<string, FileEntry>>({});
  const [links, setLinks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const draftUuid = useRef(crypto.randomUUID());

  const onFile = async (item: TemplateItem, file: File | null) => {
    setError("");
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError("That file is larger than the 10 MB limit.");
      return;
    }
    setFiles((m) => ({
      ...m,
      [item.itemId]: {
        status: "uploading",
        fileName: file.name,
        storagePath: "",
        sizeBytes: file.size,
        sentBytes: 0,
      },
    }));
    try {
      const { storagePath } = await claimAndSend(
        draftUuid.current,
        item,
        file,
        initialVersion,
        (sent) =>
          setFiles((m) => ({
            ...m,
            [item.itemId]: { ...m[item.itemId], sentBytes: sent },
          })),
      );
      setFiles((m) => ({
        ...m,
        [item.itemId]: {
          status: "ready",
          fileName: file.name,
          storagePath,
          sizeBytes: file.size,
          sentBytes: file.size,
        },
      }));
    } catch (err) {
      setFiles((m) => ({ ...m, [item.itemId]: emptyFile }));
      setError(err instanceof Error ? err.message : "That file could not be uploaded.");
    }
  };

  const submit = async () => {
    setError("");
    const items: Array<Record<string, unknown>> = [];

    for (const t of template) {
      if (t.itemKind === "file") {
        const f = files[t.itemId];
        if (!f || f.status !== "ready") {
          setError(`Upload "${t.label}" before submitting.`);
          return;
        }
        items.push({
          requirement_item_id: t.itemId,
          kind: "file",
          originalName: f.fileName,
          storagePath: f.storagePath,
          sizeBytes: f.sizeBytes,
        });
      } else {
        const url = (links[t.itemId] ?? "").trim();
        if (!url) {
          setError(`Add a URL for "${t.label}".`);
          return;
        }
        items.push({ requirement_item_id: t.itemId, kind: "link", linkUrl: url });
      }
    }

    setBusy(true);
    try {
      const url = proposalId ? `/api/proposals/${proposalId}` : "/api/proposals";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: proposalId
          ? JSON.stringify({ note: note.trim(), items })
          : JSON.stringify({
              programId,
              unitId,
              title: title.trim(),
              description: description.trim(),
              activityType,
              eventDate: eventDate || null,
              venue: venue.trim(),
              note: note.trim(),
              items,
            }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.message ?? "We could not submit that proposal.");
        return;
      }
      onDone();
    } catch {
      setError("We could not submit that proposal.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-paper/70 p-6">
      <p className="font-semibold text-ink">{heading}</p>
      <p className="mt-1 text-[0.8125rem] leading-relaxed text-body">
        Each file is uploaded to secure storage and sealed before the proposal goes
        to the USG board.
      </p>

      <div className="mt-5 flex flex-col gap-4">
        {!proposalId ? (
          <>
            <TextField
              id="proposal-title"
              label="Title"
              value={title}
              maxLength={140}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="ISF x Green Week 2027"
            />
            <TextArea
              id="proposal-description"
              label="Description"
              value={description}
              maxLength={600}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this activity, who runs it, what does it need?"
            />
            <label className="flex flex-col gap-2">
              <span className="text-[0.8125rem] font-medium text-ink">Activity type</span>
              <select
                className={selectClass}
                value={activityType}
                onChange={(e) => setActivityType(e.target.value)}
              >
                {ACTIVITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                id="proposal-date"
                label="Event date"
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
              />
              <TextField
                id="proposal-venue"
                label="Venue"
                value={venue}
                maxLength={120}
                onChange={(e) => setVenue(e.target.value)}
                placeholder="Gymnasium"
              />
            </div>
          </>
        ) : (
          <p className="text-[0.8125rem] text-muted">
            Submitting revision {initialVersion + 1}. The item set is unchanged.
          </p>
        )}

        <div className="flex flex-col gap-3">
          <span className="text-[0.8125rem] font-medium text-ink">Required items</span>
          {template.map((t) => (
            <div key={t.itemId} className="rounded-xl border border-line/70 bg-canvas/40 p-4">
              <p className="text-[0.875rem] font-medium text-ink">{t.label}</p>
              {t.itemKind === "file" ? (
                <label className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-line bg-paper/70 px-3 py-2.5">
                  <span className="truncate text-[0.8125rem] text-ink-soft">
                    {files[t.itemId]?.status === "ready"
                      ? files[t.itemId].fileName
                      : files[t.itemId]?.status === "uploading"
                        ? `Uploading… ${Math.round(
                            ((files[t.itemId]?.sentBytes ?? 0) / (files[t.itemId]?.sizeBytes || 1)) * 100,
                          )}%`
                        : "Choose a file"}
                  </span>
                  <input
                    aria-label={`Upload for ${t.label}`}
                    type="file"
                    className="hidden"
                    onChange={(e) => onFile(t, e.target.files?.[0] ?? null)}
                  />
                  <span className="shrink-0 cursor-pointer text-[0.75rem] font-semibold text-brass-deep">
                    {files[t.itemId]?.status === "ready" ? "Replace" : "Browse"}
                  </span>
                </label>
              ) : (
                <input
                  aria-label={`URL for ${t.label}`}
                  type="url"
                  value={links[t.itemId] ?? ""}
                  onChange={(e) => setLinks((m) => ({ ...m, [t.itemId]: e.target.value }))}
                  placeholder="https://"
                  className="mt-2 h-11 w-full rounded-lg border border-line bg-paper/70 px-3 text-[0.875rem] text-ink-deep outline-none focus:border-ink/25"
                />
              )}
            </div>
          ))}
        </div>

        <TextArea
          id="proposal-note"
          label="Note to the reviewer"
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

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="brass" onClick={submit} disabled={busy || template.length === 0}>
            {busy ? "Submitting…" : proposalId ? "Submit revision" : "Submit proposal"}
          </Button>
          <Button variant="ghost" onClick={onDone} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    </section>
  );
}