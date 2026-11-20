"use client";

import { useCallback, useEffect, useState } from "react";
import { ActionError } from "@/components/dashboard/workspace-shared";
import { RequirementPrecheckPanel } from "@/components/dashboard/RequirementPrecheckPanel";
import { DraftWithAiButton } from "@/components/ai/DraftWithAiButton";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/fx/Reveal";
import {
  IconArrowLeft,
  IconPencil,
  IconSubmission,
  IconVerification,
} from "@/components/ui/Icons";
import { dueLabel } from "@/lib/tasks";
import { uploadFile } from "@/lib/upload-client";

type TaskRequirementSummary = {
  id: string;
  title: string;
  details: string;
  dueDate: string | null;
  dueTime?: string | null;
  priority: "low" | "normal" | "high";
  overdue: boolean;
  daysLeft: number | null;
  assignments: Array<{ unitId: string; unitName: string; status: "assigned" | "in_progress" | "done"; note: string }>;
  doneUnits: number;
  totalUnits: number;
  isClosed?: boolean;
};

type ProposalSummary = {
  id: string;
  title: string;
  status: string;
  authorKind: string;
  activityType: string;
  eventDate: string | null;
  createdAt: string;
  programName: string | null;
  unitName: string | null;
  version: number;
  latestDecision: string | null;
  latestRemark: string | null;
};

type ProposalRequirement = {
  id: string;
  label: string;
  detail: string | null;
  status: "requested" | "submitted" | "accepted" | "waived";
  linkUrl: string | null;
  originalName: string | null;
  respondedNote: string | null;
  respondedBy: string | null;
  respondedAt: string | null;
  versionNumber: number | null;
};

type ProposalVersion = {
  id: string;
  versionNumber: number;
  submittedBy: string | null;
  submissionNote: string | null;
  submittedAt: string;
};

type ProposalReview = {
  versionNumber: number;
  decision: string;
  remark: string | null;
  decidedBy: string | null;
  createdAt: string;
};

type ProposalDetail = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  authorKind: string;
  activityType: string;
  eventDate: string | null;
  venue: string | null;
  programId: string | null;
  programName: string | null;
  unitId: string | null;
  unitName: string | null;
  createdAt: string;
  versions: ProposalVersion[];
  reviews: ProposalReview[];
  requirements: ProposalRequirement[];
};

type ProgramItem = {
  id: string;
  label: string;
  itemKind: "file" | "link";
  allowedExtensions: string[] | null;
  position: number;
};

type Program = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  items: ProgramItem[];
};

type UnitOption = {
  id: string;
  name: string;
};

type TemplateDraft = {
  file: File | null;
  link: string;
};

type DraftMap = Record<string, TemplateDraft>;

const ACTIVITY_TYPES = [
  ["sports", "Sports"],
  ["culture", "Culture"],
  ["academic", "Academic"],
  ["community", "Community"],
  ["wellness", "Wellness"],
  ["special", "Special"],
] as const;

const PROPOSAL_STATUS: Record<string, string> = {
  submitted: "Waiting for USG",
  under_review: "Under review",
  returned: "Returned for revision",
  requirements_requested: "Requirements requested",
  approved: "Approved",
  rejected: "Rejected",
  published: "Published",
};

const REQUIREMENT_STATUS: Record<string, string> = {
  requested: "Needed",
  submitted: "Submitted",
  accepted: "Accepted",
  waived: "Waived",
};

function statusLabel(status: string): string {
  return PROPOSAL_STATUS[status] ?? status.replaceAll("_", " ");
}

function statusClass(status: string): string {
  if (status === "approved" || status === "published") return "border-[#8bb39a] bg-[#8bb39a]/10 text-[#3d6b4d]";
  if (status === "rejected") return "border-[#d9a99c] bg-[#a5442c]/[0.06] text-[#a5442c]";
  if (status === "returned") return "border-[#d8c18f] bg-[#d8c18f]/10 text-[#7d6428]";
  if (status === "requirements_requested") return "border-[#a9bdd6] bg-[#a9bdd6]/10 text-[#3d5673]";
  return "border-line bg-canvas/60 text-muted";
}

function requirementClass(status: string): string {
  if (status === "accepted") return "border-[#8bb39a] bg-[#8bb39a]/10 text-[#3d6b4d]";
  if (status === "waived") return "border-line bg-canvas/60 text-muted";
  if (status === "submitted") return "border-[#a9bdd6] bg-[#a9bdd6]/10 text-[#3d5673]";
  return "border-[#d8c18f] bg-[#d8c18f]/10 text-[#7d6428]";
}

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
    const detail =
      typeof json.message === "string" && json.message.trim()
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

function fmtDate(value: string | null): string {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function fmtDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function draftsFor(items: ProgramItem[]): DraftMap {
  const next: DraftMap = {};
  for (const item of items) next[item.id] = { file: null, link: "" };
  return next;
}

function programItems(programs: Program[], programId: string, defaults: ProgramItem[]): ProgramItem[] {
  if (!programId) return defaults;
  return programs.find((program) => program.id === programId)?.items ?? [];
}

function toPrograms(value: unknown): Program[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const row = raw as Record<string, unknown>;
    const items = Array.isArray(row.items) ? row.items : [];
    return {
      id: String(row.id ?? ""),
      name: String(row.name ?? "Program"),
      description: typeof row.description === "string" ? row.description : null,
      status: String(row.status ?? ""),
      items: items.map((itemRaw) => {
        const item = itemRaw as Record<string, unknown>;
        return {
          id: String(item.id ?? ""),
          label: String(item.label ?? "Requirement"),
          itemKind: item.itemKind === "link" ? "link" : "file",
          allowedExtensions: Array.isArray(item.allowedExtensions)
            ? item.allowedExtensions.map(String)
            : null,
          position: Number(item.position ?? 0),
        };
      }),
    };
  });
}

