"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useDashboard } from "@/components/dashboard/dashboard-context";
import { Reveal } from "@/components/fx/Reveal";
import { Button } from "@/components/ui/Button";
import { ActionError, SectionIcon } from "@/components/dashboard/workspace-shared";
import {
  IconArchive,
  IconArrowLeft,
  IconPencil,
  IconSubmission,
} from "@/components/ui/Icons";
import { CreateTaskStepper } from "@/components/dashboard/CreateTaskStepper";
import {
  RequestFilterBar,
  filterTasksByRequestFilters,
  type RequestFilterState,
} from "@/components/dashboard/request-filters";
import { ResolutionPanel } from "@/components/dashboard/ResolutionPanel";
import { RequirementsPanel } from "@/components/dashboard/RequirementsPanel";
import { ReviewQueuePanel } from "@/components/dashboard/ReviewQueuePanel";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ReviewTimeline } from "@/components/ui/ReviewTimeline";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DraftWithAiButton } from "@/components/ai/DraftWithAiButton";
import { selectClass, ROW_STAGGER_MS } from "@/components/dashboard/workspace-shared";
import { CountdownChip } from "@/components/ui/CountdownChip";
import { dateTimeLocalToIso, isDeadlineOverdue, toDateTimeLocalValue } from "@/lib/deadlines";
import { normalizeStatus, type Status } from "@/lib/status";
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
  dueAt?: string | null;
  assignedAt?: string | null;
  gracePeriodMinutes?: number | null;
  reviewSlaDays?: number | null;
  autoClose?: boolean;
  overdue: boolean;
  daysLeft: number | null;
  myStatus?: string | null;
  priority?: "low" | "normal" | "high";
  assignments: Array<{ unitId: string; unitName: string; status: Status; note: string }>;
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
  submittedAt: string | null;
  late: boolean;
  reviewOpenedAt: string | null;
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
  canUnsend?: boolean;
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
  status: Status;
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

type RequestTab = "tasks" | "review" | "requirements" | "personal" | "resolutions";
type PublicRequestTab = Exclude<RequestTab, "review">;
type TaskStep = 1 | 2 | 3 | 4;

const PUBLIC_TABS: Array<{ key: PublicRequestTab; label: string }> = [
  { key: "tasks", label: "Tasks" },
  { key: "requirements", label: "Requirements" },
  { key: "personal", label: "Personal Requests" },
  { key: "resolutions", label: "Resolutions" },
];

const LSG_TASK_STEPS = [
  "Read instructions",
  "Files & links",
  "Review checklist",
  "Submit for Review",
] as const;

function taskStatusForFilter(task: TaskListItem): string {
  if (task.isClosed) return "closed";
  const status = task.myStatus ? normalizeStatus(task.myStatus) : "";
  if (status === "approved" || status === "rejected") return status;
  if (task.overdue) return "overdue";
  if (status) return status;
  if (task.totalUnits > 0 && task.doneUnits >= task.totalUnits) return "approved";
  return "pending";
}

function filtersFromQuery(query: string): RequestFilterState {
  const params = new URLSearchParams(query);
  const overdue = params.get("overdue");
  return {
    status: params.get("status") || "all",
    campus: params.get("campus") || "",
    unit: params.get("unit") || "",
    dueFrom: params.get("dueFrom") || "",
    dueTo: params.get("dueTo") || "",
    overdue: overdue === "yes" || overdue === "no" ? overdue : "all",
  };
}

function filtersEqual(a: RequestFilterState, b: RequestFilterState): boolean {
  return (
    a.status === b.status &&
    a.campus === b.campus &&
    a.unit === b.unit &&
    a.dueFrom === b.dueFrom &&
    a.dueTo === b.dueTo &&
    a.overdue === b.overdue
  );
}

function RequestTabs({
  active,
  onSelect,
}: {
  active: PublicRequestTab | "review";
  onSelect: (tab: PublicRequestTab) => void;
}) {
  return (
    <nav data-tour="request-tabs" aria-label="Request sections" className="flex flex-wrap gap-2">
      {PUBLIC_TABS.map((item) => (
        <Button
          key={item.key}
          type="button"
          size="sm"
          variant={active === item.key ? "brass" : "ghost"}
          onClick={() => onSelect(item.key)}
        >
          {item.label}
        </Button>
      ))}
    </nav>
  );
}

