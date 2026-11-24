"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Enter } from "@/components/fx/Presence";
import { SwapText } from "@/components/fx/SwapText";
import { TextField } from "@/components/ui/Field";
import { useAccount } from "@/components/dashboard/dashboard-context";

type Conv = {
  id: string;
  subject: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessage: { body: string | null; createdAt: string; senderId: string; unsent: boolean } | null;
  unreadCount: number;
};

type Msg = {
  id: string;
  senderId: string;
  body: string | null;
  createdAt: string;
  unsent: boolean;
};

type Acct = { id: string; email: string; displayName: string | null; accountKind: string; accountScope: string };

function readDeepLinkedConversation(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("c");
}

export function MessagesPanel() {
  const account = useAccount();
  const [conversations, setConversations] = useState<Conv[]>([]);
  const [accounts, setAccounts] = useState<Acct[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(readDeepLinkedConversation);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [newSubject, setNewSubject] = useState("");
  const [newRecipient, setNewRecipient] = useState("");
  const [showNew, setShowNew] = useState(false);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectConversation = useCallback((id: string | null) => {
    setSelectedId(id);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("c", id);
    else url.searchParams.delete("c");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  // A notification clicked while the inbox is already open cannot rely on a
  // remount, so it announces the target thread here as well as in the URL.
  useEffect(() => {
    const openFromNotification = (event: Event) => {
      const id = (event as CustomEvent<{ conversationId?: string }>).detail?.conversationId;
      if (id) selectConversation(id);
    };
    window.addEventListener("smartgov:open-conversation", openFromNotification);
    return () => window.removeEventListener("smartgov:open-conversation", openFromNotification);
  }, [selectConversation]);

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations");
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.message ?? "We could not load conversations.");
        return;
      }
      setConversations(data.conversations ?? []);
      setError(null);
    } catch {
      setError("We could not reach the server. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMessages = useCallback(async (convId: string) => {
    try {
      const res = await fetch(`/api/conversations/${convId}/messages`);
      const data = await res.json();
      if (!res.ok || !data.ok) return;
      setMessages(data.messages ?? []);
      void fetch(`/api/conversations/${convId}/read`, { method: "POST" }).catch(() => {});
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadConversations();
    void (async () => {
      try {
        const res = await fetch("/api/org-accounts");
        const data = await res.json();
        if (res.ok && data.ok) setAccounts(data.accounts ?? []);
      } catch {
        // ignore
      }
    })();
  }, [loadConversations]);

  useEffect(() => {
    if (!selectedId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessages([]);
      return;
    }
    void loadMessages(selectedId);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => void loadMessages(selectedId), 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [selectedId, loadMessages]);

  async function createConversation(e: React.FormEvent) {
    e.preventDefault();
    setNote(null);
    setActionError(null);
    if (!newRecipient) {
      setActionError("Choose a recipient.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantIds: [newRecipient],
          subject: newSubject.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setActionError(data.message ?? "We could not start that conversation.");
        return;
      }
      setShowNew(false);
      setNewSubject("");
      setNewRecipient("");
      setNote("Conversation started.");
      await loadConversations();
      selectConversation(data.conversationId);
    } catch {
      setActionError("We could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!selectedId || !draft.trim()) return;
    setSending(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/conversations/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setActionError(data.message ?? "We could not send that message.");
        return;
      }
      setDraft("");
      await loadMessages(selectedId);
      await loadConversations();
    } catch {
      setActionError("We could not reach the server. Check your connection.");
    } finally {
      setSending(false);
    }
  }

  async function unsend(mid: string) {
    if (!selectedId || busyId) return;
    setBusyId(mid);
    try {
      const res = await fetch(`/api/conversations/${selectedId}/unsend/${mid}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setActionError(data.message ?? "We could not unsend that message.");
        return;
      }
      await loadMessages(selectedId);
    } catch {
      setActionError("We could not reach the server. Check your connection.");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteConv(id: string) {
    if (busyId) return;
    if (!window.confirm("Delete this conversation for you?")) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/conversations/${id}/delete`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setActionError(data.message ?? "We could not delete that conversation.");
        return;
      }
      if (selectedId === id) {
        selectConversation(null);
        setMessages([]);
      }
      await loadConversations();
    } catch {
      setActionError("We could not reach the server. Check your connection.");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <p className="text-[0.9375rem] text-muted">Loading…</p>;
  }

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

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

      <div data-tour="messages-inbox" className="flex flex-wrap items-center justify-between gap-3">
        <p className="eyebrow">Inbox</p>
        <Button data-tour="messages-new" size="sm" onClick={() => setShowNew((v) => !v)}>
          {showNew ? "Cancel" : "New conversation"}
        </Button>
      </div>

      {showNew ? (
        <form onSubmit={createConversation} className="card-lift flex flex-col gap-3 rounded-2xl border border-line bg-paper/70 p-4">
          <div className="flex flex-col gap-2">
            <label className="text-[0.8125rem] font-semibold text-ink">Recipient</label>
            <select
              value={newRecipient}
              onChange={(e) => setNewRecipient(e.target.value)}
              className="h-11 w-full rounded-xl border border-line bg-paper/70 px-3.5 text-[0.9375rem] text-ink-deep"
            >
              <option value="">Choose an officer…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName || a.email}
                </option>
              ))}
            </select>
          </div>
          <TextField id="conv-subject" label="Subject (optional)" value={newSubject} onChange={(e) => setNewSubject(e.target.value)} optional />
          <Button type="submit" disabled={busy}>
            <SwapText isPending={busy} idle="Start" pending="Starting…" />
          </Button>
        </form>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
        <aside data-tour="messages-conversation-list" className="flex flex-col gap-2">
          {conversations.length === 0 ? (
            <p className="text-[0.8125rem] text-muted">No conversations yet.</p>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                    onClick={() => selectConversation(c.id)}
                className={`flex flex-col gap-1 rounded-xl border px-3 py-2 text-left transition-colors ${
                  selectedId === c.id ? "border-ink bg-ink/[0.04]" : "border-line bg-paper hover:bg-canvas"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[0.875rem] font-medium text-ink-deep">
                    {c.subject || "(no subject)"}
                  </span>
                  {c.unreadCount > 0 ? (
                    <span className="rounded-full bg-brass px-1.5 py-0.5 text-[0.625rem] font-bold text-ink">
                      {c.unreadCount}
                    </span>
                  ) : null}
                </div>
                {c.lastMessage ? (
                  <span className="truncate text-[0.75rem] text-muted">
                    {c.lastMessage.unsent ? "Message removed" : c.lastMessage.body}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </aside>

        <main data-tour="messages-thread" className="flex min-h-[24rem] flex-col rounded-2xl border border-line bg-paper/70">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center text-[0.875rem] text-muted">
              Select a conversation.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-line px-4 py-2">
                <p className="text-[0.9375rem] font-medium text-ink-deep">{selected.subject || "(no subject)"}</p>
                <button
                  type="button"
                  disabled={busyId === selected.id}
                  onClick={() => void deleteConv(selected.id)}
                  className="pressable rounded-full border border-line px-3 py-1 text-[0.7rem] font-semibold text-[#a5442c] hover:bg-[#a5442c]/[0.06] disabled:opacity-50"
                >
                  Delete for me
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-3">
                <div className="flex flex-col gap-2">
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      className={`flex ${m.senderId === account.id ? "justify-end" : "justify-start"}`}
                    >
                      <div className="max-w-[75%] rounded-2xl border border-line bg-canvas px-3 py-2">
                        {m.unsent ? (
                          <p className="text-[0.8125rem] italic text-muted">Message removed</p>
                        ) : (
                          <p className="text-[0.875rem] text-body whitespace-pre-wrap">{m.body}</p>
                        )}
                        <div className="mt-1 flex items-center justify-between gap-3">
                          <span className="text-[0.625rem] text-muted">
                            {new Date(m.createdAt).toLocaleTimeString()}
                          </span>
                          {!m.unsent ? (
                            <button
                              type="button"
                              disabled={busyId === m.id}
                              onClick={() => void unsend(m.id)}
                              className="text-[0.625rem] text-muted underline hover:text-ink disabled:opacity-50"
                            >
                              Unsend
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2 border-t border-line px-4 py-3">
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder="Write a message…"
                  className="h-10 flex-1 rounded-full border border-line bg-canvas px-4 text-[0.875rem] text-ink-deep outline-none focus:border-ink/25"
                />
                <Button size="sm" disabled={sending || !draft.trim()} onClick={() => void send()}>
                  <SwapText isPending={sending} idle="Send" pending="…" />
                </Button>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}