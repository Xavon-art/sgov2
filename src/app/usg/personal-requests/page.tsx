"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Enter } from "@/components/fx/Presence";
import { SwapText } from "@/components/fx/SwapText";
import { TextField } from "@/components/ui/Field";
import { useAccount } from "@/components/dashboard/dashboard-context";
import { NotAvailable } from "@/components/dashboard/NotAvailable";

type PR = {
  id: string;
  title: string;
  purpose: string | null;
  coverLetter: string | null;
  supportDocument: string | null;
  deadline: string | null;
  timezone: string | null;
  status: string;
  decisionNote: string | null;
  createdAt: string;
  createdBy: string;
  canDecide: boolean;
};

export default function UsgPersonalRequestsPage() {
  const account = useAccount();

  const [requests, setRequests] = useState<PR[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  const [decisionNote, setDecisionNote] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/personal-requests");
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.message ?? "We could not load requests.");
        return;
      }
      setRequests(data.requests ?? []);
      setError(null);
    } catch {
      setError("We could not reach the server. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (account.accountScope !== "owner") return <NotAvailable />;

  async function decide(id: string) {
    setBusy(true);
    setActionError(null);
    setNote(null);
    try {
      const res = await fetch(`/api/personal-requests/${id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: decisionNote.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setActionError(data.message ?? "We could not record that decision.");
        return;
      }
      setNote(`Request ${decision}.`);
      setDecidingId(null);
      setDecisionNote("");
      await load();
    } catch {
      setActionError("We could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-[0.9375rem] text-muted">Loading…</p>;

  return (
    <div className="flex flex-col gap-6">
      {note ? (
        <Enter open as="p" role="status" className="rounded-xl border border-brass/40 bg-brass-soft/25 px-3.5 py-2.5 text-[0.8125rem] font-medium text-ink">
          {note}
        </Enter>
      ) : null}
      {actionError ? (
        <Enter open as="p" role="alert" className="rounded-xl border border-[#d9a99c] bg-[#a5442c]/[0.06] px-3.5 py-2.5 text-[0.8125rem] font-medium text-[#a5442c]">
          {actionError}
        </Enter>
      ) : null}
      {error ? <p className="text-[0.875rem] text-[#a5442c]">{error}</p> : null}

      {requests.length === 0 ? (
        <p className="text-[0.875rem] text-muted">No personal requests yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {requests.map((r) => (
            <li key={r.id} className="rounded-card border border-line bg-paper px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[0.9375rem] font-medium text-ink-deep">{r.title}</p>
                  <p className="text-[0.75rem] text-muted">
                    {r.status}
                    {r.deadline ? ` · due ${new Date(r.deadline).toLocaleString()}` : ""}
                  </p>
                  {r.purpose ? <p className="mt-1 text-[0.8125rem] text-body">{r.purpose}</p> : null}
                  {r.coverLetter ? <p className="mt-1 text-[0.8125rem] text-body whitespace-pre-wrap">{r.coverLetter}</p> : null}
                  {r.decisionNote ? <p className="mt-1 text-[0.8125rem] text-muted">Note: {r.decisionNote}</p> : null}
                </div>
                {r.status === "pending" && r.canDecide ? (
                  decidingId === r.id ? (
                    <div className="flex flex-col gap-2">
                      <select
                        value={decision}
                        onChange={(e) => setDecision(e.target.value as "approved" | "rejected")}
                        className="h-9 rounded-lg border border-line bg-paper px-2 text-[0.8125rem]"
                      >
                        <option value="approved">Approve</option>
                        <option value="rejected">Reject</option>
                      </select>
                      <TextField id={`note-${r.id}`} label="Note (optional)" value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} optional />
                      <div className="flex gap-2">
                        <Button size="sm" disabled={busy} onClick={() => void decide(r.id)}>
                          <SwapText isPending={busy} idle="Save" pending="Saving…" />
                        </Button>
                        <button
                          type="button"
                          onClick={() => {
                            setDecidingId(null);
                            setDecisionNote("");
                          }}
                          className="pressable rounded-full border border-line px-3 py-1.5 text-[0.75rem] font-medium text-muted"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setDecidingId(r.id);
                        setDecision("approved");
                        setDecisionNote("");
                      }}
                      className="pressable rounded-full border border-line px-3 py-1.5 text-[0.75rem] font-semibold text-ink hover:bg-paper"
                    >
                      Decide
                    </button>
                  )
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}