function toDefaultItems(value: unknown): ProgramItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const item = raw as Record<string, unknown>;
    return {
      id: String(item.id ?? ""),
      label: String(item.label ?? "Requirement"),
      itemKind: item.itemKind === "link" ? "link" : "file",
      allowedExtensions: Array.isArray(item.allowedExtensions)
        ? item.allowedExtensions.map(String)
        : null,
      position: Number(item.position ?? 0),
    };
  });
}

function toTaskSummaries(value: unknown): TaskRequirementSummary[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const row = raw as Record<string, unknown>;
    const assignments = Array.isArray(row.assignments) ? row.assignments : [];
    return {
      id: String(row.id ?? ""),
      title: String(row.title ?? "Task"),
      details: String(row.details ?? ""),
      dueDate: typeof row.dueDate === "string" ? row.dueDate : null,
      dueTime: typeof row.dueTime === "string" ? row.dueTime : null,
      priority: row.priority === "high" || row.priority === "low" ? row.priority : "normal",
      overdue: row.overdue === true,
      daysLeft: typeof row.daysLeft === "number" ? row.daysLeft : null,
      assignments: assignments.map((rawAssignment) => {
        const assignment = rawAssignment as Record<string, unknown>;
        const status = String(assignment.status ?? "assigned");
        return {
          unitId: String(assignment.unitId ?? ""),
          unitName: String(assignment.unitName ?? "Unit"),
          status:
            status === "in_progress" || status === "done"
              ? status
              : "assigned",
          note: String(assignment.note ?? ""),
        };
      }),
      doneUnits: Number(row.doneUnits ?? 0),
      totalUnits: Number(row.totalUnits ?? 0),
      isClosed: row.isClosed === true,
    };
  });
}

function toProposalSummaries(value: unknown): ProposalSummary[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      id: String(row.id ?? ""),
      title: String(row.title ?? "Proposal"),
      status: String(row.status ?? "submitted"),
      authorKind: String(row.authorKind ?? "lsg"),
      activityType: String(row.activityType ?? ""),
      eventDate: typeof row.eventDate === "string" ? row.eventDate : null,
      createdAt: String(row.createdAt ?? ""),
      programName: typeof row.programName === "string" ? row.programName : null,
      unitName: typeof row.unitName === "string" ? row.unitName : null,
      version: Number(row.version ?? 1),
      latestDecision: typeof row.latestDecision === "string" ? row.latestDecision : null,
      latestRemark: typeof row.latestRemark === "string" ? row.latestRemark : null,
    };
  });
}

function toProposalDetail(value: unknown): ProposalDetail | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const requirements = Array.isArray(row.requirements) ? row.requirements : [];
  const versions = Array.isArray(row.versions) ? row.versions : [];
  const reviews = Array.isArray(row.reviews) ? row.reviews : [];
  return {
    id: String(row.id ?? ""),
    title: String(row.title ?? "Proposal"),
    description: typeof row.description === "string" ? row.description : null,
    status: String(row.status ?? "submitted"),
    authorKind: String(row.authorKind ?? "lsg"),
    activityType: String(row.activityType ?? ""),
    eventDate: typeof row.eventDate === "string" ? row.eventDate : null,
    venue: typeof row.venue === "string" ? row.venue : null,
    programId: typeof row.programId === "string" ? row.programId : null,
    programName: typeof row.programName === "string" ? row.programName : null,
    unitId: typeof row.unitId === "string" ? row.unitId : null,
    unitName: typeof row.unitName === "string" ? row.unitName : null,
    createdAt: String(row.createdAt ?? ""),
    versions: versions.map((raw) => {
      const item = raw as Record<string, unknown>;
      return {
        id: String(item.id ?? ""),
        versionNumber: Number(item.versionNumber ?? 1),
        submittedBy: typeof item.submittedBy === "string" ? item.submittedBy : null,
        submissionNote: typeof item.submissionNote === "string" ? item.submissionNote : null,
        submittedAt: String(item.submittedAt ?? ""),
      };
    }),
    reviews: reviews.map((raw) => {
      const item = raw as Record<string, unknown>;
      return {
        versionNumber: Number(item.versionNumber ?? 1),
        decision: String(item.decision ?? ""),
        remark: typeof item.remark === "string" ? item.remark : null,
        decidedBy: typeof item.decidedBy === "string" ? item.decidedBy : null,
        createdAt: String(item.createdAt ?? ""),
      };
    }),
    requirements: requirements.map((raw) => {
      const item = raw as Record<string, unknown>;
      const status = String(item.status ?? "requested");
      return {
        id: String(item.id ?? ""),
        label: String(item.label ?? "Requirement"),
        detail: typeof item.detail === "string" ? item.detail : null,
        status:
          status === "submitted" || status === "accepted" || status === "waived"
            ? status
            : "requested",
        linkUrl: typeof item.linkUrl === "string" ? item.linkUrl : null,
        originalName: typeof item.originalName === "string" ? item.originalName : null,
        respondedNote: typeof item.respondedNote === "string" ? item.respondedNote : null,
        respondedBy: typeof item.respondedBy === "string" ? item.respondedBy : null,
        respondedAt: typeof item.respondedAt === "string" ? item.respondedAt : null,
        versionNumber: typeof item.versionNumber === "number" ? item.versionNumber : null,
      };
    }),
  };
}

