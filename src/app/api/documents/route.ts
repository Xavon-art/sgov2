import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import {
  UUID_RE,
  type DocumentGroupKind,
  type DocumentRow,
  type DocumentStatus,
} from "@/lib/document-search";

export const runtime = "nodejs";

type ReviewableRow = DocumentRow & { canApprove?: boolean };

type SearchResult = RpcResult & {
  canApprove?: boolean;
  rows?: ReviewableRow[];
};

const STATUSES = new Set<DocumentStatus>(["pending", "approved", "rejected"]);
const GROUPS = new Set<DocumentGroupKind>([
  "requirement",
  "resolution",
  "event",
  "request",
  "task",
]);

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "forbidden") return 403;
  if (reason === "not_found") return 404;
  return 400;
}

/**
 * Catalog search. The visibility rule lives in SQL: reviewers see the whole
 * organisation, an officer sees their own unit, uploads and authored rows, and
 * every signed-in account sees the approved catalog.
 */
export async function GET(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const type = searchParams.get("type")?.trim().toUpperCase() ?? "";
  const status = searchParams.get("status")?.trim().toLowerCase() ?? "";
  const groupKind = searchParams.get("groupKind")?.trim().toLowerCase() ?? "";
  const groupId = searchParams.get("groupId")?.trim() ?? "";
  const originUnitId = searchParams.get("originUnitId")?.trim() ?? "";
  const limitRaw = searchParams.get("limit") ?? "";

  if (status && !STATUSES.has(status as DocumentStatus)) {
    return NextResponse.json(
      { ok: false, message: "Choose pending, approved, or rejected." },
      { status: 400 },
    );
  }

  if (groupKind && !GROUPS.has(groupKind as DocumentGroupKind)) {
    return NextResponse.json(
      { ok: false, message: "Choose a valid document group." },
      { status: 400 },
    );
  }

  if ((groupId && !UUID_RE.test(groupId)) || (originUnitId && !UUID_RE.test(originUnitId))) {
    return NextResponse.json(
      { ok: false, message: "That group or unit reference is not valid." },
      { status: 400 },
    );
  }

  let limit = 50;
  if (limitRaw) {
    const parsed = Number(limitRaw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      return NextResponse.json(
        { ok: false, message: "Limit must be a whole number from 1 to 100." },
        { status: 400 },
      );
    }
    limit = parsed;
  }

  try {
    const res = await callRpc<SearchResult>("search_documents", {
      p_session_token: token,
      p_query: q || null,
      p_type: type || null,
      p_status: status || null,
      p_limit: limit,
      p_group_kind: groupKind || null,
      p_group_id: groupId || null,
      p_origin_unit_id: originUnitId || null,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }

    const reviewer = res.canApprove === true;
    const rows = (res.rows ?? []).map((row) => ({
      ...row,
      canApprove: reviewer && row.sourceKind === "requirement_submission",
    }));

    return NextResponse.json({
      ok: true,
      canApprove: reviewer,
      rows,
    });
  } catch (error) {
    console.error("[documents:search]", error);
    return NextResponse.json(
      { ok: false, message: "We could not search the document catalog." },
      { status: 500 },
    );
  }
}
