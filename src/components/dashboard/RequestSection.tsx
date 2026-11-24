"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useDashboard } from "@/components/dashboard/dashboard-context";
import { Reveal } from "@/components/fx/Reveal";
import { Button } from "@/components/ui/Button";
import { ActionError, SectionIcon } from "@/components/dashboard/workspace-shared";
import {
  IconArchive,
  IconArrowLeft,
  IconLayers,
  IconPencil,
  IconSubmission,
  IconUser,
  IconVerification,
} from "@/components/ui/Icons";
import { ResolutionPanel } from "@/components/dashboard/ResolutionPanel";
import { RequirementsPanel } from "@/components/dashboard/RequirementsPanel";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DraftWithAiButton } from "@/components/ai/DraftWithAiButton";
import { selectClass, ROW_STAGGER_MS } from "@/components/dashboard/workspace-shared";
import { TimezonePicker } from "@/components/ui/TimezonePicker";
import { todayIso, dueLabel } from "@/lib/tasks";
import { uploadFile } from "@/lib/upload-client";
function uuidv4() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return (crypto as { randomUUID: () => string }).randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function mutate(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, init);
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || json.ok !== true) {
    const detail = typeof json.message === "string" && json.message.trim()
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

type TaskListItem = {
  id: string;
  title: string;
  details: string;
  dueDate: string | null;
  dueTime?: string | null;
  dueTimezone?: string | null;
  priority: "low" | "normal" | "high";
  autoClose?: boolean;
  overdue: boolean;
  daysLeft: number | null;
  assignments: Array<{ unitId: string; unitName: string; status: "assigned" | "in_progress" | "submitted" | "done"; note: string }>;
  doneUnits: number;
  totalUnits: number;
  isClosed?: boolean;
};

type ReqItem = {
  id: string;
  label: string;
  instructions: string | null;
  acceptedTypes: string[] | null;
  required: boolean;
  position: number;
  verdicts?: Array<Record<string, unknown>>;
  myAnswer?: Record<string, unknown> | null;
};

type AssignmentResponse = {
  unitId: string;
  unitName: string;
  status: string;
  note: string;
  responseName: string | null;
  responseMime: string | null;
  responseBytes: number | null;
  hasResponse: boolean;
  respondedAt: string | null;
  updatedAt: string | null;
  mine: boolean;
};

type Msg = {
  id: string;
  taskId: string;
  unitId: string | null;
  authorSide: "usg" | "lsg";
  authorAccountId: string;
  body: string;
  replyTo: string | null;
  unsent: boolean;
  hiddenFromOffice: boolean;
  hiddenFromUnit: boolean;
  createdAt: string;
  reactions: Array<{ reaction: string; count: number; mine: boolean }>;
};

type PersonalReq = {
  id: string;
  unitId: string;
  unitName: string;
  subject: string;
  coverLetter: string;
  purpose: string;
  neededOn: string | null;
  neededTime: string | null;
  neededTimezone: string | null;
  status: "submitted" | "granted" | "declined" | "needs_revision" | "submission_required" | "withdrawn" | "expired";
  decisionNote: string | null;
  decidedAt: string | null;
  document?: { storagePath: string; originalName: string; mimeType: string; sizeBytes: number } | null;
  linkUrl: string | null;
  createdAt: string;
};

function fmtTime(s: string) {
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

export function RequestSection({ isUsg }: { isUsg: boolean }) {
  const { role } = useDashboard();
  const ownUnitId = role.unitId;
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<"tasks" | "requirements" | "personal" | "resolutions">(
    searchParams.get("tab") === "personal"
      ? "personal"
      : searchParams.get("tab") === "resolutions"
        ? "resolutions"
        : searchParams.get("tab") === "requirements"
          ? "requirements"
          : "tasks",
  );
  useEffect(() => {
    const raw = searchParams.get("tab");
    const next =
      raw === "personal"
        ? "personal"
        : raw === "resolutions"
          ? "resolutions"
          : raw === "requirements"
            ? "requirements"
            : "tasks";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTab(next);
  }, [searchParams]);
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [taskState, setTaskState] = useState<"loading" | "ready" | "error">("loading");
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [reqs, setReqs] = useState<ReqItem[]>([]);
  const [responses, setResponses] = useState<AssignmentResponse[]>([]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [canClose, setCanClose] = useState(false);
  const [closed, setClosed] = useState(false);
  const [msgText, setMsgText] = useState("");
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [personal, setPersonal] = useState<PersonalReq[]>([]);
  const [pState, setPState] = useState<"loading" | "ready" | "error">("loading");
  const [showPR, setShowPR] = useState(false);

  const loadTasks = useCallback(async () => {
    setTaskState("loading");
    try {
      const res = await fetch("/api/tasks");
      const json = await res.json();
      if (!json.ok) throw new Error(json.message);
      setTasks(json.tasks || []);
      setTaskState("ready");
    } catch {
      setTaskState("error");
    }
  }, []);

  const loadPersonal = useCallback(async () => {
    setPState("loading");
    try {
      const res = await fetch("/api/requests");
      const json = await res.json();
      if (!json.ok) throw new Error(json.message);
      setPersonal(json.requests || []);
      setPState("ready");
    } catch {
      setPState("error");
    }
  }, []);

  useEffect(() => {
    (async () => {
      await loadTasks();
      await loadPersonal();
    })();
  }, [loadTasks, loadPersonal]);

  const openTask = useCallback(async (id: string) => {
    setSelectedTask(id);
    const d = await fetch(`/api/tasks/${id}?taskId=${id}`).then((r) => r.json());
    if (d.ok) {
      setDetail(d.task);
      setReqs(d.requirements || []);
      setResponses((d.responses as AssignmentResponse[] | undefined) ?? []);
      setCanClose(d.canClose);
    }
  }, []);

  useEffect(() => {
    if (!selectedTask) return;
    const es = new EventSource(`/api/tasks/thread/stream?taskId=${selectedTask}`);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (Array.isArray(data.messages)) setMsgs(data.messages);
        if (typeof data.closed === "boolean") setClosed(data.closed);
      } catch {
        // ignore
      }
    };
    return () => es.close();
  }, [selectedTask]);

  const sendMsg = useCallback(async () => {
    if (!selectedTask || !msgText.trim()) return;
    setSending(true);
    setActionError(null);
    try {
      await mutate("/api/tasks/thread", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "send", taskId: selectedTask, body: msgText.trim() }),
      });
      setMsgText("");
      await openTask(selectedTask);
    } catch (e) {
      setActionError(actionMessage(e, "We could not send that message."));
    } finally {
      setSending(false);
    }
  }, [selectedTask, msgText, openTask]);

  const unsend = useCallback(async (mid: string) => {
    setActionError(null);
    try {
      await mutate("/api/tasks/thread", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "unsend", messageId: mid }),
      });
      if (selectedTask) await openTask(selectedTask);
    } catch (e) {
      setActionError(actionMessage(e, "We could not unsend that message."));
    }
  }, [selectedTask, openTask]);

  const react = useCallback(async (mid: string, r: string) => {
    setActionError(null);
    try {
      await mutate("/api/tasks/thread", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "react", messageId: mid, reaction: r }),
      });
      if (selectedTask) await openTask(selectedTask);
    } catch (e) {
      setActionError(actionMessage(e, "We could not add that reaction."));
    }
  }, [selectedTask, openTask]);

  return (
    <div className="mx-auto flex w-full max-w-[110rem] flex-col gap-8 px-4 py-8 sm:px-6 lg:px-10">
      <Reveal>
        <header data-tour="request-header" className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <SectionIcon>
              <IconSubmission className="h-5 w-5" strokeWidth={1.7} />
            </SectionIcon>
            <div className="flex flex-col gap-1">
              <p className="text-xs uppercase tracking-[0.32em] text-muted">Request</p>
              <h1 className="text-[clamp(2rem,4vw,3.4rem)] leading-[1.02]">Tasks, requirements, and personal requests</h1>
            </div>
          </div>
          <p className="max-w-2xl text-[0.98rem] leading-relaxed text-body">
            {isUsg
              ? "Push tasks down to units, review LSG requirements, follow threads, and decide submissions."
              : "Respond to requirements from the office, send yours upward, and follow every thread."}
          </p>
        </header>
      </Reveal>

      {isUsg ? (
        <div data-tour="request-tabs" className="flex gap-2">
          <button
            onClick={() => setTab("tasks")}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm ${tab === "tasks" ? "bg-ink text-canvas" : "border border-line text-ink"}`}
          >
            <IconSubmission className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            Tasks
          </button>
          <button
            onClick={() => setTab("requirements")}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm ${tab === "requirements" ? "bg-ink text-canvas" : "border border-line text-ink"}`}
          >
            <IconLayers className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            Requirements
          </button>
          <button
            onClick={() => setTab("personal")}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm ${tab === "personal" ? "bg-ink text-canvas" : "border border-line text-ink"}`}
          >
            <IconUser className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            Personal requests
          </button>
          <button
            onClick={() => setTab("resolutions")}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm ${tab === "resolutions" ? "bg-ink text-canvas" : "border border-line text-ink"}`}
          >
            <IconVerification className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            Resolutions
          </button>
          {tab === "tasks" && <CreateTaskButton onCreated={loadTasks} />}
        </div>
      ) : (
        <div className="flex justify-end">
          <Button data-tour="request-file-personal" size="sm" onClick={() => setShowPR(true)}>
            <IconPencil className="h-4 w-4" /> File request
          </Button>
        </div>
      )}

      <ActionError message={actionError} />

      {tab === "tasks" && !selectedTask && (
        <div data-tour="request-task-list" className="grid gap-3">
          <div className="text-sm font-medium">Tasks from USG</div>
          {taskState === "loading" && <div className="text-muted">Loading...</div>}
          {taskState === "ready" &&
            tasks.map((t, i) => {
              const d = dueLabel(t as TaskListItem & { daysLeft: number | null; dueDate: string | null; overdue: boolean });
              return (
                <Reveal key={t.id} delay={i * ROW_STAGGER_MS}>
                  <button
                    onClick={() => openTask(t.id)}
                    className="w-full rounded-2xl border border-line bg-paper p-5 text-left transition hover:border-ink/20"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-lg font-medium">{t.title}</div>
                        <div className="text-sm text-muted">
                          {t.doneUnits}/{t.totalUnits} done • {d.text}
                        </div>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${d.late ? "text-[#a5442c]" : "text-muted"}`}>
                        {t.priority}
                      </span>
                    </div>
                  </button>
                </Reveal>
              );
            })}
        </div>
      )}

      {tab === "tasks" && selectedTask && (
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-2xl border border-line bg-paper p-6">
            <div className="mb-4 flex items-center justify-between">
              <button onClick={() => setSelectedTask(null)} className="inline-flex items-center gap-1.5 text-sm text-muted">
                <IconArrowLeft className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                Back
              </button>
              <div className="flex gap-2">
                {isUsg && (
                  <a
                    href={`/api/tasks/${selectedTask}/zip`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs text-ink hover:bg-ink/[0.04]"
                  >
                    <IconArchive className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                    Download ZIP
                  </a>
                )}
                {isUsg && canClose && !closed && <CloseTaskButton taskId={selectedTask} onDone={() => openTask(selectedTask)} />}
              </div>
            </div>
            <h2 className="text-xl font-medium">{(detail as { title?: string } | null)?.title}</h2>
            <p className="mt-2 whitespace-pre-wrap text-body">{(detail as { details?: string } | null)?.details}</p>
            <div className="mt-6">
              <div className="mb-2 text-sm font-medium">Requirements from USG</div>
              <div className="grid gap-2">
                {reqs.map((r) => (
                  <div key={r.id} className="rounded-xl border border-line p-4">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">
                        {r.label} {r.required && <span className="text-[#a5442c]">*</span>}
                      </div>
                      {r.acceptedTypes && r.acceptedTypes.length > 0 && (
                        <span className="text-xs text-muted">{r.acceptedTypes.join(", ")}</span>
                      )}
                    </div>
                    {r.instructions && <p className="mt-1 text-sm text-muted">{r.instructions}</p>}
                    {!isUsg && <AnswerRequirement req={r} taskId={selectedTask} onDone={() => openTask(selectedTask)} />}
                    {isUsg && Array.isArray(r.verdicts) && r.verdicts.length > 0 && (
                      <div className="mt-3 grid gap-2">
                        {(r.verdicts as Array<Record<string, unknown>>).map((a) => (
                          <div key={String(a.unitId)} className="rounded-lg border border-line p-3">
                            <div className="flex items-center justify-between">
                              <div className="text-sm font-medium">{String(a.unitName ?? "")}</div>
                              <span className="text-xs text-muted">{String(a.reviewStatus ?? "")}</span>
                            </div>
                            {typeof a.linkUrl === "string" && a.linkUrl && (
                              <a className="text-sm underline" href={a.linkUrl} target="_blank">
                                {a.linkUrl}
                              </a>
                            )}
                            {typeof a.originalName === "string" && a.originalName && (
                              <div className="text-sm text-muted">{a.originalName}</div>
                            )}
                            {a.reviewStatus !== "approved" && (
                              <div className="mt-2 flex gap-2">
                                <ReviewBtn reqId={r.id} unitId={String(a.unitId)} verdict="approved" onDone={() => openTask(selectedTask)} />
                                <ReviewBtn reqId={r.id} unitId={String(a.unitId)} verdict="flagged" onDone={() => openTask(selectedTask)} />
                                <ReviewBtn reqId={r.id} unitId={String(a.unitId)} verdict="returned" needNote onDone={() => openTask(selectedTask)} />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {!isUsg && r.myAnswer && (
                      <div className="mt-2 rounded-lg border border-line/60 bg-canvas/40 p-2 text-sm text-muted">
                        Your answer: {String((r.myAnswer as Record<string, unknown>).reviewStatus ?? "submitted")}
                        {typeof (r.myAnswer as Record<string, unknown>).originalName === "string" &&
                        (r.myAnswer as Record<string, unknown>).originalName ? (
                          <span> · {(r.myAnswer as Record<string, unknown>).originalName as string}</span>
                        ) : null}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6">
              <div className="mb-2 text-sm font-medium">
                {isUsg ? "Unit responses" : "Your response"}
              </div>
              {isUsg ? (
                <div className="grid gap-2">
                  {responses.length === 0 && (
                    <div className="rounded-xl border border-line/70 p-3 text-sm text-muted">
                      No unit has filed a response yet.
                    </div>
                  )}
                  {responses.map((r) => (
                    <TaskResponsePanel
                      key={`${selectedTask}:${r.unitId}`}
                      isUsg
                      taskId={selectedTask}
                      unitId={r.unitId}
                      response={r}
                      onDone={() => openTask(selectedTask)}
                    />
                  ))}
                </div>
              ) : ((detail as { myUnitIds?: string[] } | null)?.myUnitIds ?? [])[0] ? (
                <TaskResponsePanel
                  key={selectedTask}
                  isUsg={false}
                  taskId={selectedTask}
                  unitId={((detail as { myUnitIds?: string[] } | null)?.myUnitIds ?? [])[0]}
                  response={responses.find((r) => r.mine) ?? null}
                  onDone={() => openTask(selectedTask)}
                />
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-paper p-6">
            <ExtensionsPanel
              taskId={selectedTask}
              isUsg={isUsg}
              ownUnitId={ownUnitId}
              targetUnits={
                ((detail as { assignments?: Array<{ unitId: string; unitName: string }> } | null)
                  ?.assignments ?? [])
                  .map((a) => ({ id: a.unitId, name: a.unitName }))
                  .filter((u, i, all) => all.findIndex((x) => x.id === u.id) === i)
              }
            />
          </div>

          <div className="rounded-2xl border border-line bg-paper p-6">
            <div className="mb-4 text-sm font-medium">Thread</div>
            <div className="max-h-[520px] space-y-2 overflow-auto">
              {msgs
                .filter((m) => !(isUsg ? m.hiddenFromOffice : m.hiddenFromUnit) && !m.unsent)
                .map((m) => (
                  <div key={m.id} className={`rounded-xl border border-line p-3 ${m.authorSide === "usg" ? "bg-ink/[0.02]" : ""}`}>
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span>{m.authorSide === "usg" ? "USG" : "LSG"}</span>
                      <span>{fmtTime(m.createdAt)}</span>
                    </div>
                    <div className="mt-1 whitespace-pre-wrap text-sm">{m.body}</div>
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      <button onClick={() => react(m.id, "👍")} className="text-muted">
                        👍 {m.reactions?.find((x) => x.reaction === "👍")?.count || 0}
                      </button>
                      <button onClick={() => unsend(m.id)} className="text-muted">
                        Unsend
                      </button>
                    </div>
                  </div>
                ))}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                value={msgText}
                onChange={(e) => setMsgText(e.target.value)}
                placeholder="Write a message..."
                className="flex-1 rounded-xl border border-line px-3 py-2 text-sm"
              />
              <Button size="sm" disabled={sending || !msgText.trim()} onClick={sendMsg}>
                Send
              </Button>
            </div>
          </div>
        </div>
      )}

      {tab === "requirements" && (
        <RequirementsPanel
          isUsg={isUsg}
          onOpenTask={(id) => {
            setTab("tasks");
            void openTask(id);
          }}
        />
      )}

      {tab === "personal" && (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-canvas/50 p-4">
            <p className="text-sm text-muted">
              Formal resolutions are filed straight to the USG office from the
              Resolutions tab.
            </p>
            <Button size="sm" onClick={() => setTab("resolutions")}>
              <IconPencil className="h-4 w-4" /> File resolution
            </Button>
          </div>
          {pState === "loading" && <div className="text-muted">Loading...</div>}
          {personal.map((pr) => (
            <div key={pr.id} className="rounded-2xl border border-line bg-paper p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-lg font-medium">{pr.subject}</div>
                  <div className="text-sm text-muted">
                    {pr.unitName} • {pr.status}
                  </div>
                </div>
                {!isUsg && pr.status === "submitted" && <WithdrawPR prId={pr.id} onDone={loadPersonal} />}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-body">{pr.coverLetter}</p>
              {pr.decisionNote && <p className="mt-2 text-sm text-muted">Note: {pr.decisionNote}</p>}
              {isUsg && pr.status === "submitted" && <DecisionSection pr={pr} onDone={loadPersonal} />}
              {!isUsg && (pr.status === "needs_revision" || pr.status === "submission_required") && (
                <ResubmitPR pr={pr} onDone={loadPersonal} />
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "resolutions" && <ResolutionPanel isUsg={isUsg} />}

      {showPR && !isUsg && <PersonalRequestModal onClose={() => setShowPR(false)} onDone={loadPersonal} />}
    </div>
  );
}

function CreateTaskButton({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [autoClose, setAutoClose] = useState(false);
  const [priority, setPriority] = useState("normal");
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [availableUnits, setAvailableUnits] = useState<Array<{ id: string; name: string }>>([]);
  const [dueTimezone, setDueTimezone] = useState("");
  const [reqs, setReqs] = useState<Array<{ label: string; instructions: string; acceptedTypes: string[]; required: boolean }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/units");
        const json = await res.json();
        if (json.ok && Array.isArray(json.units)) {
          const us = json.units
            .map((u: { id?: string; unitId?: string; name?: string; unitName?: string }) => ({
              id: String(u.id ?? u.unitId ?? ""),
              name: String(u.name ?? u.unitName ?? "Unit"),
            }))
            .filter((u: { id: string }) => u.id);
          setAvailableUnits(us);
          setUnitIds(us.map((u: { id: string }) => u.id));
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  const addReq = () =>
    setReqs((r) => [...r, { label: "", instructions: "", acceptedTypes: [], required: true }]);
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await mutate("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          details,
          dueDate: dueDate || null,
          dueTime: dueTime || null,
          dueTimezone: dueTime ? (dueTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone) : null,
          priority,
          autoClose,
          unitIds,
          requirements: reqs.filter((x) => x.label.trim()),
        }),
      });
      setOpen(false);
      onCreated();
      setTitle("");
      setDetails("");
      setReqs([]);
      setUnitIds([]);
    } catch (e) {
      setError(actionMessage(e, "We could not create that task."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button data-tour="request-create-task" size="sm" className="ml-auto" onClick={() => setOpen(true)}>
        <IconPencil className="h-4 w-4" /> Create task
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-line bg-paper p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-lg font-medium">Create task</div>
              <button onClick={() => setOpen(false)}>✕</button>
            </div>
            <div className="grid gap-3">
              <div>
                <div className="mb-1 text-sm text-muted">Title</div>
                <input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} className={selectClass} />
              </div>
              <div>
                <div className="mb-1 text-sm text-muted">Details</div>
                <textarea id="task-details" value={details} onChange={(e) => setDetails(e.target.value)} rows={4} className={selectClass} />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <div className="mb-1 text-sm text-muted">Due date</div>
                  <input id="task-due" type="date" min={todayIso()} value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={selectClass} />
                </div>
                <div>
                  <div className="mb-1 text-sm text-muted">Due time</div>
                  <input id="task-time" type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className={selectClass} />
                </div>
                <div>
                  <div className="mb-1 text-sm text-muted">Priority</div>
                  <select id="task-prio" value={priority} onChange={(e) => setPriority(e.target.value)} className={selectClass}>
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>
              <div>
                <div className="mb-1 text-sm text-muted">Assign to units</div>
                <div className="grid gap-1 sm:grid-cols-2">
                  {availableUnits.map((u) => (
                    <label key={u.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={unitIds.includes(u.id)}
                        onChange={(e) => {
                          setUnitIds((prev) =>
                            e.target.checked ? [...prev, u.id] : prev.filter((x) => x !== u.id),
                          );
                        }}
                      />
                      {u.name}
                    </label>
                  ))}
                  {availableUnits.length === 0 && (
                    <span className="text-xs text-muted">No units loaded; all units will be assigned.</span>
                  )}
                </div>
              </div>
              {dueTime && (
                <div>
                  <div className="mb-1 text-sm text-muted">Timezone</div>
                  <TimezonePicker value={dueTimezone} onChange={setDueTimezone} />
                </div>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={autoClose} onChange={(e) => setAutoClose(e.target.checked)} />
                Auto-close when all requirements done
              </label>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-sm font-medium">Requirements</div>
                  <button onClick={addReq} className="text-sm text-muted">
                    + Add
                  </button>
                </div>
                <div className="grid gap-2">
                  {reqs.map((r, idx) => (
                    <div key={idx} className="rounded-xl border border-line p-3">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <input
                          placeholder="Label"
                          value={r.label}
                          onChange={(e) => {
                            const n = [...reqs];
                            n[idx] = { ...n[idx], label: e.target.value };
                            setReqs(n);
                          }}
                          className="rounded-lg border border-line px-2 py-1 text-sm"
                        />
                        <input
                          placeholder="Accepted types (comma) e.g. pdf,docx"
                          value={r.acceptedTypes.join(",")}
                          onChange={(e) => {
                            const n = [...reqs];
                            n[idx] = { ...n[idx], acceptedTypes: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) };
                            setReqs(n);
                          }}
                          className="rounded-lg border border-line px-2 py-1 text-sm"
                        />
                      </div>
                      <textarea
                        placeholder="Instructions"
                        value={r.instructions}
                        onChange={(e) => {
                          const n = [...reqs];
                          n[idx] = { ...n[idx], instructions: e.target.value };
                          setReqs(n);
                        }}
                        className="mt-2 w-full rounded-lg border border-line px-2 py-1 text-sm"
                      />
                    </div>
                  ))}
                </div>
              </div>
              <ActionError message={error} />
              <Button disabled={saving || !title.trim()} onClick={save}>
                Create
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function AnswerRequirement({ req, taskId, onDone }: { req: ReqItem; taskId: string; onDone: () => void }) {
  const [link, setLink] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      let storagePath: string | undefined;
      let originalName: string | undefined;
      let mimeType: string | undefined;
      let sizeBytes: number | undefined;
      if (file) {
        const resUp = await uploadFile(file, { target: "task_requirement", taskId, requirementId: req.id, nonce: uuidv4(), version: 1 });
        if (!resUp.ok) throw new Error(resUp.reason);
        storagePath = resUp.storagePath;
        originalName = file.name;
        mimeType = file.type;
        sizeBytes = file.size;
      }
      await mutate("/api/tasks/answers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requirementId: req.id, linkUrl: link, storagePath, originalName, mimeType, sizeBytes }),
      });
      setLink("");
      setFile(null);
      onDone();
    } catch (e) {
      setError(actionMessage(e, "We could not submit that answer."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 grid gap-2">
      <input
        placeholder="Link (optional)"
        value={link}
        onChange={(e) => setLink(e.target.value)}
        className="rounded-lg border border-line px-2 py-1 text-sm"
      />
      <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-sm" />
      <ActionError message={error} />
      <Button size="sm" disabled={saving || (!link && !file)} onClick={submit}>
        Submit answer
      </Button>
    </div>
  );
}

function TaskResponsePanel({
  isUsg,
  taskId,
  unitId,
  response,
  onDone,
}: {
  isUsg: boolean;
  taskId: string;
  unitId: string;
  response: AssignmentResponse | null;
  onDone: () => void;
}) {
  const [note, setNote] = useState(response?.note ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isUsg) {
    return (
      <div className="grid gap-2">
        {response ? (
          <div className="rounded-xl border border-line p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{response.unitName}</span>
              <span className="text-xs text-muted">{response.status}</span>
            </div>
            {response.note && (
              <p className="mt-2 whitespace-pre-wrap text-sm text-body">{response.note}</p>
            )}
            {response.hasResponse && (
              <a
                className="mt-2 inline-block text-sm underline"
                href={`/api/files/task-response/${taskId}/${response.unitId}`}
              >
                {response.responseName || "Download response"}
              </a>
            )}
            {response.respondedAt && (
              <div className="mt-1 text-xs text-muted">Filed {fmtTime(response.respondedAt)}</div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-line/70 p-3 text-sm text-muted">
            No response filed yet.
          </div>
        )}
      </div>
    );
  }

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      let storagePath: string | undefined;
      if (file) {
        const uploaded = await uploadFile(file, {
          target: "task_assignment",
          taskId,
          unitId,
          nonce: uuidv4(),
          version: 1,
        });
        if (!uploaded.ok) throw new Error(uploaded.reason);
        storagePath = uploaded.storagePath;
      }

      await mutate(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "respond",
          taskId,
          unitId,
          note: note.trim(),
          storagePath,
        }),
      });

      setFile(null);
      onDone();
    } catch (e) {
      setError(actionMessage(e, "We could not file that response."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-2">
      {response?.status && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="rounded-full border border-line px-2 py-0.5">{response.status}</span>
          {response.hasResponse && response.responseName ? (
            <span>{response.responseName}</span>
          ) : null}
        </div>
      )}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={4}
        placeholder="Write your response to this task…"
        className="w-full rounded-xl border border-line px-3 py-2 text-sm"
      />
      <input
        type="file"
        onChange={(e) => setFile(e.target.files?.[0] || null)}
        className="text-sm"
      />
      <ActionError message={error} />
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={saving || (!note.trim() && !file)} onClick={submit}>
          {saving ? "Filing…" : response?.respondedAt ? "Replace response" : "Submit your requirement response"}
        </Button>
        <span className="text-xs text-muted">A note or a document is required.</span>
      </div>
    </div>
  );
}

function ReviewBtn({ reqId, unitId, verdict, needNote, onDone }: { reqId: string; unitId: string; verdict: string; needNote?: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const review = async () => {
    setError(null);
    try {
      await mutate("/api/tasks/answers", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requirementId: reqId, unitId, verdict, note }),
      });
      setOpen(false);
      onDone();
    } catch (e) {
      setError(actionMessage(e, "We could not review that answer."));
    }
  };
  if (needNote) {
    return (
      <>
        <button onClick={() => setOpen(true)} className="rounded-full border border-line px-2 py-0.5 text-xs">
          Return
        </button>
        <ActionError message={error} />
        {open && (
          <ConfirmDialog
            open
            title="Return with reason"
            description={
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full rounded-lg border border-line px-2 py-1 text-sm"
                placeholder="Reason required"
              />
            }
            confirmLabel="Return"
            onConfirm={review}
            onCancel={() => setOpen(false)}
          />
        )}
      </>
    );
  }
  return (
    <>
      <button onClick={review} className="rounded-full border border-line px-2 py-0.5 text-xs">
        {verdict === "approved" ? "Approve" : "Flag"}
      </button>
      <ActionError message={error} />
    </>
  );
}

function CloseTaskButton({ taskId, onDone }: { taskId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const close = async () => {
    setError(null);
    try {
      await mutate(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "close", taskId, note }),
      });
      setOpen(false);
      onDone();
    } catch (e) {
      setError(actionMessage(e, "We could not close that task."));
    }
  };
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Close task
      </Button>
      <ActionError message={error} />
      {open && (
        <ConfirmDialog
          open
          title="Close task"
          description={
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-lg border border-line px-2 py-1 text-sm"
              placeholder="Closing note (optional)"
            />
          }
          confirmLabel="Close"
          onConfirm={close}
          onCancel={() => setOpen(false)}
        />
      )}
    </>
  );
}

function DecisionSection({ pr, onDone }: { pr: PersonalReq; onDone: () => void }) {
  const [note, setNote] = useState(pr.decisionNote ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decisions = [
    { decision: "granted", label: "Approve" },
    { decision: "declined", label: "Decline" },
    { decision: "needs_revision", label: "Need revision" },
    { decision: "submission_required", label: "Require submission" },
  ] as const;

  const decide = async (decision: (typeof decisions)[number]["decision"]) => {
    const trimmed = note.trim();
    if (decision !== "granted" && trimmed.length < 2) {
      setError("Write a decision note before choosing that action.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await mutate("/api/requests", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: pr.id, decision, note: trimmed }),
      });
      onDone();
    } catch (e) {
      setError(actionMessage(e, "We could not update that request."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-line bg-canvas/40 p-4">
      <div className="mb-2 text-sm font-medium">Decision</div>
      <textarea
        aria-label="Decision note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        placeholder="Decision note (optional to approve, required otherwise)"
        className="w-full rounded-xl border border-line px-3 py-2 text-sm"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        {decisions.map((option) => (
          <button
            key={option.decision}
            onClick={() => void decide(option.decision)}
            disabled={busy || (option.decision !== "granted" && note.trim().length < 2)}
            className="rounded-full border border-line px-3 py-1 text-xs disabled:opacity-50"
          >
            {option.label}
          </button>
        ))}
      </div>
      <ActionError message={error} />
    </div>
  );
}

function ResubmitPR({ pr, onDone }: { pr: PersonalReq; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      await mutate("/api/requests", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "resubmit", requestId: pr.id, note: note.trim() }),
      });
      onDone();
    } catch (e) {
      setError(actionMessage(e, "We could not resubmit that request."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-4 rounded-xl border border-line bg-canvas/40 p-4">
      <div className="mb-2 text-sm font-medium">Respond to USG</div>
      <textarea
        aria-label="Resubmit note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        placeholder="What did you change or submit?"
        className="w-full rounded-xl border border-line px-3 py-2 text-sm"
      />
      <div className="mt-2 flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => void resubmit()}>
          Resubmit
        </Button>
      </div>
      <ActionError message={error} />
    </div>
  );
}

function WithdrawPR({ prId, onDone }: { prId: string; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const withdraw = async () => {
    setError(null);
    try {
      await mutate("/api/requests", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: prId, decision: "withdrawn" }),
      });
      onDone();
    } catch (e) {
      setError(actionMessage(e, "We could not withdraw that request."));
    }
  };
  return (
    <>
      <button onClick={withdraw} className="rounded-full border border-line px-2 py-0.5 text-xs">
        Withdraw
      </button>
      <ActionError message={error} />
    </>
  );
}

function PersonalRequestModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [subject, setSubject] = useState("");
  const [coverLetter, setCoverLetter] = useState("");
  const [purpose, setPurpose] = useState("");
  const [neededOn, setNeededOn] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  });
  const [neededTime, setNeededTime] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      let storagePath: string | undefined;
      let originalName: string | undefined;
      let mimeType: string | undefined;
      let sizeBytes: number | undefined;
      if (file) {
        const resUp = await uploadFile(file, {
          target: "personal_request",
          nonce: uuidv4(),
          version: 1,
        });
        if (!resUp.ok) throw new Error(resUp.reason);
        storagePath = resUp.storagePath;
        originalName = file.name;
        mimeType = file.type;
        sizeBytes = file.size;
      }
      await mutate("/api/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subject,
          coverLetter,
          purpose,
          neededOn: neededOn || null,
          neededTime: neededTime || null,
          neededTimezone: neededTime ? Intl.DateTimeFormat().resolvedOptions().timeZone : null,
          linkUrl,
          storagePath,
          originalName,
          mimeType,
          sizeBytes,
        }),
      });
      onClose();
      onDone();
    } catch (e) {
      setError(actionMessage(e, "We could not file that request. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-2xl border border-line bg-paper p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-lg font-medium">File personal request</div>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="grid gap-3">
          <div>
            <div className="mb-1 text-sm text-muted">Subject</div>
            <input id="pr-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className={selectClass} />
          </div>
          <div>
            <div className="mb-1 text-sm text-muted">Cover letter</div>
            <textarea id="pr-cover" value={coverLetter} onChange={(e) => setCoverLetter(e.target.value)} rows={4} className={selectClass} />
            <div className="mt-2">
              <DraftWithAiButton
                kind="request_letter"
                label="Draft letter with AI"
                disabled={saving}
                getFields={() => ({
                  subject,
                  purpose,
                  neededOn,
                  neededTime,
                  narrativeNotes: purpose,
                })}
                onUse={setCoverLetter}
              />
            </div>
          </div>
          <div>
            <div className="mb-1 text-sm text-muted">Purpose</div>
            <input id="pr-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} className={selectClass} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-sm text-muted">Needed on</div>
              <input id="pr-needed-on" type="date" value={neededOn} onChange={(e) => setNeededOn(e.target.value)} className={selectClass} />
            </div>
            <div>
              <div className="mb-1 text-sm text-muted">Needed time</div>
              <input id="pr-needed-time" type="time" value={neededTime} onChange={(e) => setNeededTime(e.target.value)} className={selectClass} />
            </div>
          </div>
          <div>
            <div className="mb-1 text-sm text-muted">Link (optional)</div>
            <input id="pr-link" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} className={selectClass} />
          </div>
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-sm" />
          {error ? (
            <p
              role="alert"
              className="rounded-xl border border-[#d9a99c] bg-[#a5442c]/[0.06] px-3.5 py-2.5 text-[0.8125rem] font-medium text-[#a5442c]"
            >
              {error}
            </p>
          ) : null}
          <Button disabled={saving || !subject.trim() || !coverLetter.trim() || !purpose.trim() || !neededOn} onClick={submit}>
            File request
          </Button>
        </div>
      </div>
    </div>
  );
}

function ExtensionsPanel({
  taskId,
  isUsg,
  ownUnitId,
  targetUnits,
}: {
  taskId: string;
  isUsg: boolean;
  ownUnitId?: string | null;
  targetUnits?: Array<{ id: string; name: string }>;
}) {
  const [exts, setExts] = useState<Array<Record<string, unknown>>>([]);
  const [show, setShow] = useState(false);
  const [days, setDays] = useState("3");
  const [reason, setReason] = useState("");
  const [selectedUnitId, setSelectedUnitId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolvedTargetUnitId = isUsg ? selectedUnitId : ownUnitId ?? "";

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/extensions?taskId=${taskId}`);
      const json = await res.json();
      if (json.ok) setExts(json.extensions ?? []);
    } catch {
      // ignore
    }
  }, [taskId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedUnitId(isUsg ? targetUnits?.[0]?.id ?? "" : ownUnitId ?? "");
  }, [isUsg, ownUnitId, targetUnits]);

  const request = async () => {
    if (!resolvedTargetUnitId) {
      setError("Choose a target unit before requesting an extension.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await mutate("/api/tasks/extensions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "request", taskId, unitId: resolvedTargetUnitId, days: Number(days), reason }),
      });
      setShow(false);
      setReason("");
      await load();
    } catch (e) {
      setError(actionMessage(e, "We could not request that extension."));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (id: string, decision: "granted" | "denied") => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await mutate("/api/tasks/extensions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "decide", extensionId: id, decision, note: "" }),
      });
      await load();
    } catch (e) {
      setError(actionMessage(e, "We could not decide that extension."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-2 text-sm font-medium">Extensions</div>
      <ActionError message={error} />
      <div className="mb-2">
        <button onClick={() => setShow((v) => !v)} className="text-sm text-muted underline">
          Request extension
        </button>
        {show && (
          <div className="mt-2 grid gap-2">
            {isUsg ? (
              <label className="grid gap-1 text-xs text-muted">
                Target unit
                <select
                  value={selectedUnitId}
                  onChange={(e) => setSelectedUnitId(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Choose a unit</option>
                  {(targetUnits ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="text-xs text-muted">Own unit: {ownUnitId ?? "Not available"}</p>
            )}
            <input type="number" value={days} onChange={(e) => setDays(e.target.value)} className="rounded-lg border border-line px-2 py-1 text-sm" placeholder="Days" />
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} className="rounded-lg border border-line px-2 py-1 text-sm" placeholder="Reason" />
            <button onClick={() => void request()} disabled={busy || !resolvedTargetUnitId} className="rounded-full border border-line px-3 py-1 text-xs">Submit</button>
            {!resolvedTargetUnitId ? (
              <p className="text-xs text-muted">Choose a target unit before submitting.</p>
            ) : null}
          </div>
        )}
      </div>
      <div className="grid gap-2">
        {exts.map((e) => (
          <div key={String(e.id)} className="rounded-lg border border-line p-2 text-sm">
            <div className="flex items-center justify-between">
              <span>{String(e.unitName ?? "")} | {String(e.requestedDays)} days | {String(e.status)}</span>
              {isUsg && e.status === "pending" && (
                <div className="flex gap-1">
                  <button disabled={busy} onClick={() => void decide(String(e.id), "granted")} className="text-xs text-green-700 disabled:opacity-50">Approve</button>
                  <button disabled={busy} onClick={() => void decide(String(e.id), "denied")} className="text-xs text-[#a5442c] disabled:opacity-50">Deny</button>
                </div>
              )}
            </div>
            <p className="text-xs text-muted">{String(e.reason ?? "")}</p>
          </div>
        ))}
        {exts.length === 0 && <p className="text-xs text-muted">No extensions.</p>}
      </div>
    </div>
  );
}
