import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import type { DocumentRow, DocumentStatus } from "@/lib/document-search";

export const runtime = "nodejs";

type SearchResult = RpcResult & {
  canApprove?: boolean;
  rows?: DocumentRow[];
};

const STATUSES = new Set<DocumentStatus>(["pending", "approved", "rejected"]);

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
  const limitRaw = searchParams.get("limit") ?? "";

  if (status && !STATUSES.has(status as DocumentStatus)) {
    return NextResponse.json(
      { ok: false, message: "Choose pending, approved, or rejected." },
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
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }

    return NextResponse.json({
      ok: true,
      canApprove: res.canApprove === true,
      rows: res.rows ?? [],
    });
  } catch (error) {
    console.error("[documents:search]", error);
    return NextResponse.json(
      { ok: false, message: "We could not search the document catalog." },
      { status: 500 },
    );
  }
}
