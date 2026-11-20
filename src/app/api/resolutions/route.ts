import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { UUID_RE, type ResolutionRow } from "@/lib/resolutions";

export const runtime = "nodejs";

type ListResult = RpcResult & { canReview?: boolean; rows?: ResolutionRow[] };
type CreateResult = RpcResult & { id?: string };

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "forbidden") return 403;
  if (reason === "not_found") return 404;
  return 400;
}

/**
 * Every resolution the caller is allowed to see. The visibility rule lives in
 * SQL: USG sees the whole organisation, an LSG officer sees their own unit plus
 * the org-wide rows the office has already approved or published.
 */
export async function GET() {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  try {
    const res = await callRpc<ListResult>("list_resolutions", { p_session_token: token });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }

    return NextResponse.json({
      ok: true,
      canReview: res.canReview === true,
      rows: res.rows ?? [],
    });
  } catch (error) {
    console.error("[resolutions:list]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load the resolutions." },
      { status: 500 },
    );
  }
}

/**
 * A new resolution. The caller's identity, unit and organisation are all
 * resolved inside SQL from the session, so `unitId` is only ever a hint a USG
 * officer may use to scope the row to one of their units.
 */
export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: {
    title?: unknown;
    body?: unknown;
    unitId?: unknown;
    resolutionNo?: unknown;
    datePassed?: unknown;
    shortSummary?: unknown;
    proposedBudget?: unknown;
    storagePath?: unknown;
    originalName?: unknown;
    mimeType?: unknown;
    sizeBytes?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Send the resolution as JSON." },
      { status: 400 },
    );
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length < 4 || title.length > 160) {
    return NextResponse.json(
      { ok: false, message: messageFor("invalid_title"), reason: "invalid_title" },
      { status: 400 },
    );
  }

  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (text.length < 10) {
    return NextResponse.json(
      { ok: false, message: messageFor("invalid_body"), reason: "invalid_body" },
      { status: 400 },
    );
  }

  let unitId: string | null = null;
  if (typeof body.unitId === "string" && body.unitId.trim()) {
    unitId = body.unitId.trim();
    if (!UUID_RE.test(unitId)) {
      return NextResponse.json(
        { ok: false, message: "That unit reference is not valid." },
        { status: 400 },
      );
    }
  }

  const resolutionNo = typeof body.resolutionNo === "string" ? body.resolutionNo.trim() : "";
  const datePassed = typeof body.datePassed === "string" ? body.datePassed.trim() : "";
  const shortSummary = typeof body.shortSummary === "string" ? body.shortSummary.trim() : "";
  const storagePath = typeof body.storagePath === "string" ? body.storagePath.trim() : "";
  const originalName = typeof body.originalName === "string" ? body.originalName.trim() : "";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType.trim() : "";

  const hasRichFields =
    resolutionNo !== "" ||
    datePassed !== "" ||
    shortSummary !== "" ||
    storagePath !== "" ||
    originalName !== "" ||
    mimeType !== "" ||
    body.proposedBudget !== undefined;

  let proposedBudget: number | null = null;
  if (typeof body.proposedBudget === "number" && Number.isFinite(body.proposedBudget)) {
    proposedBudget = body.proposedBudget;
  } else if (typeof body.proposedBudget === "string" && body.proposedBudget.trim()) {
    proposedBudget = Number(body.proposedBudget.replace(/[,\s]/g, ""));
  }

  let sizeBytes: number | null = null;
  if (typeof body.sizeBytes === "number" && Number.isSafeInteger(body.sizeBytes)) {
    sizeBytes = body.sizeBytes;
  }

  if (hasRichFields) {
    if (!resolutionNo || resolutionNo.length > 80) {
      return NextResponse.json(
        { ok: false, message: messageFor("invalid_resolution_no"), reason: "invalid_resolution_no" },
        { status: 400 },
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePassed) || Number.isNaN(Date.parse(datePassed))) {
      return NextResponse.json(
        { ok: false, message: messageFor("invalid_date_passed"), reason: "invalid_date_passed" },
        { status: 400 },
      );
    }
    if (shortSummary.length < 10 || shortSummary.length > 1000) {
      return NextResponse.json(
        { ok: false, message: messageFor("invalid_summary"), reason: "invalid_summary" },
        { status: 400 },
      );
    }
    if (proposedBudget === null || !Number.isFinite(proposedBudget) || proposedBudget < 0) {
      return NextResponse.json(
        { ok: false, message: messageFor("invalid_budget"), reason: "invalid_budget" },
        { status: 400 },
      );
    }
    if (storagePath && (!originalName || sizeBytes === null)) {
      return NextResponse.json(
        { ok: false, message: "The attachment is incomplete. Upload it again." },
        { status: 400 },
      );
    }
  }

  try {
    const res = hasRichFields
      ? await callRpc<CreateResult>("create_resolution_v2", {
          p_session_token: token,
          p_title: title,
          p_resolution_no: resolutionNo,
          p_date_passed: datePassed,
          p_short_summary: shortSummary,
          p_body: text,
          p_proposed_budget: proposedBudget,
          p_storage_path: storagePath || null,
          p_original_name: originalName || null,
          p_mime_type: mimeType || null,
          p_size_bytes: sizeBytes,
          p_unit_id: unitId,
        })
      : await callRpc<CreateResult>("create_resolution", {
          p_session_token: token,
          p_title: title,
          p_body: text,
          p_unit_id: unitId,
        });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }

    return NextResponse.json({ ok: true, id: res.id });
  } catch (error) {
    console.error("[resolutions:create]", error);
    return NextResponse.json(
      { ok: false, message: "We could not file that resolution." },
      { status: 500 },
    );
  }
}
