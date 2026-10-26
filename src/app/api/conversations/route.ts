import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

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
    const res = await callRpc<RpcResult & { conversations?: unknown }>("list_conversations", {
      p_session_token: token,
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true, conversations: res.conversations ?? [] });
  } catch (error) {
    console.error("[conversations:list]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }
  let body: { participantIds?: unknown; subject?: unknown };
  try {
    body = (await request.json()) as { participantIds?: unknown; subject?: unknown };
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const participantIds = Array.isArray(body.participantIds)
    ? body.participantIds.filter((x): x is string => typeof x === "string")
    : [];

  try {
    const res = await callRpc<RpcResult & { conversationId?: string }>("create_conversation", {
      p_session_token: token,
      p_participant_ids: participantIds,
      p_subject: typeof body.subject === "string" ? body.subject.trim() : null,
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true, conversationId: res.conversationId });
  } catch (error) {
    console.error("[conversations:create]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}