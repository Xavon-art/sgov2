import { NextResponse } from "next/server";

import { messageFor } from "@/lib/auth/messages";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { readSessionToken } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Personal requests: the LSG's own channel upward.
 *
 * GET   list the caller's requests (a unit sees its own, the office sees all)
 * POST  file a new one -- subject, cover letter, purpose, needed-by, document
 * PATCH decide it: the office grants or declines with a reason, and the filing
 *       unit may withdraw its own while it is still open
 *
 * The withdraw/decide split is why this is not two routes. They are the same
 * transition on the same row, distinguished by who is allowed to make it and
 * to what end state, and `decide_personal_request` holds that rule in one
 * place. Splitting them would duplicate the state guard.
 */
type RequestPayload = RpcResult & {
  isUsg?: boolean;
  requests?: Array<Record<string, unknown>>;
  requestId?: string;
  status?: string;
};

const DECISIONS = new Set([
  "granted",
  "declined",
  "needs_revision",
  "submission_required",
  "withdrawn",
]);

const ACTIONS = new Set(["resubmit"]);

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "rate_limited") return 429;
  if (reason === "forbidden") return 403;
  if (reason === "not_found") return 404;
  return 400;
}

export async function GET(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const status = new URL(req.url).searchParams.get("status");

  try {
    const res = await callRpc<RequestPayload>("list_personal_requests", {
      p_session_token: token,
      p_status: status && status !== "all" ? status : null,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, reason: res.reason, message: messageFor(res.reason) },
        { status: statusForReason(res.reason) },
      );
    }

    return NextResponse.json({
      ok: true,
      isUsg: Boolean(res.isUsg),
      requests: res.requests ?? [],
    });
  } catch (error) {
    console.error("[requests:read]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load your requests." },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const limit = rateLimit(`requests:write:ip:${clientIp(req)}`, 30, 10 * 60_000);
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

  try {
    const res = await callRpc<RequestPayload>("file_personal_request", {
      p_session_token: token,
      p_unit_id: typeof body.unitId === "string" && body.unitId ? body.unitId : null,
      p_subject: typeof body.subject === "string" ? body.subject : "",
      p_cover_letter: typeof body.coverLetter === "string" ? body.coverLetter : "",
      p_purpose: typeof body.purpose === "string" ? body.purpose : "",
      p_needed_on: typeof body.neededOn === "string" && body.neededOn ? body.neededOn : null,
      p_needed_time: typeof body.neededTime === "string" && body.neededTime ? body.neededTime : null,
      p_needed_timezone:
        typeof body.neededTimezone === "string" && body.neededTimezone ? body.neededTimezone : null,
      p_link_url: typeof body.linkUrl === "string" ? body.linkUrl : "",
      p_storage_path: typeof body.storagePath === "string" && body.storagePath ? body.storagePath : null,
      p_original_name:
        typeof body.originalName === "string" && body.originalName ? body.originalName : null,
      p_mime_type: typeof body.mimeType === "string" && body.mimeType ? body.mimeType : null,
      p_size_bytes: typeof body.sizeBytes === "number" ? body.sizeBytes : null,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, reason: res.reason, message: messageFor(res.reason) },
        { status: statusForReason(res.reason) },
      );
    }

    return NextResponse.json({ ok: true, requestId: res.requestId });
  } catch (error) {
    console.error("[requests:write]", error);
    return NextResponse.json(
      { ok: false, message: "We could not file that request. Please try again." },
      { status: 500 },
    );
  }
}

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

  const requestId = typeof body.requestId === "string" ? body.requestId : "";
  if (!requestId) {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  if (action && !ACTIONS.has(action)) {
    return NextResponse.json(
      { ok: false, reason: "invalid_request", message: messageFor("invalid_request") },
      { status: 400 },
    );
  }

  const note = typeof body.note === "string" ? body.note : "";

  if (action === "resubmit") {
    try {
      const res = await callRpc<RequestPayload>("resubmit_personal_request", {
        p_session_token: token,
        p_request_id: requestId,
        p_note: note,
      });

      if (!res.ok) {
        return NextResponse.json(
          { ok: false, reason: res.reason, message: messageFor(res.reason) },
          { status: statusForReason(res.reason) },
        );
      }

      return NextResponse.json({ ok: true, status: res.status });
    } catch (error) {
      console.error("[requests:resubmit]", error);
      return NextResponse.json(
        { ok: false, message: "We could not resubmit that request. Please try again." },
        { status: 500 },
      );
    }
  }

  const decision = typeof body.decision === "string" ? body.decision : "";
  if (!DECISIONS.has(decision)) {
    return NextResponse.json(
      { ok: false, reason: "invalid_request", message: messageFor("invalid_request") },
      { status: 400 },
    );
  }

  try {
    const res = await callRpc<RequestPayload>("decide_personal_request", {
      p_session_token: token,
      p_request_id: requestId,
      p_decision: decision,
      p_note: note,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, reason: res.reason, message: messageFor(res.reason) },
        { status: statusForReason(res.reason) },
      );
    }

    return NextResponse.json({ ok: true, status: res.status });
  } catch (error) {
    console.error("[requests:decide]", error);
    return NextResponse.json(
      { ok: false, message: "We could not save that decision. Please try again." },
      { status: 500 },
    );
  }
}