export function RequirementsPanel({
  isUsg,
  onOpenTask,
}: {
  isUsg: boolean;
  onOpenTask: (id: string) => void;
}) {
  const [tasks, setTasks] = useState<TaskRequirementSummary[]>([]);
  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProposalDetail | null>(null);
  const [detailState, setDetailState] = useState<"loading" | "ready" | "error">("ready");
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    try {
      const [taskRes, proposalRes] = await Promise.all([
        fetch("/api/tasks"),
        fetch("/api/proposals"),
      ]);
      const [taskJson, proposalJson] = await Promise.all([
        taskRes.json(),
        proposalRes.json(),
      ]);
      if (!taskJson.ok) throw new Error(taskJson.message);
      if (!proposalJson.ok) throw new Error(proposalJson.message);
      setTasks(toTaskSummaries(taskJson.tasks));
      setProposals(toProposalSummaries(proposalJson.proposals));
      setState("ready");
    } catch (loadError) {
      setError(actionMessage(loadError, "We could not load the requirements."));
      setState("error");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const openProposal = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    setDetailState("loading");
    setError(null);
    try {
      const res = await fetch(`/api/proposals/${id}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.message);
      setDetail(toProposalDetail(json.proposal));
      setDetailState("ready");
    } catch (loadError) {
      setError(actionMessage(loadError, "We could not load that requirement submission."));
      setDetailState("error");
    }
  }, []);

  const refreshDetail = useCallback(async () => {
    if (!selectedId) return;
    await openProposal(selectedId);
    await load();
  }, [selectedId, openProposal, load]);

  const lsgProposals = proposals.filter((proposal) => proposal.authorKind === "lsg");

  if (selectedId) {
    return (
      <div className="grid gap-6">
        <button
          type="button"
          onClick={() => {
            setSelectedId(null);
            setDetail(null);
          }}
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted"
        >
          <IconArrowLeft className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          Back to requirements
        </button>
        <ActionError message={error} />
        {detailState === "loading" && <div className="text-muted">Loading...</div>}
        {detailState === "error" && <div className="text-muted">That submission could not be loaded.</div>}
        {detailState === "ready" && detail && (
          <ProposalDetailCard
            detail={detail}
            isUsg={isUsg}
            onDone={refreshDetail}
            onError={setError}
          />
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-medium">Requirements by sender</h2>
        <p className="max-w-2xl text-sm leading-relaxed text-body">
          USG requirements are tasks and checklists for units to comply with. LSG requirements are
          proposals and supporting submissions sent upward for review.
        </p>
      </div>

      <ActionError message={error} />
      {state === "loading" && <div className="text-muted">Loading...</div>}

      {state !== "loading" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Reveal>
            <section className="flex h-full flex-col gap-4 rounded-2xl border border-line bg-paper p-5">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line">
                  <IconSubmission className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-lg font-medium">From USG</h3>
                  <p className="text-sm text-muted">
                    {isUsg
                      ? "Tasks and checklists USG sent to units for compliance."
                      : "Tasks and checklists USG sent to your unit for compliance."}
                  </p>
                </div>
              </div>

              <div className="grid gap-3">
                {tasks.map((task) => {
                  const due = dueLabel(task);
                  return (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => onOpenTask(task.id)}
                      className="w-full rounded-xl border border-line bg-canvas/30 p-4 text-left transition hover:border-ink/20"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium">{task.title}</div>
                          <div className="mt-1 text-sm text-muted">
                            {task.doneUnits}/{task.totalUnits} units done · {due.text}
                          </div>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${due.late ? "text-[#a5442c]" : "text-muted"}`}>
                          {task.isClosed ? "closed" : task.priority}
                        </span>
                      </div>
                    </button>
                  );
                })}
                {tasks.length === 0 && (
                  <p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">
                    No USG requirements have been sent yet.
                  </p>
                )}
              </div>
            </section>
          </Reveal>

          <Reveal delay={60}>
            <section className="flex h-full flex-col gap-4 rounded-2xl border border-line bg-paper p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line">
                    <IconVerification className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />
                  </span>
                  <div>
                    <h3 className="text-lg font-medium">From LSG</h3>
                    <p className="text-sm text-muted">
                      {isUsg
                        ? "Proposals and supporting requirements submitted by LSG units."
                        : "Proposals and supporting requirements your unit sent to USG."}
                    </p>
                  </div>
                </div>
                {!isUsg && (
                  <Button size="sm" onClick={() => setShowCreate(true)}>
                    <IconPencil className="h-4 w-4" /> Send requirement
                  </Button>
                )}
              </div>

              <div className="grid gap-3">
                {lsgProposals.map((proposal) => (
                  <button
                    key={proposal.id}
                    type="button"
                    onClick={() => void openProposal(proposal.id)}
                    className="w-full rounded-xl border border-line bg-canvas/30 p-4 text-left transition hover:border-ink/20"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{proposal.title}</div>
                        <div className="mt-1 text-sm text-muted">
                          {proposal.unitName ?? "LSG unit"} · {proposal.programName ?? "Standalone activity"}
                        </div>
                        <div className="mt-1 text-xs text-muted">
                          Version {proposal.version} · {fmtDate(proposal.eventDate)}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${statusClass(proposal.status)}`}>
                        {statusLabel(proposal.status)}
                      </span>
                    </div>
                    {proposal.latestRemark && (
                      <p className="mt-2 line-clamp-2 text-xs text-muted">{proposal.latestRemark}</p>
                    )}
                  </button>
                ))}
                {lsgProposals.length === 0 && (
                  <p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">
                    No LSG requirements have been sent yet.
                  </p>
                )}
              </div>
            </section>
          </Reveal>
        </div>
      )}

      {showCreate && (
        <CreateProposalModal
          onClose={() => setShowCreate(false)}
          onCreated={async (id) => {
            setShowCreate(false);
            await load();
            await openProposal(id);
          }}
        />
      )}
    </div>
  );
}

function ProposalDetailCard({
  detail,
  isUsg,
  onDone,
  onError,
}: {
  detail: ProposalDetail;
  isUsg: boolean;
  onDone: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const latestReview = detail.reviews[0];
  return (
    <div className="grid gap-5">
      <section className="rounded-2xl border border-line bg-paper p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-medium">{detail.title}</h2>
              <span className={`rounded-full border px-2 py-0.5 text-xs ${statusClass(detail.status)}`}>
                {statusLabel(detail.status)}
              </span>
            </div>
            <p className="mt-2 text-sm text-muted">
              {detail.unitName ?? "LSG unit"} · {detail.programName ?? "Standalone activity"} ·{" "}
              {fmtDate(detail.eventDate)}
            </p>
            {detail.venue && <p className="text-sm text-muted">{detail.venue}</p>}
          </div>
          <div className="text-right text-xs text-muted">
            <div>Version {detail.versions[0]?.versionNumber ?? 1}</div>
            <div>{fmtDateTime(detail.versions[0]?.submittedAt ?? detail.createdAt)}</div>
          </div>
        </div>
        {detail.description && (
          <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-body">{detail.description}</p>
        )}
        {latestReview?.remark && (
          <div className="mt-4 rounded-xl border border-line bg-canvas/40 p-3 text-sm">
            <div className="text-xs uppercase tracking-[0.18em] text-muted">Latest USG remark</div>
            <p className="mt-1 whitespace-pre-wrap">{latestReview.remark}</p>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-paper p-6">
        <h3 className="mb-3 text-sm font-medium">Requirements</h3>
        <div className="grid gap-2">
          {detail.requirements.map((requirement) => (
            <div key={requirement.id} className="rounded-xl border border-line p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{requirement.label}</div>
                  {requirement.detail && <p className="mt-1 text-sm text-muted">{requirement.detail}</p>}
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-xs ${requirementClass(requirement.status)}`}>
                  {REQUIREMENT_STATUS[requirement.status] ?? requirement.status}
                </span>
              </div>
              {requirement.linkUrl && (
                <a href={requirement.linkUrl} target="_blank" rel="noreferrer" className="mt-2 block text-sm underline">
                  {requirement.linkUrl}
                </a>
              )}
              {requirement.originalName && (
                <div className="mt-2 text-sm text-muted">{requirement.originalName}</div>
              )}
              {requirement.respondedNote && (
                <p className="mt-2 text-sm text-muted">LSG note: {requirement.respondedNote}</p>
              )}
              {requirement.respondedBy && (
                <p className="mt-1 text-xs text-muted">
                  Answered by {requirement.respondedBy}
                  {requirement.respondedAt ? ` · ${fmtDateTime(requirement.respondedAt)}` : ""}
                </p>
              )}
            </div>
          ))}
          {detail.requirements.length === 0 && (
            <p className="text-sm text-muted">No additional requirements were requested.</p>
          )}
        </div>
      </section>

      {isUsg ? (
        <UsgProposalActions detail={detail} onDone={onDone} onError={onError} />
      ) : (
        <LsgProposalActions detail={detail} onDone={onDone} onError={onError} />
      )}
    </div>
  );
}

