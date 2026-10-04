"use client";

import { useState } from "react";
import type { ProgramRow } from "./types";
import { ACTIVITY_OPTIONS } from "./helpers";
import { Button } from "@/components/ui/Button";
import { TextField, TextArea } from "@/components/ui/Field";

type DraftItem = {
  key: string;
  label: string;
  itemKind: "file" | "link";
  extensions: string;
};

const selectClass =
  "h-12 w-full appearance-none rounded-xl border border-line bg-paper/70 px-3.5 text-[0.9375rem] text-ink-deep outline-none transition-[border-color,box-shadow,background-color] duration-300 hover:border-line-strong focus:border-ink/25 focus:bg-paper";

function extensionsFor(kind: string, extensions: string): string[] {
  if (kind !== "file") return [];
  return extensions
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

/** Owner-only: publishes one program template with its requirement items. */
export function ProgramForm({
  programs,
  onCreated,
}: {
  programs: ProgramRow[];
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<string>("community");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const addItem = () =>
    setItems((xs) => [
      ...xs,
      { key: crypto.randomUUID(), label: "", itemKind: "file", extensions: "pdf,doc,docx" },
    ]);

  const patch = (key: string, part: Partial<DraftItem>) =>
    setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...part } : x)));

  const remove = (key: string) => setItems((xs) => xs.filter((x) => x.key !== key));

  const submit = async () => {
    setError("");
    const trimmed = name.trim();
    const wire = items.map((x, i) => ({
      label: x.label.trim(),
      item_kind: x.itemKind,
      allowed_extensions: extensionsFor(x.itemKind, x.extensions),
      position: i,
    }));

    if (trimmed.length < 4) return setError("Programs need a name of at least 4 characters.");
    if (wire.some((x) => x.label.length < 2))
      return setError("Give every requirement item a label.");
    if (wire.some((x) => x.item_kind === "file" && x.allowed_extensions.length === 0))
      return setError("File items need at least one allowed extension.");

    setBusy(true);
    try {
      const res = await fetch("/api/programs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, description: description.trim(), icon, items: wire }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.message ?? "We could not create that program.");
        return;
      }
      setName("");
      setDescription("");
      setItems([]);
      onCreated();
    } catch {
      setError("We could not create that program.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-paper/70 p-6">
      <p className="eyebrow">Programs &amp; templates</p>
      {programs.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-2">
          {programs.map((p) => (
            <li key={p.id} className="rounded-xl border border-line/70 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-[0.9375rem] font-medium text-ink">{p.name}</p>
                <span className="shrink-0 text-[0.75rem] font-semibold tracking-[0.08em] text-brass-deep uppercase">
                  Published
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {p.items.map((it) => (
                  <span
                    key={it.id}
                    className="rounded-full border border-line bg-canvas/70 px-2.5 py-0.5 text-[0.6875rem] text-ink-soft"
                  >
                    {it.label}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[0.875rem] text-body">No programs yet. Publish one below.</p>
      )}

      <div className="mt-6 flex flex-col gap-4">
        <TextField
          id="program-name"
          label="Program name"
          value={name}
          maxLength={140}
          onChange={(e) => setName(e.target.value)}
          placeholder="Intramurals 2027"
        />
        <TextArea
          id="program-description"
          label="Description"
          value={description}
          maxLength={400}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What does submitting to this program require?"
        />
        <label className="flex flex-col gap-2">
          <span className="text-[0.8125rem] font-medium text-ink">Activity type</span>
          <select className={selectClass} value={icon} onChange={(e) => setIcon(e.target.value)}>
            {ACTIVITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[0.8125rem] font-medium text-ink">Requirement items</span>
            <button
              type="button"
              onClick={addItem}
              className="text-[0.8125rem] font-semibold text-brass-deep underline-offset-2 hover:underline"
            >
              Add item
            </button>
          </div>
          {items.length === 0 ? (
            <p className="text-[0.8125rem] text-muted">Add at least one item (file or link).</p>
          ) : (
            items.map((x) => (
              <div key={x.key} className="rounded-xl border border-line/70 bg-canvas/40 p-4">
                <div className="flex items-center justify-between gap-3">
                  <input
                    aria-label={`Item ${x.label || "label"}`}
                    value={x.label}
                    maxLength={140}
                    onChange={(e) => patch(x.key, { label: e.target.value })}
                    placeholder="e.g. Letter of intent"
                    className="h-10 flex-1 rounded-lg border border-line bg-paper/70 px-3 text-[0.9375rem] text-ink-deep outline-none focus:border-ink/25"
                  />
                  <button
                    type="button"
                    onClick={() => remove(x.key)}
                    className="text-[0.8125rem] font-semibold text-ink-soft hover:text-ink"
                  >
                    Remove
                  </button>
                </div>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                  <select
                    aria-label="Item kind"
                    value={x.itemKind}
                    onChange={(e) =>
                      patch(x.key, {
                        itemKind: e.target.value as DraftItem["itemKind"],
                        extensions:
                          e.target.value === "file" && !x.extensions.trim()
                            ? "pdf,doc,docx"
                            : x.extensions,
                      })
                    }
                    className={selectClass}
                  >
                    <option value="file">File upload</option>
                    <option value="link">Link / URL</option>
                  </select>
                  {x.itemKind === "file" ? (
                    <input
                      aria-label="Allowed extensions"
                      value={x.extensions}
                      onChange={(e) => patch(x.key, { extensions: e.target.value })}
                      placeholder="pdf, doc, docx, jpg"
                      className="h-12 flex-1 rounded-xl border border-line bg-paper/70 px-3.5 text-[0.9375rem] text-ink-deep outline-none focus:border-ink/25"
                    />
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>

        {error ? (
          <p role="alert" className="text-[0.8125rem] font-medium text-[#a5442c]">
            {error}
          </p>
        ) : null}
        <Button variant="brass" onClick={submit} disabled={busy}>
          {busy ? "Publishing…" : "Publish program"}
        </Button>
      </div>
    </section>
  );
}