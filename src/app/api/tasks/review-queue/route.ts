import { NextResponse } from "next/server";
import { messageFor } from "@/lib/auth/messages";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

type QueuePayload = RpcResult & {
  items?: Array<Record<string, unknown>>;
  extensions?: Array<Record<string, unknown>>;
};

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "forbidden") return 403;
  return 400;
}

function booleanParam(value: string | null): boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export async function GET(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const params = new URL(req.url).searchParams;
  const status = params.get("status") || "under_review";
  const campus = params.get("campus");
  const unitId = params.get("unitId");
  const dueFrom = params.get("dueFrom");
  const dueTo = params.get("dueTo");

  try {
    const res = await callRpc<QueuePayload>("list_review_queue", {
      p_session_token: token,
      p_status: status === "all" ? null : status,
      p_campus: campus || null,
      p_unit_id: unitId || null,
      p_due_from: dueFrom || null,
      p_due_to: dueTo || null,
      p_overdue: booleanParam(params.get("overdue")),
      p_late: booleanParam(params.get("late")),
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, reason: res.reason, message: messageFor(res.reason) },
        { status: statusForReason(res.reason) },
      );
    }

    return NextResponse.json({
      ok: true,
      items: res.items ?? [],
      extensions: res.extensions ?? [],
    });
  } catch (error) {
    console.error("[review-queue:read]", error);
    return NextResponse.json({ ok: false, message: "We could not load the review queue." }, { status: 500 });
  }
}
