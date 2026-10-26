import { NextResponse } from "next/server";

import { messageFor } from "@/lib/auth/messages";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { readSessionToken } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * A unit's answer to one checklist item, and the office's ruling on it.
 *
 * Both verbs travel through here because they act on the same row from opposite
 * ends: the unit fills it in, the office rules on what was filled in. The
 * verdict vocabulary is the three-way one the office asked for -- approve,
 * flag, return -- and a return carries the reason, which
 * `review_requirement_answer` refuses to record without.
 *
 * Note what is NOT here: the file bytes. An answer is either a link or a file
 * that has already been staged through /api/uploads, so this route only ever
 * receives a storage path. That keeps a 10 MB body out of a JSON handler.
 */
type AnswerPayload = RpcResult & { verdict?: string; unitId?: string; status?: string };

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "rate_limited") return 429;
  if (reason === "forbidden") return 403;
  if (reason === "not_found") return 404;
  return 400;
}

/** POST records or replaces a unit's answer. */
export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const limit = rateLimit(`answer:write:ip:${clientIp(req)}`, 60, 10 * 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, reason: "rate_limited", message: messageFor("rate_limited") },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const requirementId = typeof body.requirementId === "string" ? body.requirementId : "";
  if (!requirementId) {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  try {
    const res = await callRpc<AnswerPayload>("submit_requirement_answer", {
      p_session_token: token,
      p_requirement_id: requirementId,
      p_unit_id: typeof body.unitId === "string" && body.unitId ? body.unitId : null,
      p_link_url: typeof body.linkUrl === "string" ? body.linkUrl : "",
      p_storage_path: typeof body.storagePath === "string" && body.storagePath ? body.storagePath : null,
      p_original_name: typeof body.originalName === "string" && body.originalName ? body.originalName : null,
      p_mime_type: typeof body.mimeType === "string" && body.mimeType ? body.mimeType : null,
      p_size_bytes: typeof body.sizeBytes === "number" ? body.sizeBytes : null,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, reason: res.reason, message: messageFor(res.reason) },
        { status: statusForReason(res.reason) },
      );
    }

    return NextResponse.json({ ok: true, unitId: res.unitId, status: res.status });
  } catch (error) {
    console.error("[answer:write]", error);
    return NextResponse.json(
      { ok: false, message: "We could not save that answer. Please try again." },
      { status: 500 },
    );
  }
}

/** PATCH is the office's ruling: approved, flagged, or returned with a reason. */
export async function PATCH(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const requirementId = typeof body.requirementId === "string" ? body.requirementId : "";
  const unitId = typeof body.unitId === "string" ? body.unitId : "";
  if (!requirementId || !unitId) {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  try {
    const res = await callRpc<AnswerPayload>("review_requirement_answer", {
      p_session_token: token,
      p_requirement_id: requirementId,
      p_unit_id: unitId,
      p_verdict: typeof body.verdict === "string" ? body.verdict : "",
      p_note: typeof body.note === "string" ? body.note : "",
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, reason: res.reason, message: messageFor(res.reason) },
        { status: statusForReason(res.reason) },
      );
    }

    return NextResponse.json({ ok: true, verdict: res.verdict });
  } catch (error) {
    console.error("[answer:review]", error);
    return NextResponse.json(
      { ok: false, message: "We could not save that ruling. Please try again." },
      { status: 500 },
    );
  }
}