function StartReviewButton({
  proposalId,
  onDone,
  onError,
}: {
  proposalId: string;
  onDone: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    onError(null);
    try {
      await mutate(`/api/proposals/${proposalId}/start-review`, { method: "POST" });
      await onDone();
    } catch (error) {
      onError(actionMessage(error, "We could not start the review."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-paper p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">USG review</h3>
          <p className="text-sm text-muted">This submission is waiting to be reviewed.</p>
        </div>
        <Button size="sm" disabled={busy} onClick={() => void start()}>
          Start review
        </Button>
      </div>
    </section>
  );
}

function UsgProposalActions({
  detail,
  onDone,
  onError,
}: {
  detail: ProposalDetail;
  onDone: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  if (detail.status === "submitted") {
    return <StartReviewButton proposalId={detail.id} onDone={onDone} onError={onError} />;
  }
  if (detail.status === "under_review") {
    return <ReviewProposalForm detail={detail} onDone={onDone} onError={onError} />;
  }
  if (detail.status === "requirements_requested") {
    const submitted = detail.requirements.filter((requirement) => requirement.status === "submitted");
    const pending = detail.requirements.filter((requirement) => requirement.status === "requested");
    if (pending.length === 0 && submitted.length > 0) {
      return <VerifyRequirementsForm detail={detail} requirements={submitted} onDone={onDone} onError={onError} />;
    }
    return (
      <section className="rounded-2xl border border-line bg-paper p-6 text-sm text-muted">
        Waiting for the LSG to answer the requested requirements.
      </section>
    );
  }
  return null;
}

function ReviewProposalForm({
  detail,
  onDone,
  onError,
}: {
  detail: ProposalDetail;
  onDone: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [decision, setDecision] = useState<"approved" | "returned" | "rejected">("approved");
  const [remark, setRemark] = useState("");
  const [requirements, setRequirements] = useState<Array<{ label: string; detail: string }>>([]);
  const [busy, setBusy] = useState(false);

  const addRequirement = () => setRequirements((current) => [...current, { label: "", detail: "" }]);

  const submit = async () => {
    onError(null);
    if ((decision === "returned" || decision === "rejected") && !remark.trim()) {
      onError("Add a remark before returning or rejecting this submission.");
      return;
    }
    setBusy(true);
    try {
      await mutate(`/api/proposals/${detail.id}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decision,
          remark,
          requirements:
            decision === "approved"
              ? requirements.filter((requirement) => requirement.label.trim())
              : null,
        }),
      });
      await onDone();
    } catch (error) {
      onError(actionMessage(error, "We could not record that decision."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-paper p-6">
      <h3 className="text-sm font-medium">USG decision</h3>
      <div className="mt-3 grid gap-3">
        <div>
          <label htmlFor="proposal-decision" className="mb-1 block text-sm text-muted">
            Decision
          </label>
          <select
            id="proposal-decision"
            value={decision}
            onChange={(event) => setDecision(event.target.value as "approved" | "returned" | "rejected")}
            className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm"
          >
            <option value="approved">Approve</option>
            <option value="returned">Return for revision</option>
            <option value="rejected">Reject</option>
          </select>
        </div>
        <div>
          <label htmlFor="proposal-remark" className="mb-1 block text-sm text-muted">
            Remark
          </label>
          <textarea
            id="proposal-remark"
            value={remark}
            onChange={(event) => setRemark(event.target.value)}
            rows={3}
            className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm"
            placeholder={decision === "approved" ? "Optional note" : "Reason required"}
          />
        </div>

        {decision === "approved" && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm text-muted">Additional requirements</div>
              <button type="button" onClick={addRequirement} className="text-sm text-muted underline">
                + Add
              </button>
            </div>
            <div className="grid gap-2">
              {requirements.map((requirement, index) => (
                <div key={index} className="grid gap-2 rounded-xl border border-line p-3">
                  <input
                    value={requirement.label}
                    onChange={(event) => {
                      const next = [...requirements];
                      next[index] = { ...next[index], label: event.target.value };
                      setRequirements(next);
                    }}
                    placeholder="Requirement label"
                    className="rounded-lg border border-line px-2 py-1 text-sm"
                  />
                  <input
                    value={requirement.detail}
                    onChange={(event) => {
                      const next = [...requirements];
                      next[index] = { ...next[index], detail: event.target.value };
                      setRequirements(next);
                    }}
                    placeholder="Details"
                    className="rounded-lg border border-line px-2 py-1 text-sm"
                  />
                </div>
              ))}
              {requirements.length === 0 && (
                <p className="text-xs text-muted">Approve without asking for more requirements.</p>
              )}
            </div>
          </div>
        )}

        <Button size="sm" disabled={busy} onClick={() => void submit()}>
          Record decision
        </Button>
      </div>
    </section>
  );
}

function VerifyRequirementsForm({
  detail,
  requirements,
  onDone,
  onError,
}: {
  detail: ProposalDetail;
  requirements: ProposalRequirement[];
  onDone: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [decisions, setDecisions] = useState<Record<string, { decision: "accepted" | "waived"; note: string }>>(
    Object.fromEntries(requirements.map((requirement) => [requirement.id, { decision: "accepted", note: "" }])),
  );
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    onError(null);
    try {
      await mutate(`/api/proposals/${detail.id}/requirements/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          remark,
          decisions: requirements.map((requirement) => ({
            requirementId: requirement.id,
            decision: decisions[requirement.id]?.decision ?? "accepted",
            note: decisions[requirement.id]?.note ?? "",
          })),
        }),
      });
      await onDone();
    } catch (error) {
      onError(actionMessage(error, "We could not verify those requirements."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-paper p-6">
      <h3 className="text-sm font-medium">Verify LSG requirements</h3>
      <p className="mt-1 text-sm text-muted">Accept or waive every submitted requirement.</p>
      <div className="mt-3 grid gap-3">
        {requirements.map((requirement) => {
          const row = decisions[requirement.id] ?? { decision: "accepted", note: "" };
          return (
            <div key={requirement.id} className="rounded-xl border border-line p-3">
              <div className="font-medium">{requirement.label}</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-[10rem_1fr]">
                <select
                  value={row.decision}
                  onChange={(event) =>
                    setDecisions((current) => ({
                      ...current,
                      [requirement.id]: {
                        ...row,
                        decision: event.target.value as "accepted" | "waived",
                      },
                    }))
                  }
                  className="rounded-lg border border-line px-2 py-1 text-sm"
                >
                  <option value="accepted">Accept</option>
                  <option value="waived">Waive</option>
                </select>
                <input
                  value={row.note}
                  onChange={(event) =>
                    setDecisions((current) => ({
                      ...current,
                      [requirement.id]: { ...row, note: event.target.value },
                    }))
                  }
                  placeholder="Note (optional)"
                  className="rounded-lg border border-line px-2 py-1 text-sm"
                />
              </div>
            </div>
          );
        })}
        <input
          value={remark}
          onChange={(event) => setRemark(event.target.value)}
          placeholder="Overall remark (optional)"
          className="rounded-xl border border-line px-3 py-2 text-sm"
        />
        <Button size="sm" disabled={busy} onClick={() => void submit()}>
          Verify requirements
        </Button>
      </div>
    </section>
  );
}

function LsgProposalActions({
  detail,
  onDone,
  onError,
}: {
  detail: ProposalDetail;
  onDone: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  if (detail.status === "requirements_requested") {
    const requested = detail.requirements.filter((requirement) => requirement.status === "requested");
    if (requested.length > 0) {
      return <RespondRequirementsForm detail={detail} requirements={requested} onDone={onDone} onError={onError} />;
    }
  }
  if (detail.status === "returned") {
    return <ReviseProposalForm detail={detail} onDone={onDone} onError={onError} />;
  }
  return (
    <section className="rounded-2xl border border-line bg-paper p-6 text-sm text-muted">
      {detail.status === "submitted" && "This requirement has been sent and is waiting for USG."}
      {detail.status === "under_review" && "USG is reviewing this requirement."}
      {detail.status === "approved" && "USG approved this requirement."}
      {detail.status === "rejected" && "USG rejected this requirement."}
      {detail.status === "published" && "This requirement is published."}
    </section>
  );
}

function RespondRequirementsForm({
  detail,
  requirements,
  onDone,
  onError,
}: {
  detail: ProposalDetail;
  requirements: ProposalRequirement[];
  onDone: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [rows, setRows] = useState<Record<string, { mode: "file" | "link"; link: string; file: File | null }>>(
    Object.fromEntries(
      requirements.map((requirement) => [requirement.id, { mode: "file", link: "", file: null }]),
    ),
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [precheckBlocked, setPrecheckBlocked] = useState(false);

  const precheckItems = requirements.map((requirement) => {
    const row = rows[requirement.id] ?? { mode: "file", link: "", file: null };
    return {
      itemId: requirement.id,
      label: requirement.label,
      itemKind: row.mode,
      file: row.mode === "file" ? row.file : null,
      linkUrl: row.mode === "link" ? row.link : "",
    };
  });

  const submit = async () => {
    setBusy(true);
    onError(null);
    try {
      const items: Array<Record<string, unknown>> = [];
      for (const requirement of requirements) {
        const row = rows[requirement.id] ?? { mode: "file", link: "", file: null };
        if (row.mode === "file") {
          if (!row.file) throw new Error(`Choose a file for ${requirement.label}.`);
          const upload = await uploadFile(row.file, {
            target: "requirement",
            requirementId: requirement.id,
            nonce: uuidv4(),
            version: requirement.versionNumber ?? 1,
          });
          if (!upload.ok) throw new Error(upload.reason ?? "That file could not be uploaded.");
          items.push({
            requirementId: requirement.id,
            kind: "file",
            storagePath: upload.storagePath,
            originalName: row.file.name,
            mimeType: row.file.type,
            sizeBytes: row.file.size,
          });
        } else {
          if (!row.link.trim()) throw new Error(`Add a link for ${requirement.label}.`);
          items.push({
            requirementId: requirement.id,
            kind: "link",
            linkUrl: row.link.trim(),
          });
        }
      }
      await mutate(`/api/proposals/${detail.id}/requirements/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items, note }),
      });
      await onDone();
    } catch (error) {
      onError(actionMessage(error, "We could not submit those requirements."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-paper p-6">
      <h3 className="text-sm font-medium">Answer USG requirements</h3>
      <div className="mt-3 grid gap-3">
        {requirements.map((requirement) => {
          const row = rows[requirement.id] ?? { mode: "file", link: "", file: null };
          return (
            <div key={requirement.id} className="rounded-xl border border-line p-3">
              <div className="font-medium">{requirement.label}</div>
              {requirement.detail && <p className="mt-1 text-sm text-muted">{requirement.detail}</p>}
              <div className="mt-2 flex gap-3 text-sm">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={row.mode === "file"}
                    onChange={() =>
                      setRows((current) => ({
                        ...current,
                        [requirement.id]: { ...row, mode: "file" },
                      }))
                    }
                  />
                  File
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={row.mode === "link"}
                    onChange={() =>
                      setRows((current) => ({
                        ...current,
                        [requirement.id]: { ...row, mode: "link" },
                      }))
                    }
                  />
                  Link
                </label>
              </div>
              {row.mode === "file" ? (
                <input
                  type="file"
                  onChange={(event) =>
                    setRows((current) => ({
                      ...current,
                      [requirement.id]: { ...row, file: event.target.files?.[0] ?? null },
                    }))
                  }
                  className="mt-2 text-sm"
                />
              ) : (
                <input
                  value={row.link}
                  onChange={(event) =>
                    setRows((current) => ({
                      ...current,
                      [requirement.id]: { ...row, link: event.target.value },
                    }))
                  }
                  placeholder="https://"
                  className="mt-2 w-full rounded-lg border border-line px-2 py-1 text-sm"
                />
              )}
            </div>
          );
        })}
        <RequirementPrecheckPanel
          proposalId={detail.id}
          context={{
            title: detail.title,
            eventDate: detail.eventDate,
            venue: detail.venue,
            unitName: detail.unitName,
            programName: detail.programName,
          }}
          items={precheckItems}
          onBlockedChange={setPrecheckBlocked}
          disabled={busy}
        />
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          placeholder="Submission note (optional)"
          className="rounded-xl border border-line px-3 py-2 text-sm"
        />
        <Button size="sm" disabled={busy || precheckBlocked} onClick={() => void submit()}>
          Submit requirements
        </Button>
      </div>
    </section>
  );
}

function TemplateItemInputs({
  items,
  drafts,
  setDrafts,
}: {
  items: ProgramItem[];
  drafts: DraftMap;
  setDrafts: (update: (current: DraftMap) => DraftMap) => void;
}) {
  return (
    <div className="grid gap-2">
      {items.map((item) => {
        const draft = drafts[item.id] ?? { file: null, link: "" };
        return (
          <div key={item.id} className="rounded-xl border border-line p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">{item.label}</div>
              <span className="text-xs text-muted">{item.itemKind}</span>
            </div>
            {item.itemKind === "link" ? (
              <input
                value={draft.link}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [item.id]: { ...draft, link: event.target.value },
                  }))
                }
                placeholder="https://"
                className="mt-2 w-full rounded-lg border border-line px-2 py-1 text-sm"
              />
            ) : (
              <input
                type="file"
                accept={
                  item.allowedExtensions && item.allowedExtensions.length > 0
                    ? item.allowedExtensions.map((extension) => `.${extension}`).join(",")
                    : undefined
                }
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [item.id]: { ...draft, file: event.target.files?.[0] ?? null },
                  }))
                }
                className="mt-2 text-sm"
              />
            )}
          </div>
        );
      })}
      {items.length === 0 && (
        <p className="rounded-xl border border-dashed border-line p-3 text-sm text-muted">
          No requirement template is configured for this selection.
        </p>
      )}
    </div>
  );
}

function CreateProposalModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => Promise<void>;
}) {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [defaults, setDefaults] = useState<ProgramItem[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [programId, setProgramId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [activityType, setActivityType] = useState("academic");
  const [eventDate, setEventDate] = useState("");
  const [venue, setVenue] = useState("");
  const [note, setNote] = useState("");
  const [drafts, setDrafts] = useState<DraftMap>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [precheckBlocked, setPrecheckBlocked] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [programRes, defaultRes, unitRes] = await Promise.all([
          fetch("/api/programs"),
          fetch("/api/requirements/default"),
          fetch("/api/units"),
        ]);
        const [programJson, defaultJson, unitJson] = await Promise.all([
          programRes.json(),
          defaultRes.json(),
          unitRes.json(),
        ]);
        if (!programJson.ok) throw new Error(programJson.message);
        if (!defaultJson.ok) throw new Error(defaultJson.message);
        if (!unitJson.ok) throw new Error(unitJson.message);
        const nextPrograms = toPrograms(programJson.programs);
        const nextDefaults = toDefaultItems(defaultJson.items);
        const nextUnits = Array.isArray(unitJson.units)
          ? (unitJson.units as Array<Record<string, unknown>>).map((unit) => ({
              id: String(unit.id ?? ""),
              name: String(unit.name ?? "Unit"),
            }))
          : [];
        setPrograms(nextPrograms);
        setDefaults(nextDefaults);
        setUnits(nextUnits);
        const initialProgram = nextPrograms[0]?.id ?? "";
        setProgramId(initialProgram);
        setUnitId(nextUnits[0]?.id ?? "");
        setDrafts(draftsFor(programItems(nextPrograms, initialProgram, nextDefaults)));
      } catch (loadError) {
        setError(actionMessage(loadError, "We could not load the requirement form."));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const items = programItems(programs, programId, defaults);

  const precheckItems = items.map((item) => {
    const draft = drafts[item.id] ?? { file: null, link: "" };
    return {
      itemId: item.id,
      label: item.label,
      itemKind: item.itemKind,
      file: item.itemKind === "file" ? draft.file : null,
      linkUrl: item.itemKind === "link" ? draft.link : "",
    };
  });

  const changeProgram = (nextId: string) => {
    setProgramId(nextId);
    setDrafts(draftsFor(programItems(programs, nextId, defaults)));
  };

  const submit = async () => {
    setError(null);
    if (!title.trim() || title.trim().length < 4) {
      setError("Add a title with at least 4 characters.");
      return;
    }
    if (!unitId) {
      setError("Your account is not linked to a unit yet.");
      return;
    }
    if (items.length === 0) {
      setError("No requirement template is configured. Ask USG to set the default requirements.");
      return;
    }
    setBusy(true);
    try {
      const submissionItems: Array<Record<string, unknown>> = [];
      for (const item of items) {
        const draft = drafts[item.id] ?? { file: null, link: "" };
        if (item.itemKind === "file") {
          if (!draft.file) throw new Error(`Choose a file for ${item.label}.`);
          const upload = await uploadFile(draft.file, {
            target: "item",
            itemId: item.id,
            nonce: uuidv4(),
            version: 1,
          });
          if (!upload.ok) throw new Error(upload.reason ?? "That file could not be uploaded.");
          submissionItems.push({
            requirement_item_id: item.id,
            kind: "file",
            storagePath: upload.storagePath,
            originalName: draft.file.name,
            mimeType: draft.file.type,
            sizeBytes: draft.file.size,
          });
        } else {
          if (!draft.link.trim()) throw new Error(`Add a link for ${item.label}.`);
          submissionItems.push({
            requirement_item_id: item.id,
            kind: "link",
            linkUrl: draft.link.trim(),
          });
        }
      }

      const json = await mutate("/api/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          programId: programId || null,
          title,
          description,
          activityType,
          eventDate: eventDate || null,
          venue,
          unitId,
          items: submissionItems,
          note,
        }),
      });
      const proposalId = typeof json.proposalId === "string" ? json.proposalId : "";
      if (!proposalId) throw new Error("That requirement was saved but could not be opened.");
      await onCreated(proposalId);
    } catch (submitError) {
      setError(actionMessage(submitError, "We could not send that requirement."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-line bg-paper p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-lg font-medium">Send requirement to USG</div>
            <p className="text-sm text-muted">Submit a proposal and its supporting requirements.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {loading && <div className="text-sm text-muted">Loading...</div>}
        {!loading && (
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="req-program" className="mb-1 block text-sm text-muted">
                  Program
                </label>
                <select
                  id="req-program"
                  value={programId}
                  onChange={(event) => changeProgram(event.target.value)}
                  className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm"
                >
                  {defaults.length > 0 && <option value="">Standalone activity</option>}
                  {programs.map((program) => (
                    <option key={program.id} value={program.id}>
                      {program.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="req-unit" className="mb-1 block text-sm text-muted">
                  Unit
                </label>
                <select
                  id="req-unit"
                  value={unitId}
                  onChange={(event) => setUnitId(event.target.value)}
                  className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm"
                >
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="req-title" className="mb-1 block text-sm text-muted">
                Title
              </label>
              <input
                id="req-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="w-full rounded-xl border border-line px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="req-description" className="mb-1 block text-sm text-muted">
                Description
              </label>
              <textarea
                id="req-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                className="w-full rounded-xl border border-line px-3 py-2 text-sm"
              />
              <div className="mt-2">
                <DraftWithAiButton
                  kind="proposal"
                  label="Draft proposal with AI"
                  disabled={busy}
                  getFields={() => ({
                    title,
                    activityType,
                    eventDate,
                    venue,
                    programName:
                      programs.find((program) => program.id === programId)?.name ?? "",
                    purpose: description,
                    budgetText: "",
                  })}
                  onUse={setDescription}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="req-type" className="mb-1 block text-sm text-muted">
                  Activity type
                </label>
                <select
                  id="req-type"
                  value={activityType}
                  onChange={(event) => setActivityType(event.target.value)}
                  className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm"
                >
                  {ACTIVITY_TYPES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="req-date" className="mb-1 block text-sm text-muted">
                  Event date
                </label>
                <input
                  id="req-date"
                  type="date"
                  value={eventDate}
                  onChange={(event) => setEventDate(event.target.value)}
                  className="w-full rounded-xl border border-line px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="req-venue" className="mb-1 block text-sm text-muted">
                  Venue
                </label>
                <input
                  id="req-venue"
                  value={venue}
                  onChange={(event) => setVenue(event.target.value)}
                  className="w-full rounded-xl border border-line px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div>
              <div className="mb-2 text-sm font-medium">Requirement documents</div>
              <TemplateItemInputs items={items} drafts={drafts} setDrafts={setDrafts} />
              <div className="mt-3">
                <RequirementPrecheckPanel
                  programId={programId || undefined}
                  context={{
                    title,
                    eventDate: eventDate || null,
                    venue,
                    unitName: units.find((unit) => unit.id === unitId)?.name ?? null,
                    programName:
                      programs.find((program) => program.id === programId)?.name ?? null,
                  }}
                  items={precheckItems}
                  onBlockedChange={setPrecheckBlocked}
                  disabled={busy}
                />
              </div>
            </div>

            <div>
              <label htmlFor="req-note" className="mb-1 block text-sm text-muted">
                Submission note
              </label>
              <textarea
                id="req-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                className="w-full rounded-xl border border-line px-3 py-2 text-sm"
              />
            </div>

            <ActionError message={error} />
            <Button
              disabled={busy || precheckBlocked || !title.trim() || !unitId}
              onClick={() => void submit()}
            >
              Send requirement
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ReviseProposalForm({
  detail,
  onDone,
  onError,
}: {
  detail: ProposalDetail;
  onDone: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [items, setItems] = useState<ProgramItem[]>([]);
  const [drafts, setDrafts] = useState<DraftMap>({});
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [precheckBlocked, setPrecheckBlocked] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [programRes, defaultRes] = await Promise.all([
          fetch("/api/programs"),
          fetch("/api/requirements/default"),
        ]);
        const [programJson, defaultJson] = await Promise.all([
          programRes.json(),
          defaultRes.json(),
        ]);
        if (!programJson.ok) throw new Error(programJson.message);
        if (!defaultJson.ok) throw new Error(defaultJson.message);
        const nextPrograms = toPrograms(programJson.programs);
        const nextDefaults = toDefaultItems(defaultJson.items);
        const nextItems = programItems(nextPrograms, detail.programId ?? "", nextDefaults);
        setItems(nextItems);
        setDrafts(draftsFor(nextItems));
      } catch (loadError) {
        onError(actionMessage(loadError, "We could not load the revision form."));
      } finally {
        setLoading(false);
      }
    })();
  }, [detail.programId, onError]);

  const precheckItems = items.map((item) => {
    const draft = drafts[item.id] ?? { file: null, link: "" };
    return {
      itemId: item.id,
      label: item.label,
      itemKind: item.itemKind,
      file: item.itemKind === "file" ? draft.file : null,
      linkUrl: item.itemKind === "link" ? draft.link : "",
    };
  });

  const submit = async () => {
    setBusy(true);
    onError(null);
    try {
      if (items.length === 0) throw new Error("No requirement template is configured.");
      const nextVersion = (detail.versions[0]?.versionNumber ?? 1) + 1;
      const submissionItems: Array<Record<string, unknown>> = [];
      for (const item of items) {
        const draft = drafts[item.id] ?? { file: null, link: "" };
        if (item.itemKind === "file") {
          if (!draft.file) throw new Error(`Choose a file for ${item.label}.`);
          const upload = await uploadFile(draft.file, {
            target: "item",
            itemId: item.id,
            nonce: uuidv4(),
            version: nextVersion,
          });
          if (!upload.ok) throw new Error(upload.reason ?? "That file could not be uploaded.");
          submissionItems.push({
            requirement_item_id: item.id,
            kind: "file",
            storagePath: upload.storagePath,
            originalName: draft.file.name,
            mimeType: draft.file.type,
            sizeBytes: draft.file.size,
          });
        } else {
          if (!draft.link.trim()) throw new Error(`Add a link for ${item.label}.`);
          submissionItems.push({
            requirement_item_id: item.id,
            kind: "link",
            linkUrl: draft.link.trim(),
          });
        }
      }
      await mutate(`/api/proposals/${detail.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: submissionItems, note }),
      });
      await onDone();
    } catch (error) {
      onError(actionMessage(error, "We could not submit that revision."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-paper p-6">
      <h3 className="text-sm font-medium">Revise and resubmit</h3>
      <p className="mt-1 text-sm text-muted">Replace every requirement document for the next version.</p>
      {loading ? (
        <div className="mt-3 text-sm text-muted">Loading...</div>
      ) : (
        <div className="mt-3 grid gap-3">
          <TemplateItemInputs items={items} drafts={drafts} setDrafts={setDrafts} />
          <RequirementPrecheckPanel
            proposalId={detail.id}
            context={{
              title: detail.title,
              eventDate: detail.eventDate,
              venue: detail.venue,
              unitName: detail.unitName,
              programName: detail.programName,
            }}
            items={precheckItems}
            onBlockedChange={setPrecheckBlocked}
            disabled={busy}
          />
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            placeholder="Revision note (optional)"
            className="rounded-xl border border-line px-3 py-2 text-sm"
          />
          <Button size="sm" disabled={busy || precheckBlocked} onClick={() => void submit()}>
            Resubmit
          </Button>
        </div>
      )}
    </section>
  );
}
