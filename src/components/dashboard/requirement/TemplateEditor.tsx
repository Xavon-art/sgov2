"use client";

import { useEffect, useState } from "react";
import type { RequirementItem } from "./types";
import { Button } from "@/components/ui/Button";

type EditRow = { key: string; label: string; itemKind: "file" | "link"; extensions: string };

const selectClass =
  "h-12 w-full appearance-none rounded-xl border border-line bg-paper/70 px-3.5 text-[0.9375rem] text-ink-deep outline-none transition-[border-color,box-shadow,background-color] duration-300 hover:border-line-strong focus:border-ink/25 focus:bg-paper";

function toRows(items: RequirementItem[]): EditRow[] {
  return items.map((x) => ({
    key: x.id,
    label: x.label,
    itemKind: x.itemKind,
    extensions: x.allowedExtensions.join(","),
  }));
}

function toWire(rows: EditRow[]) {
  return rows.map((x, i) => ({
    label: x.label.trim(),
    item_kind: x.itemKind,
    allowed_extensions:
      x.itemKind === "file"
        ? x.extensions
            .split(",")
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean)
        : [],
    position: i,
  }));
}

/**
 * Owner-only: the standalone default template an unmatched (no-program) activity
 * proposal must satisfy. Editing is drop + recreate server-side, per the design's
 * "frozen after submissions exist" rule.
 */
export function TemplateEditor({ onSaved }: { onSaved: () => void }) {
  const [rows, setRows] = useState<EditRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/requirements/default")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d.ok) setRows(toRows(d.items ?? []));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  const add = () =>
    setRows((xs) => [
      ...xs,
      { key: crypto.randomUUID(), label: "", itemKind: "file", extensions: "pdf,doc,docx" },
    ]);

  const patch = (key: string, part: Partial<EditRow>) =>
    setRows((xs) => xs.map((x) => (x.key === key ? { ...x, ...part } : x)));

  const remove = (key: string) => setRows((xs) => xs.filter((x) => x.key !== key));

  const save = async () => {
    setError("");
    const wire = toWire(rows);
    if (wire.some((x) => x.label.length < 2))
      return setError("Give every item a label of at least 2 characters.");
    if (wire.some((x) => x.item_kind === "file" && x.allowed_extensions.length === 0))
      return setError("File items need at least one allowed extension.");

    setBusy(true);
    try {
      const res = await fetch("/api/requirements/default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: wire }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.message ?? "We could not save the default template.");
        return;
      }
      onSaved();
    } catch {
      setError("We could not save the default template.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-paper/70 p-6">
      <p className="eyebrow">Standalone activity template</p>
      <p className="mt-1 text-[0.8125rem] leading-relaxed text-body">
        The item set a proposal must satisfy when it does not attach to a program.
      </p>

      {!loaded ? (
        <p role="status" className="mt-4 text-[0.875rem] text-body">
          Loading the template…
        </p>
      ) : (
        <div className="mt-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[0.8125rem] font-medium text-ink">Items</span>
            <button
              type="button"
              onClick={add}
              className="text-[0.8125rem] font-semibold text-brass-deep underline-offset-2 hover:underline"
            >
              Add item
            </button>
          </div>
          {rows.length === 0 ? (
            <p className="text-[0.8125rem] text-muted">
              Nothing set yet. Standalone proposals are refused until you save at least one item.
            </p>
          ) : (
            rows.map((x) => (
              <div key={x.key} className="rounded-xl border border-line/70 bg-canvas/40 p-4">
                <div className="flex items-center justify-between gap-3">
                  <input
                    aria-label="Item label"
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
                        itemKind: e.target.value as EditRow["itemKind"],
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

          {error ? (
            <p role="alert" className="text-[0.8125rem] font-medium text-[#a5442c]">
              {error}
            </p>
          ) : null}
          <Button variant="brass" onClick={save} disabled={busy || rows.length === 0}>
            {busy ? "Saving…" : "Save template"}
          </Button>
        </div>
      )}
    </section>
  );
}