function TaskStepNav({ step, onStep }: { step: TaskStep; onStep: (step: TaskStep) => void }) {
  return (
    <ol aria-label="Task steps" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {LSG_TASK_STEPS.map((label, index) => {
        const value = (index + 1) as TaskStep;
        const active = value === step;
        return (
          <li key={label}>
            <button
              type="button"
              onClick={() => onStep(value)}
              aria-current={active ? "step" : undefined}
              className={`w-full rounded-xl border px-2 py-2 text-left text-xs leading-tight ${
                active
                  ? "border-brass bg-brass-soft/40 text-brass-deep"
                  : value < step
                    ? "border-line bg-canvas/40 text-ink-soft"
                    : "border-line bg-paper/60 text-muted"
              }`}
            >
              <span className="font-semibold">
                {value}. {label}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function RequestSection({ isUsg }: { isUsg: boolean }) {
  const { role } = useDashboard();
  const ownUnitId = role.unitId;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<RequestTab>(() => {
    const raw = searchParams.get("tab");
    if (raw === "personal" || raw === "resolutions" || raw === "requirements") return raw;
    return raw === "review" && isUsg ? "review" : "tasks";
  });
  useEffect(() => {
    const raw = searchParams.get("tab");
    const next: RequestTab =
      raw === "personal"
        ? "personal"
        : raw === "resolutions"
          ? "resolutions"
          : raw === "requirements"
            ? "requirements"
            : raw === "review" && isUsg
              ? "review"
              : "tasks";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTab(next);
  }, [searchParams, isUsg]);
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [taskState, setTaskState] = useState<"loading" | "ready" | "error">("loading");
  const [filters, setFilters] = useState<RequestFilterState>(() =>
    filtersFromQuery(searchParams.toString()),
  );
  useEffect(() => {
    const nextFilters = filtersFromQuery(searchParams.toString());
    queueMicrotask(() => {
      setFilters((previous) => (filtersEqual(previous, nextFilters) ? previous : nextFilters));
    });
  }, [searchParams]);
  const [taskStep, setTaskStep] = useState<TaskStep>(1);
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
  const [reviewUnits, setReviewUnits] = useState<Array<{ id: string; name: string; parentName?: string; unitType?: string }>>([]);
  const [timelineKey, setTimelineKey] = useState(0);
  const threadRef = useRef<HTMLDivElement | null>(null);

  const [personal, setPersonal] = useState<PersonalReq[]>([]);
  const [pState, setPState] = useState<"loading" | "ready" | "error">("loading");
  const [showPR, setShowPR] = useState(false);
  const myAssignment = responses.find((response) => response.mine) ?? null;
  const missingRequirementLabels = isUsg
    ? []
    : reqs
        .filter((requirement) => {
          if (!requirement.required) return false;
          const answer = requirement.myAnswer as Record<string, unknown> | null | undefined;
          const link = typeof answer?.linkUrl === "string" ? answer.linkUrl.trim() : "";
          const path = typeof answer?.storagePath === "string" ? answer.storagePath.trim() : "";
          return !link && !path;
        })
        .map((requirement) => requirement.label);

  const changeTab = useCallback(
    (next: PublicRequestTab) => {
      setSelectedTask(null);
      setTab(next);
      router.replace(`?tab=${next}`, { scroll: false });
    },
    [router],
  );

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

  useEffect(() => {
    const requestId = searchParams.get("request");
    if (!requestId || tab !== "personal" || pState !== "ready") return;
    queueMicrotask(() => {
      const node = Array.from(document.querySelectorAll("[data-personal-request-id]")).find(
        (element) => element.getAttribute("data-personal-request-id") === requestId,
      );
      node?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [searchParams, tab, pState, personal]);

  useEffect(() => {
    if (!isUsg) return;
    (async () => {
      try {
        const res = await fetch("/api/units");
        const json = (await res.json()) as {
          ok?: boolean;
          units?: Array<{ id?: string; unitId?: string; name?: string; unitName?: string; parentName?: string; unitType?: string }>;
        };
        if (!json.ok || !Array.isArray(json.units)) return;
        setReviewUnits(
          json.units
            .map((unit) => ({
              id: String(unit.id ?? unit.unitId ?? ""),
              name: String(unit.name ?? unit.unitName ?? "Unit"),
              parentName: unit.parentName ? String(unit.parentName) : undefined,
              unitType: unit.unitType ? String(unit.unitType) : undefined,
            }))
            .filter((unit) => unit.id),
        );
      } catch {
        setReviewUnits([]);
      }
    })();
  }, [isUsg]);

  const unitOptions = useMemo(
    () => reviewUnits.map((unit) => ({ id: unit.id, name: unit.name })),
    [reviewUnits],
  );
  const campusOptions = useMemo(
    () =>
      Array.from(
        new Set(
          reviewUnits
            .flatMap((unit) => [unit.parentName, unit.unitType === "campus" ? unit.name : ""])
            .filter((name): name is string => Boolean(name)),
        ),
      ).sort(),
    [reviewUnits],
  );
  const visibleTasks = useMemo(
    () =>
      filterTasksByRequestFilters(tasks, filters, (task) => ({
        status: taskStatusForFilter(task),
        dueDate: task.dueDate ?? task.dueAt ?? null,
        overdue: Boolean(task.overdue),
        isClosed: Boolean(task.isClosed),
        assignmentUnitIds: task.assignments.map((assignment) => assignment.unitId),
        assignmentUnitNames: task.assignments.map((assignment) => assignment.unitName),
      })),
    [tasks, filters],
  );

  const openTask = useCallback(async (id: string) => {
    setSelectedTask(id);
    setTaskStep(1);
    const d = await fetch(`/api/tasks/${id}?taskId=${id}`).then((r) => r.json());
    if (d.ok) {
      setDetail(d.task);
      setReqs(d.requirements || []);
      setResponses((d.responses as AssignmentResponse[] | undefined) ?? []);
      setCanClose(d.canClose);
      setClosed(Boolean(d.task?.closed));
      setTimelineKey((value) => value + 1);
    }
  }, []);

  useEffect(() => {
    const taskId = searchParams.get("task");
    if (!taskId || taskState !== "ready" || selectedTask === taskId) return;
    queueMicrotask(() => {
      void openTask(taskId);
    });
  }, [searchParams, taskState, selectedTask, openTask]);

  useEffect(() => {
    if (searchParams.get("thread") !== "1" || !selectedTask || msgs.length === 0) return;
    queueMicrotask(() => {
      threadRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [searchParams, selectedTask, msgs.length]);

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
    const target = msgs.find((m) => m.id === mid);
    if (target && target.canUnsend === false) {
      setActionError("Only the person who sent this message can unsend it.");
      return;
    }
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
  }, [selectedTask, openTask, msgs]);

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
              <h1 className="text-[clamp(2rem,4vw,3.4rem)] leading-[1.02]">Requests</h1>
            </div>
          </div>
          <p className="max-w-2xl text-[0.98rem] leading-relaxed text-body">
            {isUsg
              ? "Push tasks down to units, review LSG requirements, follow threads, and decide submissions."
              : "Respond to requirements from the office, send yours upward, and follow every thread."}
          </p>
        </header>
      </Reveal>

      <RequestTabs active={tab} onSelect={changeTab} />

      <div className="flex flex-wrap items-center justify-end gap-2">
        {isUsg ? (
          <Button
            type="button"
            variant={tab === "review" ? "brass" : "outline"}
            size="sm"
            onClick={() => {
              setSelectedTask(null);
              setTab(tab === "review" ? "tasks" : "review");
            }}
          >
            Review queue
          </Button>
        ) : null}
        {isUsg && tab === "tasks" ? <CreateTaskStepper onCreated={loadTasks} /> : null}
        {!isUsg ? (
          <Button data-tour="request-file-personal" size="sm" onClick={() => setShowPR(true)}>
            <IconPencil className="h-4 w-4" /> File request
          </Button>
        ) : null}
      </div>

      <ActionError message={actionError} />

      {tab === "review" && isUsg ? (
        <ReviewQueuePanel units={reviewUnits} onChanged={loadTasks} />
      ) : null}

      {tab === "tasks" && !selectedTask && (
        <div data-tour="request-task-list" className="grid gap-3">
          <RequestFilterBar
            value={filters}
            onChange={setFilters}
            isUsg={isUsg}
            campuses={campusOptions}
            units={unitOptions}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">Tasks from USG · {visibleTasks.length} shown</div>
            {!isUsg && visibleTasks.some((t) => t.overdue || (!t.isClosed && isDeadlineOverdue(t.dueAt, t.myStatus))) ? (
              <div
                role="alert"
                className="rounded-full border border-[#a5442c] bg-[#a5442c]/[0.12] px-3 py-1 text-xs font-semibold text-[#a5442c]"
              >
                You have overdue tasks. Submit them or ask USG for an extension.
              </div>
            ) : null}
          </div>
          {taskState === "loading" && <div className="text-muted">Loading...</div>}
          {taskState === "ready" &&
            visibleTasks.map((t, i) => (
              <Reveal key={t.id} delay={i * ROW_STAGGER_MS}>
                <button
                  onClick={() => openTask(t.id)}
                  className="w-full rounded-2xl border border-line bg-paper p-5 text-left transition hover:border-ink/20"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-lg font-medium">{t.title}</div>
                      <div className="mt-1 text-sm text-muted">
                        {t.doneUnits}/{t.totalUnits} done
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <CountdownChip
                        dueAt={t.dueAt}
                        gracePeriodMinutes={t.gracePeriodMinutes}
                        autoClose={t.autoClose}
                        closed={t.isClosed}
                      />
                      <span className="text-xs text-muted">{t.priority ?? "normal"}</span>
                    </div>
                  </div>
                </button>
              </Reveal>
            ))}
          {taskState === "ready" && visibleTasks.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">
              No tasks match these filters.
            </p>
          ) : null}
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
              <div className="flex flex-wrap items-center gap-2">
                <CountdownChip
                  dueAt={(detail as { dueAt?: string | null } | null)?.dueAt}
                  gracePeriodMinutes={(detail as { gracePeriodMinutes?: number | null } | null)?.gracePeriodMinutes}
                  autoClose={(detail as { autoClose?: boolean } | null)?.autoClose}
                  closed={closed}
                />
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
                {isUsg && closed && (
                  <ReopenTaskButton
                    taskId={selectedTask}
                    dueAt={(detail as { dueAt?: string | null } | null)?.dueAt}
                    onDone={() => openTask(selectedTask)}
                  />
                )}
              </div>
            </div>
            <h2 className="text-xl font-medium">{(detail as { title?: string } | null)?.title}</h2>
            {!isUsg ? (
              <div className="mt-5">
                <TaskStepNav step={taskStep} onStep={setTaskStep} />
              </div>
            ) : null}
            {isUsg || taskStep === 1 ? (
              <>
                <p className="mt-2 whitespace-pre-wrap text-body">{(detail as { details?: string } | null)?.details}</p>
                {!isUsg && !closed && isDeadlineOverdue(
                  (detail as { dueAt?: string | null } | null)?.dueAt,
                  myAssignment?.status,
                ) ? (
                  <div
                    role="alert"
                    className="mt-4 rounded-xl border border-[#a5442c] bg-[#a5442c]/[0.12] px-3.5 py-2.5 text-sm font-medium text-[#a5442c]"
                  >
                    This task is overdue. Submit your answer or request an extension from USG.
                  </div>
                ) : null}
              </>
            ) : null}
            {isUsg || taskStep === 2 ? (
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
                      {!isUsg && (
                        <AnswerRequirement
                          req={r}
                          taskId={selectedTask}
                          locked={closed || myAssignment?.status === "under_review" || myAssignment?.status === "approved"}
                          onDone={() => openTask(selectedTask)}
                        />
                      )}
                      {isUsg && Array.isArray(r.verdicts) && r.verdicts.length > 0 && (
                        <div className="mt-3 grid gap-2">
                          {(r.verdicts as Array<Record<string, unknown>>).map((a) => (
                            <div key={String(a.unitId)} className="rounded-lg border border-line p-3">
                              <div className="flex items-center justify-between">
                                <div className="text-sm font-medium">{String(a.unitName ?? "")}</div>
                                <StatusBadge
                                  status={normalizeStatus(String(a.reviewStatus ?? "pending"))}
                                />
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
                                  <ReviewBtn reqId={r.id} unitId={String(a.unitId)} verdict="rejected" needNote onDone={() => openTask(selectedTask)} />
                                  <ReviewBtn reqId={r.id} unitId={String(a.unitId)} verdict="returned" needNote onDone={() => openTask(selectedTask)} />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {!isUsg && r.myAnswer && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-line/60 bg-canvas/40 p-2 text-sm text-muted">
                          <span>Your answer:</span>
                          <StatusBadge
                            status={normalizeStatus(String((r.myAnswer as Record<string, unknown>).reviewStatus ?? "pending"))}
                          />
                          {typeof (r.myAnswer as Record<string, unknown>).originalName === "string" &&
                          (r.myAnswer as Record<string, unknown>).originalName ? (
                            <span>{(r.myAnswer as Record<string, unknown>).originalName as string}</span>
                          ) : null}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {isUsg ? (
              <div className="mt-6">
                <div className="mb-2 text-sm font-medium">Unit responses</div>
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
                      missingRequirements={[]}
                      closed={closed}
                      onDone={() => openTask(selectedTask)}
                    />
                  ))}
                </div>
              </div>
            ) : ((detail as { myUnitIds?: string[] } | null)?.myUnitIds ?? [])[0] ? (
              <>
                {taskStep === 2 || taskStep === 4 ? (
                  <div className="mt-6">
                    <div className="mb-2 text-sm font-medium">
                      {taskStep === 2 ? "Files & links" : "Submit for review"}
                    </div>
                    <TaskResponsePanel
                      key={selectedTask}
                      isUsg={false}
                      taskId={selectedTask}
                      unitId={((detail as { myUnitIds?: string[] } | null)?.myUnitIds ?? [])[0]}
                      response={responses.find((r) => r.mine) ?? null}
                      missingRequirements={missingRequirementLabels}
                      closed={closed}
                      hideSubmit={taskStep === 2}
                      onDone={() => openTask(selectedTask)}
                    />
                  </div>
                ) : null}
                {taskStep === 3 ? (
                  <div className="mt-6 grid gap-2">
                    <div className="text-sm font-medium">Review checklist</div>
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-3 text-sm">
                      <span>Response status:</span>
                      <StatusBadge
                        status={normalizeStatus(String(responses.find((r) => r.mine)?.status ?? "pending"))}
                      />
                    </div>
                    <div className="rounded-xl border border-line p-3 text-sm">
                      {missingRequirementLabels.length === 0
                        ? "All required answers are attached."
                        : `Still needed: ${missingRequirementLabels.join(", ")}.`}
                    </div>
                    <div className="rounded-xl border border-line p-3 text-sm text-muted">
                      Check the thread alongside this task before submitting.
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}

            {!isUsg ? (
              <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
                <Button
                  size="sm"
                  variant="paper"
                  disabled={taskStep === 1}
                  onClick={() => setTaskStep((step) => Math.max(1, step - 1) as TaskStep)}
                >
                  Back
                </Button>
                <div className="text-xs text-muted">Step {taskStep} of 4</div>
                {taskStep < 4 ? (
                  <Button
                    size="sm"
                    onClick={() => setTaskStep((step) => Math.min(4, step + 1) as TaskStep)}
                  >
                    {taskStep === 3 ? "Continue to submission" : "Next"}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-line bg-paper p-6">
            <ExtensionsPanel
              key={selectedTask}
              taskId={selectedTask}
              isUsg={isUsg}
              ownUnitId={ownUnitId}
              dueAt={(detail as { dueAt?: string | null } | null)?.dueAt}
            />
          </div>

          {!isUsg && myAssignment ? (
            <div className="rounded-2xl border border-line bg-paper p-6">
              <ReviewTimeline
                taskId={selectedTask}
                unitId={myAssignment.unitId}
                refreshKey={timelineKey}
              />
            </div>
          ) : null}

          <div ref={threadRef} className="rounded-2xl border border-line bg-paper p-6">
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
                      {m.canUnsend ? (
                        <button onClick={() => unsend(m.id)} className="text-muted">
                          Unsend
                        </button>
                      ) : null}
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
            router.replace("?tab=tasks", { scroll: false });
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
            <Button size="sm" onClick={() => changeTab("resolutions")}>
              <IconPencil className="h-4 w-4" /> File resolution
            </Button>
          </div>
          {pState === "loading" && <div className="text-muted">Loading...</div>}
          {personal.map((pr) => (
            <div key={pr.id} data-personal-request-id={pr.id} className="rounded-2xl border border-line bg-paper p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-lg font-medium">{pr.subject}</div>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                    <span>{pr.unitName}</span>
                    <StatusBadge status={pr.status} />
                  </div>
                </div>
                {!isUsg && pr.status === "pending" && <WithdrawPR prId={pr.id} onDone={loadPersonal} />}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-body">{pr.coverLetter}</p>
              {pr.decisionNote && <p className="mt-2 text-sm text-muted">Note: {pr.decisionNote}</p>}
              {isUsg && pr.status === "pending" && <DecisionSection pr={pr} onDone={loadPersonal} />}
              {!isUsg && pr.status === "returned" && (
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

function AnswerRequirement({
  req,
  taskId,
  locked,
  onDone,
}: {
  req: ReqItem;
  taskId: string;
  locked: boolean;
  onDone: () => void;
}) {
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

  if (locked) {
    return (
      <div className="mt-3 rounded-lg border border-line/60 bg-canvas/40 p-2 text-sm text-muted">
        This answer is locked while the task is under review or approved.
      </div>
    );
  }

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
        Save answer
      </Button>
    </div>
  );
}

function TaskResponsePanel({
  isUsg,
  taskId,
  unitId,
  response,
  missingRequirements,
  closed,
  hideSubmit = false,
  onDone,
}: {
  isUsg: boolean;
  taskId: string;
  unitId: string;
  response: AssignmentResponse | null;
  missingRequirements: string[];
  closed?: boolean;
  hideSubmit?: boolean;
  onDone: () => void;
}) {
  const [note, setNote] = useState(response?.note ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const status = response ? normalizeStatus(response.status) : "pending";
  const locked = closed === true || status === "under_review" || status === "approved";

  if (isUsg) {
    return (
      <div className="grid gap-2">
        {response ? (
          <div className="rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium">{response.unitName}</span>
              <StatusBadge status={status} late={response.late} />
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
            {response.submittedAt ? (
              <div className="mt-1 text-xs text-muted">Submitted {fmtTime(response.submittedAt)}</div>
            ) : response.respondedAt ? (
              <div className="mt-1 text-xs text-muted">Draft saved {fmtTime(response.respondedAt)}</div>
            ) : null}
            {response.reviewOpenedAt ? (
              <div className="mt-1 text-xs text-muted">Review opened {fmtTime(response.reviewOpenedAt)}</div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-xl border border-line/70 p-3 text-sm text-muted">
            No response filed yet.
          </div>
        )}
      </div>
    );
  }

  const saveDraft = async () => {
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
      setError(actionMessage(e, "We could not save that draft."));
    } finally {
      setSaving(false);
    }
  };

  const submitForReview = async () => {
    setSaving(true);
    setError(null);
    try {
      await mutate(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "submit", taskId, unitId }),
      });
      setConfirmSubmit(false);
      onDone();
    } catch (e) {
      setError(actionMessage(e, "We could not submit that task for review."));
    } finally {
      setSaving(false);
    }
  };

  const withdraw = async () => {
    setSaving(true);
    setError(null);
    try {
      await mutate(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "withdraw", taskId, unitId }),
      });
      onDone();
    } catch (e) {
      setError(actionMessage(e, "We could not withdraw that submission."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <StatusBadge status={status} late={response?.late} />
        {response?.hasResponse && response.responseName ? (
          <span>{response.responseName}</span>
        ) : null}
        {response?.submittedAt ? <span>Submitted {fmtTime(response.submittedAt)}</span> : null}
      </div>

      {locked ? (
        <div className="rounded-xl border border-line/70 bg-canvas/40 p-3 text-sm text-muted">
          {closed
            ? "This task is closed, so it no longer takes answers or messages."
            : status === "approved"
              ? "USG has approved this assignment."
              : response?.reviewOpenedAt
                ? "USG has opened this submission, so it can no longer be withdrawn or edited."
                : "This submission is waiting for USG. You can still withdraw it until USG opens it."}
        </div>
      ) : (
        <>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            placeholder="Write your response to this task..."
            className="w-full rounded-xl border border-line px-3 py-2 text-sm"
          />
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="text-sm"
          />
        </>
      )}

      {status === "returned" ? (
        <div
          role="alert"
          className="rounded-xl border border-[#d8c18f] bg-[#d8c18f]/10 p-3 text-sm text-[#7d6428]"
        >
          USG returned this item for revision. Edit your answer, then use Save draft and
          Submit for review to send it back.
        </div>
      ) : null}

      <ActionError message={error} />

      {missingRequirements.length > 0 && !locked ? (
        <div className="rounded-xl border border-[#d8c18f] bg-[#d8c18f]/10 p-3 text-sm text-[#7d6428]">
          Answer every required item before submitting: {missingRequirements.join(", ")}.
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {!locked ? (
          <>
            <Button
              size="sm"
              variant="paper"
              disabled={saving || (!note.trim() && !file)}
              onClick={() => void saveDraft()}
            >
              {saving ? "Saving..." : "Save draft"}
            </Button>
            {!hideSubmit ? (
              <Button
                size="sm"
                disabled={saving || missingRequirements.length > 0}
                onClick={() => setConfirmSubmit(true)}
              >
                Submit for review
              </Button>
            ) : null}
          </>
        ) : null}
        {status === "under_review" && !response?.reviewOpenedAt ? (
          <Button size="sm" variant="paper" disabled={saving} onClick={() => void withdraw()}>
            Withdraw
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmSubmit}
        title="Submit for review"
        description="You are about to send this to USG. You can't edit while it is under review."
        confirmLabel="Submit for review"
        busy={saving}
        onConfirm={() => void submitForReview()}
        onCancel={() => setConfirmSubmit(false)}
      />
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
    const label = verdict === "rejected" ? "Reject" : "Return";
    return (
      <>
        <button onClick={() => setOpen(true)} className="rounded-full border border-line px-2 py-0.5 text-xs">
          {label}
        </button>
        <ActionError message={error} />
        {open && (
          <ConfirmDialog
            open
            title={`${label} with reason`}
            description={
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full rounded-lg border border-line px-2 py-1 text-sm"
                placeholder="Reason required"
              />
            }
            confirmLabel={label}
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
        {verdict === "approved" ? "Approve" : "Reject"}
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

function ReopenTaskButton({
  taskId,
  dueAt,
  onDone,
}: {
  taskId: string;
  dueAt?: string | null;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [newDueAt, setNewDueAt] = useState(() => toDateTimeLocalValue(dueAt));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reopen = async () => {
    const due = dateTimeLocalToIso(newDueAt);
    if (!due) {
      setError("Choose a valid new due date and time.");
      return;
    }
    if (note.trim().length < 2) {
      setError("Write a short reason before reopening this task.");
      return;
    }
    setError(null);
    try {
      await mutate(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reopen", taskId, newDueAt: due, note }),
      });
      setOpen(false);
      onDone();
    } catch (e) {
      setError(actionMessage(e, "We could not reopen that task."));
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Reopen task
      </Button>
      <ActionError message={error} />
      {open && (
        <ConfirmDialog
          open
          title="Reopen task"
          description={
            <div className="grid gap-2">
              <label className="grid gap-1 text-xs text-muted">
                New due date and time
                <input
                  type="datetime-local"
                  value={newDueAt}
                  onChange={(event) => setNewDueAt(event.target.value)}
                  className="w-full rounded-lg border border-line px-2 py-1 text-sm"
                />
              </label>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className="w-full rounded-lg border border-line px-2 py-1 text-sm"
                placeholder="Reason for reopening"
              />
            </div>
          }
          confirmLabel="Reopen"
          onConfirm={() => void reopen()}
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
    { decision: "approved", label: "Approve" },
    { decision: "rejected", label: "Reject" },
    { decision: "returned", label: "Return for revision" },
  ] as const;

  const decide = async (decision: (typeof decisions)[number]["decision"]) => {
    const trimmed = note.trim();
    if (decision !== "approved" && trimmed.length < 2) {
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
            disabled={busy || (option.decision !== "approved" && note.trim().length < 2)}
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
          <button onClick={onClose}>×</button>
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
  dueAt,
}: {
  taskId: string;
  isUsg: boolean;
  ownUnitId?: string | null;
  dueAt?: string | null;
}) {
  const [exts, setExts] = useState<Array<Record<string, unknown>>>([]);
  const [show, setShow] = useState(false);
  const [requestedDueAt, setRequestedDueAt] = useState(() => toDateTimeLocalValue(dueAt));
  const [reason, setReason] = useState("");
  const [decisionNote, setDecisionNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/extensions?taskId=${taskId}`);
      const json = await res.json();
      if (json.ok) setExts(json.extensions ?? []);
    } catch {
      setError("We could not load extensions.");
    }
  }, [taskId]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  const request = async () => {
    const requested = dateTimeLocalToIso(requestedDueAt);
    if (!ownUnitId) {
      setError("Your unit is not available yet. Reopen this task and try again.");
      return;
    }
    if (!requested) {
      setError("Choose a new due date and time.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await mutate("/api/tasks/extensions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "request",
          taskId,
          unitId: ownUnitId,
          requestedDueAt: requested,
          reason,
        }),
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

  const decide = async (id: string, decision: "approved" | "rejected") => {
    if (busy) return;
    const note = decisionNote[id] ?? "";
    if (decision === "rejected" && note.trim().length < 2) {
      setError("Write a remark before declining this extension.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await mutate("/api/tasks/extensions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "decide", extensionId: id, decision, note }),
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
      {!isUsg ? (
        <div className="mb-3">
          <button onClick={() => setShow((value) => !value)} className="text-sm text-muted underline">
            Request extension
          </button>
          {show ? (
            <div className="mt-2 grid gap-2">
              <label className="grid gap-1 text-xs text-muted">
                Proposed due date and time
                <input
                  type="datetime-local"
                  value={requestedDueAt}
                  onChange={(event) => setRequestedDueAt(event.target.value)}
                  className={selectClass}
                />
              </label>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="rounded-lg border border-line px-2 py-1 text-sm"
                placeholder="Reason"
              />
              <Button size="sm" disabled={busy || !requestedDueAt || reason.trim().length < 3} onClick={() => void request()}>
                Submit request
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="grid gap-2">
        {exts.map((extension) => {
          const id = String(extension.id ?? "");
          const pending = extension.status === "pending";
          return (
            <div key={id} className="rounded-lg border border-line p-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {String(extension.unitName ?? "")} | Proposed: {fmtTime(String(extension.requestedDueAt ?? ""))} | {String(extension.status ?? "pending")}
                </span>
                {isUsg && pending ? (
                  <div className="flex flex-wrap items-center gap-1">
                    <input
                      value={decisionNote[id] ?? ""}
                      onChange={(event) => setDecisionNote((notes) => ({ ...notes, [id]: event.target.value }))}
                      className="rounded-lg border border-line px-2 py-1 text-xs"
                      placeholder="Remark (required to decline)"
                    />
                    <Button size="sm" variant="paper" disabled={busy} onClick={() => void decide(id, "approved")}>
                      Approve
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy || (decisionNote[id] ?? "").trim().length < 2} onClick={() => void decide(id, "rejected")}>
                      Decline
                    </Button>
                  </div>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-muted">{String(extension.reason ?? "")}</p>
              {extension.decisionNote ? (
                <p className="mt-1 text-xs text-muted">Remark: {String(extension.decisionNote)}</p>
              ) : null}
            </div>
          );
        })}
        {exts.length === 0 && <p className="text-xs text-muted">No extensions.</p>}
      </div>
    </div>
  );
}
