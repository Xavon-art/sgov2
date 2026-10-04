"use client";

import { useRef, useState } from "react";
import type { ItemKind } from "./types";
import { ACTIVITY_OPTIONS } from "./helpers";
import { Button } from "@/components/ui/Button";
import { TextField, TextArea } from "@/components/ui/Field";

type TemplateItem = { itemId: string; label: string; itemKind: ItemKind };

const FILE_LIMIT_BYTES = 10 * 1024 * 1024;

const selectClass =
  "h-12 w-full appearance-none rounded-xl border border-line bg-paper/70 px-3.5 text-[0.9375rem] text-ink-deep outline-none transition-[border-color,box-shadow,background-color] duration-300 hover:border-line-strong focus:border-ink/25 focus:bg-paper";

async function presignAndPut(
  uuid: string,
  item: TemplateItem,
  file: File,
  version: number,
): Promise<{ storagePath: string }> {
  const res = await fetch("/api/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uuid,
      itemId: item.itemId,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      version,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok || !data.signedUrl) {
    throw new Error(data.message ?? "Could not prepare that file.");
  }
  const put = await fetch(data.signedUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type, "Content-Length": String(file.size) },
    body: file,
  });
  if (!put.ok) throw new Error("The file upload failed. Try again.");
  return { storagePath: data.storagePath };
}

type FileEntry = {
  status: "empty" | "uploading" | "ready";
  fileName: string;
  storagePath: string;
  sizeBytes: number;
};

const emptyFile: FileEntry = { status: "empty", fileName: "", storagePath: "", sizeBytes: 0 };

/**
 * Both shells share this. New drafts and returned revisions walk the same
 * presign → PUT → submit flow; the only difference is the target route and the
 * version number used to mint storage slots.
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
    if (file.size > FILE_LIMIT_BYTES) {
      setError("That file is larger than the 10 MB limit.");
      return;
    }
    setFiles((m) => ({ ...m, [item.itemId]: { status: "uploading", fileName: file.name, storagePath: "", sizeBytes: file.size } }));
    try {
      const { storagePath } = await presignAndPut(draftUuid.current, item, file, initialVersion);
      setFiles((m) => ({
        ...m,
        [item.itemId]: { status: "ready", fileName: file.name, storagePath, sizeBytes: file.size },
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
        Each file is uploaded straight to secure storage before the proposal goes
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
                        ? "Uploading…"
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