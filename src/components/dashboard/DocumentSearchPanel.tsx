"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/fx/Reveal";
import { selectClass, ROW_STAGGER_MS } from "@/components/dashboard/workspace-shared";
import {
  DOCUMENT_STATUS_CLASS,
  DOCUMENT_STATUS_LABEL,
  GROUP_KIND_LABEL,
  formatDocumentDate,
  type DocumentRow,
  type DocumentStatus,
} from "@/lib/document-search";

type SearchState = "loading" | "ready" | "error";

function StatusBadge({ status }: { status: DocumentStatus }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${DOCUMENT_STATUS_CLASS[status]}`}>
      {DOCUMENT_STATUS_LABEL[status]}
    </span>
  );
}

export function DocumentSearchPanel() {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<DocumentRow[]>([]);
  const [state, setState] = useState<SearchState>("loading");
  const [queried, setQueried] = useState(false);

  const run = useCallback(async () => {
    setState("loading");
    setQueried(true);
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (type.trim()) params.set("type", type.trim());
    if (status) params.set("status", status);
    params.set("limit", "100");

    try {
      const res = await fetch(`/api/documents?${params.toString()}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.message);
      setRows((json.rows as DocumentRow[]) ?? []);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [q, status, type]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run();
    // The first load is the catalog itself; later searches are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid gap-6">
      <form
        className="grid gap-3 rounded-2xl border border-line bg-paper/70 p-4 sm:p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <div>
          <label className="mb-1 block text-sm text-muted" htmlFor="document-search-q">
            Search
          </label>
          <input
            id="document-search-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Title, description, keyword, or requirement"
            className={selectClass}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-muted" htmlFor="document-search-type">
              Type
            </label>
            <input
              id="document-search-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              placeholder="PDF, DOCX, XLSX"
              className={selectClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted" htmlFor="document-search-status">
              Status
            </label>
            <select
              id="document-search-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className={selectClass}
            >
              <option value="">Any status</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={state === "loading"}>
            Search catalog
          </Button>
        </div>
      </form>

      {state === "error" && (
        <p role="alert" className="text-sm text-[#a5442c]">
          We could not search the document catalog. Refresh to try again.
        </p>
      )}

      {state === "loading" && <div className="text-muted">Searching...</div>}

      {state === "ready" && rows.length === 0 && (
        <div className="rounded-2xl border border-line bg-paper p-6 text-sm text-muted">
          {queried
            ? "No documents match this search. Try a broader term or clear the filters."
            : "No documents have been catalogued yet."}
        </div>
      )}

      {state === "ready" && rows.length > 0 && (
        <div className="grid gap-3">
          {rows.map((row, i) => (
            <Reveal key={row.submissionId} delay={i * ROW_STAGGER_MS}>
              <div className="rounded-2xl border border-line bg-paper p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-lg font-medium">{row.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                      <span className="font-semibold tracking-[0.06em] uppercase">{row.type}</span>
                      <span aria-hidden="true">·</span>
                      <span>{row.unitName ?? "Organization-wide"}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatDocumentDate(row.submittedAt)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{row.groupLabel ?? GROUP_KIND_LABEL[row.groupKind]}</span>
                    </div>
                  </div>
                  <StatusBadge status={row.status} />
                </div>

                {row.description && (
                  <p className="mt-3 whitespace-pre-wrap text-sm text-body">{row.description}</p>
                )}
                {row.keywords && <p className="mt-2 text-xs text-muted">Keywords: {row.keywords}</p>}

                <div className="mt-4">
                  <a
                    href={`/api/files/${row.submissionId}`}
                    className="pressable inline-flex items-center gap-1.5 rounded-full border border-line-strong px-4 py-2 text-[0.875rem] font-medium text-ink hover:border-ink/40 hover:bg-ink/[0.035]"
                  >
                    Download
                  </a>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
}
