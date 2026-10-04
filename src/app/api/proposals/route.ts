import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

type ListResult = RpcResult & {
  proposals?: Array<Record<string, unknown>>;
};

type CreateResult = RpcResult & {
  proposalId?: string;
  status?: string;
  version?: number;
};

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "rate_limited") return 429;
  if (reason === "forbidden") return 403;
  return 400;
}

export async function GET() {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  try {
    const res = await callRpc<ListResult>("list_proposals", { p_session_token: token });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason) },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true, proposals: res.proposals ?? [] });
  } catch (error) {
    console.error("[proposals:list]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load the proposals." },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: {
    programId?: string;
    title?: string;
    description?: string;
    activityType?: string;
    eventDate?: string;
    venue?: string;
    unitId?: string;
    items?: unknown[];
    note?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Something went wrong. Please try again." },
      { status: 400 },
    );
  }

  try {
    const res = await callRpc<CreateResult>("create_proposal", {
      p_session_token: token,
      p_program_id: body.programId,
      p_title: body.title,
      p_description: body.description,
      p_activity_type: body.activityType,
      p_event_date: body.eventDate ?? null,
      p_venue: body.venue ?? "",
      p_unit_id: body.unitId ?? null,
      p_items: Array.isArray(body.items) ? body.items : [],
      p_note: body.note ?? "",
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason) },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({
      ok: true,
      proposalId: res.proposalId,
      status: res.status,
      version: res.version,
    });
  } catch (error) {
    console.error("[proposals:create]", error);
    return NextResponse.json(
      { ok: false, message: "We could not create that proposal." },
      { status: 500 },
    );
  }
}