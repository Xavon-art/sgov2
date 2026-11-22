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

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }
  const { id } = await ctx.params;
  let body: { supportFiles?: unknown; claimNote?: unknown; note?: unknown };
  try {
    body = (await request.json()) as { supportFiles?: unknown; claimNote?: unknown; note?: unknown };
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const supportFiles = Array.isArray(body.supportFiles) ? body.supportFiles : [];
  const rawNote = body.claimNote ?? body.note;
  const claimNote = typeof rawNote === "string" ? rawNote.trim() : "";
  if (!claimNote) {
    return NextResponse.json(
      { ok: false, reason: "claim_note_required", message: "Enter a claim note before claiming." },
      { status: 400 },
    );
  }

  try {
    const res = await callRpc<RpcResult>("claim_event", {
      p_session_token: token,
      p_event_id: id,
      p_support_files: supportFiles,
      p_claim_note: claimNote,
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[events:claim]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}