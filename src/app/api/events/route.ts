import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

type EventRow = {
  id: string;
  title: string;
  description: string | null;
  eventDate: string;
  scope: string;
  unitId: string | null;
  status: string;
  supportFiles: unknown;
  claimNote: string | null;
  decisionNote: string | null;
  createdAt: string;
  createdBy: string;
  canDecide: boolean;
};

type ListPayload = RpcResult & { events?: EventRow[] };
type CreatePayload = RpcResult & { eventId?: string };

function statusForReason(reason?: string): number {
  switch (reason) {
    case "unauthenticated":
      return 401;
    case "rate_limited":
      return 429;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    default:
      return 400;
  }
}

export async function GET() {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }
  try {
    const res = await callRpc<ListPayload>("list_events", { p_session_token: token });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true, events: res.events ?? [] });
  } catch (error) {
    console.error("[events:list]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ ok: false, message: "Give the event a title." }, { status: 400 });
  }
  const eventDate = typeof body.eventDate === "string" && body.eventDate ? body.eventDate : null;
  if (!eventDate) {
    return NextResponse.json({ ok: false, message: "Pick an event date." }, { status: 400 });
  }

  try {
    const res = await callRpc<CreatePayload>("create_event", {
      p_session_token: token,
      p_title: title,
      p_description: typeof body.description === "string" ? body.description.trim() : null,
      p_event_date: eventDate,
      p_scope: typeof body.scope === "string" ? body.scope : "unit",
      p_unit_id: typeof body.unitId === "string" && body.unitId ? body.unitId : null,
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true, eventId: res.eventId });
  } catch (error) {
    console.error("[events:create]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}