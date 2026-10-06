import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

/**
 * The one read behind both dashboards.
 *
 * There are no query parameters on purpose. Every module list takes none either: a
 * dashboard that accepts `?scope=` or `?status=` is a screen that can be asked to
 * show something the database would not hand over otherwise, and the answer would
 * have to be "no, but you asked nicely". The scope is decided from the session
 * inside `smartgov.list_dashboard` and nowhere else.
 *
 * The type is exported rather than redeclared by the view because the two lists can
 * only disagree if they are written twice. Note what is *not* in here: a route. The
 * view is shared by both workspaces and takes its links from the side that renders
 * it, so no `/lsg` or `/usg` string reaches the LSG bundle.
 */

export type DashboardCounts = {
  proposals: { visible: number; awaitingReview: number; returnedToMe: number; mineOpen: number };
  documents: {
    total: number;
    awaitingCheck: number;
    queried: number;
    rejected: number;
    mineUnchecked: number;
  };
  budgets: { visible: number; awaitingDecision: number; mineOpen: number };
  tasks: { visible: number; overdue: number; awaitingMe: number };
};

export type DashboardPayload = RpcResult & {
  scope?: "organization" | "unit";
  canReview?: boolean;
  counts?: DashboardCounts;
  proposals?: Array<{
    id: string;
    title: string;
    status: string;
    activityType: string;
    unitName: string | null;
    version: number | null;
    createdAt: string;
    mine: boolean;
    awaitingMe: boolean;
  }>;
  documents?: Array<{
    submissionId: string;
    proposalId: string;
    proposalTitle: string;
    label: string;
    originalName: string | null;
    attached: boolean;
    verdict: string | null;
    verifiedBy: string | null;
    verifiedAt: string | null;
    myVerdict: string | null;
  }>;
  budgets?: Array<{
    id: string;
    proposalId: string | null;
    title: string;
    status: string;
    unitName: string | null;
    requestedTotal: string | number;
    approvedTotal: string | number | null;
    createdAt: string;
    mine: boolean;
    awaitingMe: boolean;
  }>;
  tasks?: Array<{
    id: string;
    title: string;
    priority: string;
    dueDate: string | null;
    overdue: boolean;
    doneUnits: number;
    totalUnits: number;
    mineStatus: string | null;
    awaitingMe: boolean;
  }>;
  timeline?: Array<{
    at: string;
    kind: "proposal" | "decision" | "document" | "budget" | "task";
    proposalId: string | null;
    budgetId: string | null;
    taskId: string | null;
    title: string;
    detail: string;
    actor: string | null;
  }>;
};

export async function GET() {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  try {
    const res = await callRpc<DashboardPayload>("list_dashboard", { p_session_token: token });

    if (!res.ok) {
      return NextResponse.json({ ok: false, message: messageFor(res.reason) }, { status: 401 });
    }

    return NextResponse.json(res);
  } catch (error) {
    console.error("[dashboard]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load your dashboard." },
      { status: 500 },
    );
  }
}